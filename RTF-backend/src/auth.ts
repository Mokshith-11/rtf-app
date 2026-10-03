import { Prisma, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import { z } from "zod";
import { config } from "./config";
import { prisma } from "./db";
import { asyncRoute, HttpError } from "./errors";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; role: UserRole; name: string; email: string };
    }
  }
}

const cookieName = "rtf_session";
const cookieOptions = {
  httpOnly: true,
  secure: config.isProduction,
  sameSite: "strict" as const,
  path: "/"
};

const passwordSchema = z.string().min(13).max(128).refine((password) => {
  const letters = password.match(/[A-Za-z]/g)?.length ?? 0;
  const digits = password.match(/[0-9]/g)?.length ?? 0;
  return letters >= 8 && digits >= 4 && /[^A-Za-z0-9\s]/.test(password);
}, "Password must contain at least 8 letters, 4 numbers, and 1 special character.");

const indianPhoneSchema = z.string().trim().max(24).transform((value, context) => {
  const compact = value.replace(/[\s()-]/g, "");
  const nationalNumber = compact.startsWith("+91")
    ? compact.slice(3)
    : compact.length === 12 && compact.startsWith("91")
      ? compact.slice(2)
      : compact.length === 11 && compact.startsWith("0")
        ? compact.slice(1)
        : compact;
  if (!/^[6-9]\d{9}$/.test(nationalNumber)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid 10-digit Indian mobile number." });
    return z.NEVER;
  }
  return `+91${nationalNumber}`;
});

const registrationSchema = z.object({
  name: z.string().trim().min(2).max(100),
  batchNumber: z.string().trim().min(1).max(50),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  phone: indianPhoneSchema,
  password: passwordSchema
});

const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128)
});
const passwordResetRequestSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase())
}).strict();
const passwordResetSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  password: passwordSchema
}).strict();
const resetRequestMessage = "If an account exists for that email, password reset instructions will be sent.";

function setSession(res: Response, user: { id: string; role: UserRole; sessionVersion?: number }) {
  const token = jwt.sign({ role: user.role, sessionVersion: user.sessionVersion ?? 0 }, config.jwtSecret, {
    subject: user.id,
    expiresIn: config.jwtExpiresIn as jwt.SignOptions["expiresIn"]
  });
  res.cookie(cookieName, token, { ...cookieOptions, maxAge: 8 * 60 * 60 * 1000 });
}

export const requireAuth = async (req: Request, _res: Response, next: NextFunction) => {
  const token = req.cookies?.[cookieName];
  if (!token) return next(new HttpError(401, "Please sign in to continue."));
  let userId: string;
  let tokenSessionVersion = 0;
  try {
    const claims = jwt.verify(token, config.jwtSecret);
    if (typeof claims === "string" || !claims.sub) throw new Error("Invalid token claims");
    userId = claims.sub;
    const version = claims["sessionVersion"];
    if (version !== undefined && typeof version !== "number") throw new Error("Invalid session version");
    tokenSessionVersion = version ?? 0;
  } catch {
    return next(new HttpError(401, "Your session has expired. Please sign in again."));
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, name: true, email: true, batchNumber: true, sessionVersion: true }
  });
  if (!user) return next(new HttpError(401, "Your account is no longer available."));
  if (tokenSessionVersion !== user.sessionVersion) return next(new HttpError(401, "Your session has expired. Please sign in again."));
  req.user = { id: user.id, role: user.role, name: user.name, email: user.email };
  next();
};

export function requireRole(role: UserRole) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.user?.role !== role) return next(new HttpError(403, "You do not have permission to access this resource."));
    next();
  };
}

export const authRoutes = {
  register: asyncRoute(async (req, res) => {
    const input = registrationSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(input.password, 12);
    try {
      const user = await prisma.user.create({
        data: {
          name: input.name,
          batchNumber: input.batchNumber,
          email: input.email,
          phone: input.phone,
          passwordHash,
          role: UserRole.CANDIDATE
        },
        select: { id: true, role: true, sessionVersion: true, name: true, email: true, batchNumber: true, phone: true, createdAt: true }
      });
      setSession(res, user);
      res.status(201).json({ user });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new HttpError(409, "That email address is already registered.");
      }
      throw error;
    }
  }),
  login: asyncRoute(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      throw new HttpError(401, "Email or password is incorrect.");
    }
    setSession(res, user);
    res.json({ user: { id: user.id, role: user.role, name: user.name, email: user.email, batchNumber: user.batchNumber } });
  }),
  requestPasswordReset: asyncRoute(async (req, res) => {
    const input = passwordResetRequestSchema.parse(req.body);
    if (!config.smtpHost || !config.smtpFrom || !config.smtpUser || !config.smtpPassword) {
      throw new HttpError(503, "Email password reset is unavailable because SMTP is not configured. Configure SMTP_HOST, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM, or ask a backend administrator to run npm run admin:reset-password.");
    }
    const user = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true, email: true, name: true }
    });
    if (!user) {
      res.status(202).json({ message: resetRequestMessage });
      return;
    }
    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    await prisma.passwordResetToken.upsert({
      where: { userId: user.id },
      create: { userId: user.id, tokenHash, expiresAt },
      update: { tokenHash, expiresAt }
    });
    const resetUrl = new URL("/", config.appBaseUrl);
    resetUrl.searchParams.set("resetToken", token);
    const transport = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: config.smtpUser && config.smtpPassword
        ? { user: config.smtpUser, pass: config.smtpPassword }
        : undefined
    });
    try {
      await transport.sendMail({
        from: config.smtpFrom,
        to: user.email,
        subject: "Reset your RTF password",
        text: `Hello ${user.name},\n\nUse this one-time link to reset your RTF password within 30 minutes:\n${resetUrl.toString()}\n\nIf you did not request this, you can ignore this email.`,
        html: `<p>Hello ${user.name.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character] ?? character)},</p><p>Use this one-time link to reset your RTF password within 30 minutes:</p><p><a href="${resetUrl.toString()}">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>`
      });
    } catch (error) {
      await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, tokenHash } });
      console.error("Password reset email delivery failed.", error instanceof Error ? error.name : "Unknown email delivery error");
      throw new HttpError(503, "The password reset email could not be sent. Please contact the administrator to check the email service configuration.");
    }
    res.status(202).json({ message: resetRequestMessage });
  }),
  resetPassword: asyncRoute(async (req, res) => {
    const input = passwordResetSchema.parse(req.body);
    const tokenHash = createHash("sha256").update(input.token).digest("hex");
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true }
    });
    if (!resetToken || resetToken.expiresAt <= new Date()) {
      throw new HttpError(400, "This password reset link is invalid or has expired. Request a new one.");
    }
    const passwordHash = await bcrypt.hash(input.password, 12);
    await prisma.$transaction(async (tx) => {
      const deleted = await tx.passwordResetToken.deleteMany({
        where: { id: resetToken.id, tokenHash, expiresAt: { gt: new Date() } }
      });
      if (deleted.count !== 1) throw new HttpError(400, "This password reset link is invalid or has expired. Request a new one.");
      await tx.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash, sessionVersion: { increment: 1 } }
      });
    });
    res.json({ message: "Your password has been reset. Please sign in with your new password." });
  }),
  logout: asyncRoute(async (_req, res) => {
    res.clearCookie(cookieName, cookieOptions);
    res.status(204).end();
  }),
  me: asyncRoute(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, role: true, name: true, email: true, batchNumber: true, phone: true, createdAt: true }
    });
    if (!user) throw new HttpError(401, "Please sign in to continue.");
    res.json({ user });
  })
};
