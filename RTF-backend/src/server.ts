import "dotenv/config";
import { UserRole } from "@prisma/client";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import path from "node:path";
import { authRoutes, requireAuth, requireRole } from "./auth";
import { config } from "./config";
import { prisma } from "./db";
import { asyncRoute, errorHandler, HttpError } from "./errors";
import { routes } from "./routes";

const app = express();
const frontendBuildDirectory = path.resolve(__dirname, "..", "..", "..", "RTF-frontend", "dist", "rtf-frontend", "browser");
app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: config.frontendOrigins, credentials: true }));
app.use(express.json({ limit: "32kb" }));
app.use(cookieParser());
app.use("/api", (req, _res, next) => {
  const origin = req.get("origin");
  if (origin && !config.frontendOrigins.includes(origin)) {
    next(new HttpError(403, "Requests from this origin are not allowed."));
    return;
  }
  next();
});

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });
const violationLimiter = rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
app.post("/api/auth/register", authLimiter, authRoutes.register);
app.post("/api/auth/login", authLimiter, authRoutes.login);
app.post("/api/auth/forgot-password", authLimiter, authRoutes.requestPasswordReset);
app.post("/api/auth/reset-password", authLimiter, authRoutes.resetPassword);
app.post("/api/auth/logout", requireAuth, authRoutes.logout);
app.get("/api/auth/me", requireAuth, authRoutes.me);

app.get("/api/attempts/current", requireAuth, routes.currentAttempt);
app.get("/api/candidate/assessments", requireAuth, requireRole(UserRole.CANDIDATE), routes.candidateAssessments);
app.get("/api/admit-cards/:testId", requireAuth, requireRole(UserRole.CANDIDATE), routes.admitCard);
app.get("/api/tests", requireAuth, requireRole(UserRole.CANDIDATE), routes.listTests);
app.get("/api/tests/:id", requireAuth, requireRole(UserRole.CANDIDATE), routes.testDetails);
app.post("/api/attempts", requireAuth, requireRole(UserRole.CANDIDATE), routes.startAttempt);
app.get("/api/attempts/:id", requireAuth, routes.getAttempt);
app.put("/api/attempts/:id/answers/:questionId", requireAuth, routes.saveAnswer);
app.post("/api/attempts/:id/violations", requireAuth, violationLimiter, routes.recordViolation);
app.post("/api/attempts/:id/submit", requireAuth, routes.submitAttempt);
app.get("/api/results/:attemptId", requireAuth, routes.getResult);

app.get("/api/admin/overview", requireAuth, requireRole(UserRole.ADMIN), routes.adminOverview);
app.get("/api/admin/violation-activity", requireAuth, requireRole(UserRole.ADMIN), routes.adminViolationActivity);
app.get("/api/admin/tests/:id/violations", requireAuth, requireRole(UserRole.ADMIN), routes.adminTestViolationActivity);
app.post("/api/admin/tests", requireAuth, requireRole(UserRole.ADMIN), routes.createTest);
app.put("/api/admin/tests/:id", requireAuth, requireRole(UserRole.ADMIN), routes.updateTest);
app.patch("/api/admin/tests/:id/archive", requireAuth, requireRole(UserRole.ADMIN), routes.setTestArchived);
app.delete("/api/admin/tests/:id", requireAuth, requireRole(UserRole.ADMIN), routes.deleteTest);

if (config.isProduction) {
  app.use(express.static(frontendBuildDirectory));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path === "/api" || req.path.startsWith("/api/") || !req.accepts("html")) {
      next();
      return;
    }
    res.sendFile(path.join(frontendBuildDirectory, "index.html"), (error) => {
      if (error) next(error);
    });
  });
}

app.use((_req, _res, next) => next(new HttpError(404, "The requested resource was not found.")));
app.use(errorHandler);

const server = app.listen(config.port, () => {
  console.log(`RTF server listening on port ${config.port}`);
  console.log("Health check: /api/health");
  console.log("Press Ctrl+C to stop the server.");
});
server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${config.port} is already in use. Stop the existing API process or set a different PORT in .env.`);
  } else {
    console.error("RTF API failed to start.", error);
  }
  process.exitCode = 1;
  void prisma.$disconnect().finally(() => process.exit());
});

const autoSubmitTimer = setInterval(() => {
  void routes.autoSubmitExpired().catch((error: unknown) => console.error("Failed to finalize expired attempts", error));
}, 15_000);

process.on("SIGINT", async () => {
  clearInterval(autoSubmitTimer);
  await prisma.$disconnect();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  clearInterval(autoSubmitTimer);
  await prisma.$disconnect();
  process.exit(0);
});
