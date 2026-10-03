import "dotenv/config";
import bcrypt from "bcryptjs";
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import { prisma } from "../src/db";

async function readHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("Run this command in an interactive terminal to enter the password securely.");
  }
  emitKeypressEvents(process.stdin);
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const onKeypress = (character: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === "c") {
        process.stdin.off("keypress", onKeypress);
        process.stdin.setRawMode(false);
        process.stdout.write("\n");
        reject(new Error("Password reset cancelled."));
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        process.stdin.off("keypress", onKeypress);
        process.stdin.setRawMode(false);
        process.stdout.write("\n");
        resolve(value);
        return;
      }
      if (key.name === "backspace") {
        if (value.length) {
          value = value.slice(0, -1);
          process.stdout.write("\b \b");
        }
        return;
      }
      if (!key.name || key.name.length === 1) {
        value += character;
        process.stdout.write("*");
      }
    };
    process.stdin.on("keypress", onKeypress);
  });
}

async function main() {
  let email = "";
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    email = (await prompt.question("Account email to reset: ")).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid account email.");
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, role: true } });
    if (!user) throw new Error("No account exists for that email.");
    const confirm = (await prompt.question(`Reset password for ${user.email} (${user.role})? Type YES to continue: `)).trim();
    if (confirm !== "YES") throw new Error("Password reset cancelled.");
  } finally {
    prompt.close();
  }

  const password = await readHidden("New password (input hidden): ");
  const letters = password.match(/[A-Za-z]/g)?.length ?? 0;
  const digits = password.match(/[0-9]/g)?.length ?? 0;
  if (password.length < 13 || password.length > 128 || letters < 8 || digits < 4 || !/[^A-Za-z0-9\s]/.test(password)) {
    throw new Error("Password must contain at least 8 letters, 4 numbers, and 1 special character (13–128 characters total).");
  }
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.$transaction([
    prisma.user.update({
      where: { email },
      data: { passwordHash, sessionVersion: { increment: 1 } }
    }),
    prisma.passwordResetToken.deleteMany({ where: { user: { email } } })
  ]);
  console.log("Password updated. Existing sessions have been signed out.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Password reset failed.");
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
