import "dotenv/config";
import { UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db";

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) {
    throw new Error("Set ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters before seeding.");
  }
  const hash = await bcrypt.hash(password, 12);
  const admin = await prisma.user.upsert({
    where: { email },
    update: { passwordHash: hash, role: UserRole.ADMIN },
    create: { email, name: "RTF Administrator", passwordHash: hash, role: UserRole.ADMIN }
  });
  const existing = await prisma.test.findFirst({ where: { title: "C Programming Fundamentals" } });
  if (!existing) {
    await prisma.test.create({
      data: {
        title: "C Programming Fundamentals",
        description: "A short practice assessment covering core C language concepts.",
        category: "Programming",
        difficulty: "MEDIUM",
        durationMinutes: 20,
        totalMarks: 3,
        passingMarks: 2,
        createdById: admin.id,
        questions: {
          create: [
            { position: 0, questionText: "Which symbol is used to access the value stored at a pointer?", options: ["&", "*", "%", "#"], correctIndex: 1, marks: 1, explanation: "The unary * operator dereferences a pointer." },
            { position: 1, questionText: "Which header declares printf?", options: ["stdlib.h", "string.h", "stdio.h", "math.h"], correctIndex: 2, marks: 1, explanation: "stdio.h declares standard input and output functions including printf." },
            { position: 2, questionText: "What does sizeof return?", options: ["Number of bits", "Number of bytes", "Address of an object", "Number of elements always"], correctIndex: 1, marks: 1, explanation: "sizeof returns the size in bytes of its operand's type." }
          ]
        }
      }
    });
  }
  console.log(`Seeded administrator ${email} and the sample test.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
