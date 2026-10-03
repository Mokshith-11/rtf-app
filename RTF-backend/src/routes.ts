import { AttendanceStatus, AttemptStatus, Prisma, UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db";
import { asyncRoute, HttpError } from "./errors";

const answerSchema = z.object({ selectedIndex: z.number().int().min(0).max(3).nullable() }).strict();
const questionSchema = z.object({
  questionText: z.string().trim().min(5).max(3000),
  options: z.array(z.string().trim().min(1).max(500)).length(4),
  correctIndex: z.number().int().min(0).max(3),
  marks: z.number().positive().max(100),
  negativeMarks: z.number().min(0).max(100).optional(),
  explanation: z.string().max(2000).optional(),
  topic: z.string().max(100).optional(),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD"]).default("MEDIUM")
}).strict();
const createTestSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(5).max(2000),
  category: z.string().trim().min(2).max(80),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD"]),
  durationMinutes: z.number().int().min(1).max(300),
  startTime: z.string().datetime({ offset: true }).nullable().optional(),
  endTime: z.string().datetime({ offset: true }).nullable().optional(),
  passingMarks: z.number().min(0),
  negativeMarking: z.number().min(0).max(100).default(0),
  showResults: z.boolean().default(true),
  showExplanations: z.boolean().default(true),
  questions: z.array(questionSchema).min(1).max(100)
}).strict().superRefine((input, context) => {
  if (input.startTime && input.endTime && new Date(input.startTime) >= new Date(input.endTime)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["endTime"], message: "The test end time must be later than its start time." });
  }
});
const updateTestSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(5).max(2000),
  category: z.string().trim().min(2).max(80),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD"]),
  durationMinutes: z.number().int().min(1).max(300),
  startTime: z.string().datetime({ offset: true }).nullable(),
  endTime: z.string().datetime({ offset: true }).nullable(),
  passingMarks: z.number().min(0),
  negativeMarking: z.number().min(0).max(100),
  showResults: z.boolean(),
  showExplanations: z.boolean(),
  questions: z.array(questionSchema).min(1).max(100)
}).strict().superRefine((input, context) => {
  if (input.startTime && input.endTime && new Date(input.startTime) >= new Date(input.endTime)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["endTime"], message: "The test end time must be later than its start time." });
  }
  input.questions.forEach((question, index) => {
    if ((question.negativeMarks ?? input.negativeMarking) > question.marks) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["questions", index, "negativeMarks"],
        message: "Negative marks cannot exceed question marks."
      });
    }
  });
});
const attemptStartSchema = z.object({ testId: z.string().uuid() }).strict();
const violationSchema = z.object({
  type: z.enum(["TAB_HIDDEN"]),
  details: z.string().max(200).optional()
}).strict();

const uuidSchema = z.string().uuid();

function routeParam(value: string | string[] | undefined) {
  if (typeof value !== "string") throw new HttpError(400, "Invalid route parameter.");
  return value;
}

async function ownedAttempt(id: string, userId: string) {
  id = uuidSchema.parse(id);
  const attempt = await prisma.attempt.findUnique({ where: { id }, include: { test: { include: { questions: true } } } });
  if (!attempt) throw new HttpError(404, "Attempt not found.");
  if (attempt.userId !== userId) throw new HttpError(403, "This attempt does not belong to your account.");
  return attempt;
}

async function finalizeAttempt(id: string, status: AttemptStatus) {
  return prisma.$transaction(async (tx) => {
    const attempt = await tx.attempt.findUnique({
      where: { id },
      include: { test: { include: { questions: true } }, answers: true }
    });
    if (!attempt) throw new HttpError(404, "Attempt not found.");
    if (attempt.status !== AttemptStatus.IN_PROGRESS) return attempt;
    const answerByQuestion = new Map(attempt.answers.map((answer) => [answer.questionId, answer]));
    let score = 0;
    for (const question of attempt.test.questions) {
      const answer = answerByQuestion.get(question.id);
      const correct = answer?.selectedIndex === question.correctIndex;
      const awarded = answer?.selectedIndex == null ? 0 : correct ? question.marks : -question.negativeMarks;
      score += awarded;
      if (answer) await tx.answer.update({ where: { id: answer.id }, data: { isCorrect: correct, marksAwarded: awarded } });
    }
    score = Math.max(0, Math.round(score * 100) / 100);
    const submittedAt = new Date();
    const updated = await tx.attempt.update({
      where: { id },
      data: { score, percentage: attempt.test.totalMarks > 0 ? Math.round(score / attempt.test.totalMarks * 10000) / 100 : 0, status, submittedAt }
    });
    await tx.attendance.updateMany({
      where: { testId: attempt.testId, userId: attempt.userId },
      data: { status: status === AttemptStatus.AUTO_SUBMITTED ? AttendanceStatus.AUTO_SUBMITTED : AttendanceStatus.COMPLETED, submittedAt }
    });
    return updated;
  });
}

function deadline(startedAt: Date, test: { durationMinutes: number; endTime: Date | null }) {
  const durationDeadline = startedAt.getTime() + test.durationMinutes * 60_000;
  return test.endTime ? Math.min(durationDeadline, test.endTime.getTime()) : durationDeadline;
}

function testStatus(test: { startTime: Date | null; endTime: Date | null }, now: Date) {
  if (test.endTime && test.endTime <= now) return "CLOSED";
  if (test.startTime && test.startTime > now) return "SCHEDULED";
  return "ACTIVE";
}

async function getAdminViolationActivity() {
  const [count, violations] = await Promise.all([
    prisma.violation.count(),
    prisma.violation.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        type: true,
        details: true,
        createdAt: true,
        attempt: {
          select: {
            id: true,
            user: { select: { name: true, batchNumber: true, email: true } },
            test: { select: { id: true, title: true } }
          }
        }
      }
    })
  ]);
  return {
    count,
    events: violations.map((violation) => ({
      id: violation.id,
      type: violation.type,
      details: violation.details,
      createdAt: violation.createdAt,
      candidateName: violation.attempt.user.name,
      candidateEmail: violation.attempt.user.email,
      batchNumber: violation.attempt.user.batchNumber,
      testId: violation.attempt.test.id,
      testTitle: violation.attempt.test.title,
      attemptId: violation.attempt.id
    }))
  };
}

async function getTestViolationActivity(testId: string) {
  const where = { attempt: { testId } };
  const [count, violations] = await Promise.all([
    prisma.violation.count({ where }),
    prisma.violation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        type: true,
        details: true,
        createdAt: true,
        attempt: {
          select: {
            id: true,
            user: { select: { name: true, batchNumber: true, email: true } },
            test: { select: { id: true, title: true } }
          }
        }
      }
    })
  ]);
  return {
    count,
    events: violations.map((violation) => ({
      id: violation.id,
      type: violation.type,
      details: violation.details,
      createdAt: violation.createdAt,
      candidateName: violation.attempt.user.name,
      candidateEmail: violation.attempt.user.email,
      batchNumber: violation.attempt.user.batchNumber,
      testId: violation.attempt.test.id,
      testTitle: violation.attempt.test.title,
      attemptId: violation.attempt.id
    }))
  };
}

function attemptPayload(attempt: NonNullable<Awaited<ReturnType<typeof ownedAttempt>>>) {
  return {
    id: attempt.id,
    status: attempt.status,
    startedAt: attempt.startedAt,
    deadline: new Date(deadline(attempt.startedAt, attempt.test)).toISOString(),
    test: {
      id: attempt.test.id,
      title: attempt.test.title,
      durationMinutes: attempt.test.durationMinutes,
      totalMarks: attempt.test.totalMarks,
      questions: attempt.test.questions
        .sort((a, b) => a.position - b.position)
        .map(({ id, questionText, options, marks, position }) => ({ id, questionText, options, marks, position }))
    },
  };
}

export const routes = {
  autoSubmitExpired: async () => {
    const active = await prisma.attempt.findMany({
      where: { status: AttemptStatus.IN_PROGRESS },
      include: { test: { select: { durationMinutes: true, endTime: true } } }
    });
    const expired = active.filter((attempt) => Date.now() >= deadline(attempt.startedAt, attempt.test));
    await Promise.all(expired.map((attempt) => finalizeAttempt(attempt.id, AttemptStatus.AUTO_SUBMITTED)));
  },
  currentAttempt: asyncRoute(async (req, res) => {
    const attempt = await prisma.attempt.findFirst({
      where: { userId: req.user!.id, status: AttemptStatus.IN_PROGRESS },
      orderBy: { startedAt: "desc" }
    });
    if (!attempt) {
      res.json({ attempt: null });
      return;
    }
    const test = await prisma.test.findUnique({ where: { id: attempt.testId } });
    if (!test) throw new HttpError(404, "Assessment not found.");
    if (Date.now() >= deadline(attempt.startedAt, test)) {
      await finalizeAttempt(attempt.id, AttemptStatus.AUTO_SUBMITTED);
      res.json({ attempt: { id: attempt.id, status: AttemptStatus.AUTO_SUBMITTED } });
      return;
    }
    res.json({ attempt: { id: attempt.id, status: attempt.status } });
  }),
  listTests: asyncRoute(async (_req, res) => {
    const now = new Date();
    const tests = await prisma.test.findMany({
      where: {
        isArchived: false,
        OR: [{ startTime: null }, { startTime: { lte: now } }],
        AND: [
          { OR: [{ endTime: null }, { endTime: { gt: now } }] },
          { attempts: { none: { userId: _req.user!.id } } }
        ]
      },
      include: { _count: { select: { questions: true } } },
      orderBy: { createdAt: "desc" }
    });
    res.json({ tests: tests.map(({ _count, ...test }) => ({ ...test, questionCount: _count.questions })) });
  }),
  candidateAssessments: asyncRoute(async (req, res) => {
    const activeAttempts = await prisma.attempt.findMany({
      where: { userId: req.user!.id, status: AttemptStatus.IN_PROGRESS },
      include: { test: { select: { durationMinutes: true, endTime: true } } }
    });
    await Promise.all(activeAttempts
      .filter((attempt) => Date.now() >= deadline(attempt.startedAt, attempt.test))
      .map((attempt) => finalizeAttempt(attempt.id, AttemptStatus.AUTO_SUBMITTED)));
    const now = new Date();
    const tests = await prisma.test.findMany({
      where: { OR: [{ isArchived: false }, { attempts: { some: { userId: req.user!.id } } }] },
      include: {
        _count: { select: { questions: true } },
        attempts: { where: { userId: req.user!.id }, take: 1 }
      },
      orderBy: [{ startTime: "asc" }, { createdAt: "desc" }]
    });
    res.json({
      assessments: tests.map(({ _count, attempts, ...test }) => {
        const attempt = attempts[0] ?? null;
        const status = attempt
          ? attempt.status === AttemptStatus.IN_PROGRESS ? "IN_PROGRESS" : "COMPLETED"
          : test.isArchived ? "CLOSED" : testStatus(test, now) === "SCHEDULED" ? "UPCOMING" : testStatus(test, now);
        return {
          ...test,
          questionCount: _count.questions,
          status,
          attempt: attempt ? {
            id: attempt.id,
            status: attempt.status,
            startedAt: attempt.startedAt,
            submittedAt: attempt.submittedAt,
            score: test.showResults ? attempt.score : null,
            percentage: test.showResults ? attempt.percentage : null,
            timeTakenSeconds: attempt.submittedAt
              ? Math.min(
                Math.floor((attempt.submittedAt.getTime() - attempt.startedAt.getTime()) / 1000),
                Math.floor((deadline(attempt.startedAt, test) - attempt.startedAt.getTime()) / 1000)
              )
              : null
          } : null
        };
      })
    });
  }),
  admitCard: asyncRoute(async (req, res) => {
    const testId = uuidSchema.parse(routeParam(req.params.testId));
    const [candidate, test] = await Promise.all([
      prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { id: true, name: true, email: true, phone: true, batchNumber: true }
      }),
      prisma.test.findUnique({
        where: { id: testId },
        include: { _count: { select: { questions: true } } }
      })
    ]);
    if (!candidate) throw new HttpError(404, "Candidate not found.");
    if (!test || test.isArchived || !test.startTime || (test.endTime && test.endTime <= new Date())) {
      throw new HttpError(404, "No scheduled admit card is available for this assessment.");
    }
    const existingAttempt = await prisma.attempt.findUnique({
      where: { userId_testId: { userId: candidate.id, testId } },
      select: { id: true }
    });
    if (existingAttempt) throw new HttpError(409, "An admit card is not available after an attempt has started.");
    res.json({
      admitCard: {
        candidate: { ...candidate, candidateId: candidate.id },
        assessment: {
          id: test.id,
          title: test.title,
          category: test.category,
          difficulty: test.difficulty,
          description: test.description,
          questionCount: test._count.questions,
          totalMarks: test.totalMarks,
          passingMarks: test.passingMarks,
          negativeMarking: test.negativeMarking,
          durationMinutes: test.durationMinutes,
          startTime: test.startTime,
          endTime: test.endTime,
          reportingTime: new Date(test.startTime.getTime() - 30 * 60_000)
        },
        instructions: [
          "Arrive and sign in at least 30 minutes before the scheduled start.",
          "Bring valid identification and use a stable internet connection.",
          "The server enforces the assessment schedule and deadline.",
          "Assessment activity may be monitored; detected violations may be recorded."
        ]
      }
    });
  }),
  testDetails: asyncRoute(async (req, res) => {
    const id = uuidSchema.parse(routeParam(req.params.id));
    const test = await prisma.test.findUnique({
      where: { id },
      include: { _count: { select: { questions: true } } }
    });
    if (!test || test.isArchived) throw new HttpError(404, "Test not found.");
    const now = new Date();
    if ((test.startTime && test.startTime > now) || (test.endTime && test.endTime <= now)) {
      throw new HttpError(404, "This test is not currently available.");
    }
    const { _count, ...details } = test;
    res.json({ test: { ...details, questionCount: _count.questions } });
  }),
  startAttempt: asyncRoute(async (req, res) => {
    const input = attemptStartSchema.parse(req.body);
    const test = await prisma.test.findUnique({ where: { id: input.testId }, include: { _count: { select: { questions: true } } } });
    const now = new Date();
    if (!test || test.isArchived || (test.startTime && test.startTime > now) || (test.endTime && test.endTime <= now)) throw new HttpError(404, "This test is not currently available.");
    if (!test._count.questions) throw new HttpError(400, "This test has no questions yet.");
    const previous = await prisma.attempt.findUnique({ where: { userId_testId: { userId: req.user!.id, testId: test.id } } });
    if (previous) {
      if (previous.status === AttemptStatus.IN_PROGRESS) {
        if (Date.now() < deadline(previous.startedAt, test)) {
          res.json({ attempt: { id: previous.id, status: previous.status } });
          return;
        }
        await finalizeAttempt(previous.id, AttemptStatus.AUTO_SUBMITTED);
        throw new HttpError(409, "Your test time has expired. Your answers have been submitted.");
      }
      throw new HttpError(409, "You have already completed this test.");
    }
    try {
      const attempt = await prisma.$transaction(async (tx) => {
        const created = await tx.attempt.create({ data: { userId: req.user!.id, testId: test.id } });
        await tx.attendance.upsert({
          where: { testId_userId: { testId: test.id, userId: req.user!.id } },
          create: { testId: test.id, userId: req.user!.id, status: AttendanceStatus.IN_PROGRESS, joinedAt: now },
          update: { status: AttendanceStatus.IN_PROGRESS, joinedAt: now }
        });
        return created;
      });
      res.status(201).json({ attempt: { id: attempt.id, status: attempt.status } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new HttpError(409, "An attempt for this assessment is already in progress or completed.");
      }
      throw error;
    }
  }),
  getAttempt: asyncRoute(async (req, res) => {
    const attempt = await ownedAttempt(routeParam(req.params.id), req.user!.id);
    if (attempt.status === AttemptStatus.IN_PROGRESS && Date.now() >= deadline(attempt.startedAt, attempt.test)) {
      await finalizeAttempt(attempt.id, AttemptStatus.AUTO_SUBMITTED);
      throw new HttpError(409, "Your test time has expired. Your answers have been submitted.");
    }
    const details = await prisma.attempt.findUnique({
      where: { id: attempt.id },
      include: { test: { include: { questions: { orderBy: { position: "asc" } } } }, answers: true }
    });
    if (!details) throw new HttpError(404, "Attempt not found.");
    res.json({
      attempt: {
        ...attemptPayload({ ...attempt, test: { ...attempt.test, questions: details.test.questions } }),
        answers: details.answers.map((answer) => ({ questionId: answer.questionId, selectedIndex: answer.selectedIndex })),
        result: details.status === AttemptStatus.IN_PROGRESS || !details.test.showResults
          ? null
          : { score: details.score, percentage: details.percentage, submittedAt: details.submittedAt }
      }
    });
  }),
  saveAnswer: asyncRoute(async (req, res) => {
    const input = answerSchema.parse(req.body);
    const questionId = uuidSchema.parse(routeParam(req.params.questionId));
    const attempt = await ownedAttempt(routeParam(req.params.id), req.user!.id);
    if (attempt.status !== AttemptStatus.IN_PROGRESS) throw new HttpError(409, "This test has already been submitted.");
    if (Date.now() >= deadline(attempt.startedAt, attempt.test)) {
      await finalizeAttempt(attempt.id, AttemptStatus.AUTO_SUBMITTED);
      throw new HttpError(409, "Your test time has expired. Your answers have been submitted.");
    }
    const question = await prisma.question.findFirst({ where: { id: questionId, testId: attempt.testId } });
    if (!question) throw new HttpError(404, "Question not found in this test.");
    const answer = await prisma.answer.upsert({
      where: { attemptId_questionId: { attemptId: attempt.id, questionId: question.id } },
      create: { attemptId: attempt.id, questionId: question.id, selectedIndex: input.selectedIndex },
      update: { selectedIndex: input.selectedIndex }
    });
    res.json({ saved: true, answer: { questionId: answer.questionId, selectedIndex: answer.selectedIndex } });
  }),
  recordViolation: asyncRoute(async (req, res) => {
    const input = violationSchema.parse(req.body);
    const attempt = await ownedAttempt(routeParam(req.params.id), req.user!.id);
    if (attempt.status !== AttemptStatus.IN_PROGRESS) throw new HttpError(409, "This test has already been submitted.");
    await prisma.violation.create({ data: { attemptId: attempt.id, type: input.type, details: input.details } });
    res.status(201).json({ recorded: true });
  }),
  submitAttempt: asyncRoute(async (req, res) => {
    const attempt = await ownedAttempt(routeParam(req.params.id), req.user!.id);
    const expired = Date.now() >= deadline(attempt.startedAt, attempt.test);
    const result = await finalizeAttempt(attempt.id, expired ? AttemptStatus.AUTO_SUBMITTED : AttemptStatus.SUBMITTED);
    res.json({ result: { ...result, passed: (result.score ?? 0) >= attempt.test.passingMarks, timeTakenSeconds: Math.min(Math.floor((result.submittedAt!.getTime() - attempt.startedAt.getTime()) / 1000), Math.floor((deadline(attempt.startedAt, attempt.test) - attempt.startedAt.getTime()) / 1000)) } });
  }),
  getResult: asyncRoute(async (req, res) => {
    const attempt = await prisma.attempt.findUnique({
      where: { id: uuidSchema.parse(routeParam(req.params.attemptId)) },
      include: { test: { include: { questions: { orderBy: { position: "asc" } } } }, answers: { include: { question: true } } }
    });
    if (!attempt) throw new HttpError(404, "Result not found.");
    if (attempt.userId !== req.user!.id && req.user!.role !== UserRole.ADMIN) throw new HttpError(403, "You do not have permission to view this result.");
    if (attempt.status === AttemptStatus.IN_PROGRESS) throw new HttpError(409, "This test has not been submitted.");
    if (!attempt.test.showResults && req.user!.role !== UserRole.ADMIN) throw new HttpError(403, "Results for this assessment are not available yet.");
    const completedAttempts = await prisma.attempt.findMany({
      where: { testId: attempt.testId, status: { in: [AttemptStatus.SUBMITTED, AttemptStatus.AUTO_SUBMITTED] }, score: { not: null }, submittedAt: { not: null } },
      select: { id: true, score: true, startedAt: true, submittedAt: true }
    });
    const ownElapsed = attempt.submittedAt!.getTime() - attempt.startedAt.getTime();
    const rank = completedAttempts.filter((entry) =>
      (entry.score ?? 0) > attempt.score! ||
      ((entry.score ?? 0) === attempt.score! && entry.submittedAt!.getTime() - entry.startedAt.getTime() < ownElapsed)
    ).length + 1;
    res.json({
      result: {
        attemptId: attempt.id, testTitle: attempt.test.title, score: attempt.score,
        totalMarks: attempt.test.totalMarks, percentage: attempt.percentage,
        passed: (attempt.score ?? 0) >= attempt.test.passingMarks,
        rank, status: attempt.status, startedAt: attempt.startedAt, submittedAt: attempt.submittedAt,
        timeTakenSeconds: Math.min(
          Math.floor((attempt.submittedAt!.getTime() - attempt.startedAt.getTime()) / 1000),
          Math.floor((deadline(attempt.startedAt, attempt.test) - attempt.startedAt.getTime()) / 1000)
        ),
        answers: attempt.test.showResults ? attempt.test.questions.map((question) => {
          const answer = attempt.answers.find((entry) => entry.questionId === question.id);
          return {
            questionId: question.id, questionText: question.questionText, options: question.options,
            selectedIndex: answer?.selectedIndex ?? null, correctIndex: question.correctIndex,
            isCorrect: answer?.isCorrect ?? false, marksAwarded: answer?.marksAwarded ?? 0,
            explanation: attempt.test.showExplanations ? question.explanation : null
          };
        }) : []
      }
    });
  }),
  adminOverview: asyncRoute(async (_req, res) => {
    const [candidateCount, tests, attempts, violationActivity] = await Promise.all([
      prisma.user.count({ where: { role: UserRole.CANDIDATE } }),
      prisma.test.findMany({ orderBy: { createdAt: "desc" },       include: { _count: { select: { questions: true } }, questions: { orderBy: { position: "asc" } }, attendance: { include: { user: { select: { name: true, batchNumber: true } } }, orderBy: { joinedAt: "desc" } }, attempts: { include: { user: { select: { name: true, batchNumber: true } } }, orderBy: { score: "desc" } } } }),
      prisma.attempt.findMany({ where: { status: { in: [AttemptStatus.SUBMITTED, AttemptStatus.AUTO_SUBMITTED] } }, select: { score: true, test: { select: { totalMarks: true, passingMarks: true } } } }),
      getAdminViolationActivity()
    ]);
    const percentages = attempts.map((attempt) =>
      attempt.test.totalMarks > 0 ? (attempt.score ?? 0) / attempt.test.totalMarks * 100 : 0
    );
    const now = new Date();
    res.json({
      metrics: {
        candidates: candidateCount, tests: tests.length,
        activeTests: tests.filter((test) => !test.isArchived && testStatus(test, now) === "ACTIVE").length,
        completedAttempts: attempts.length,
        averageScore: percentages.length ? Math.round(percentages.reduce((a, b) => a + b, 0) / percentages.length * 100) / 100 : 0,
        passRate: attempts.length ? Math.round(attempts.filter((attempt) => (attempt.score ?? 0) >= attempt.test.passingMarks).length / attempts.length * 100) : 0,
        violations: violationActivity.count
      },
      violationEvents: violationActivity.events,
      tests: tests.map((test) => ({
        id: test.id, title: test.title, category: test.category, difficulty: test.difficulty,
        description: test.description, durationMinutes: test.durationMinutes,
        startTime: test.startTime, endTime: test.endTime,
        passingMarks: test.passingMarks, negativeMarking: test.negativeMarking,
        showResults: test.showResults, showExplanations: test.showExplanations,
        status: test.isArchived ? "ARCHIVED" : testStatus(test, now),
        questionCount: test._count.questions, totalMarks: test.totalMarks,
        questions: test.questions.map((question) => ({
          id: question.id, questionText: question.questionText, options: question.options,
          correctIndex: question.correctIndex, marks: question.marks, negativeMarks: question.negativeMarks,
          explanation: question.explanation, topic: question.topic,
          difficulty: question.difficulty, position: question.position
        })),
        attendance: test.attendance.map((entry) => ({ name: entry.user.name, batchNumber: entry.user.batchNumber, status: entry.status, joinedAt: entry.joinedAt, submittedAt: entry.submittedAt })),
        results: test.attempts.filter((attempt) => attempt.score !== null).map((attempt) => ({ name: attempt.user.name, batchNumber: attempt.user.batchNumber, score: attempt.score, status: attempt.status }))
      }))
    });
  }),
  adminViolationActivity: asyncRoute(async (_req, res) => {
    const activity = await getAdminViolationActivity();
    res.json({ count: activity.count, violationEvents: activity.events });
  }),
  adminTestViolationActivity: asyncRoute(async (req, res) => {
    const testId = uuidSchema.parse(routeParam(req.params.id));
    const test = await prisma.test.findUnique({ where: { id: testId }, select: { id: true } });
    if (!test) throw new HttpError(404, "Assessment not found.");
    const activity = await getTestViolationActivity(testId);
    res.json({ testId, count: activity.count, violationEvents: activity.events });
  }),
  createTest: asyncRoute(async (req, res) => {
    const input = createTestSchema.parse(req.body);
    const totalMarks = input.questions.reduce((total, question) => total + question.marks, 0);
    if (input.questions.some((question) => (question.negativeMarks ?? input.negativeMarking) > question.marks)) {
      throw new HttpError(400, "A question's negative marks cannot exceed its marks.");
    }
    if (input.passingMarks > totalMarks) throw new HttpError(400, "Passing marks cannot exceed total marks.");
    const test = await prisma.test.create({
      data: {
        title: input.title, description: input.description, category: input.category,
        difficulty: input.difficulty, durationMinutes: input.durationMinutes,
        startTime: input.startTime ? new Date(input.startTime) : null,
        endTime: input.endTime ? new Date(input.endTime) : null,
        passingMarks: input.passingMarks, totalMarks, negativeMarking: input.negativeMarking,
        showResults: input.showResults, showExplanations: input.showExplanations, createdById: req.user!.id,
        questions: { create: input.questions.map((question, position) => ({ ...question, negativeMarks: question.negativeMarks ?? input.negativeMarking, position })) }
      }
    });
    res.status(201).json({ test });
  }),
  updateTest: asyncRoute(async (req, res) => {
    const id = uuidSchema.parse(routeParam(req.params.id));
    const input = updateTestSchema.parse(req.body);
    const totalMarks = input.questions.reduce((total, question) => total + question.marks, 0);
    if (input.passingMarks > totalMarks) throw new HttpError(400, "Passing marks cannot exceed total marks.");
    const settings = {
      title: input.title,
      description: input.description,
      category: input.category,
      difficulty: input.difficulty,
      durationMinutes: input.durationMinutes,
      startTime: input.startTime ? new Date(input.startTime) : null,
      endTime: input.endTime ? new Date(input.endTime) : null,
      passingMarks: input.passingMarks,
      negativeMarking: input.negativeMarking,
      showResults: input.showResults,
      showExplanations: input.showExplanations,
      totalMarks
    };
    const questions = input.questions.map((question, position) => ({
      ...question,
      negativeMarks: question.negativeMarks ?? input.negativeMarking,
      position
    }));
    try {
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.test.findUnique({
          where: { id },
          include: { _count: { select: { attempts: true } } }
        });
        if (!existing || existing.isArchived) throw new HttpError(404, "Assessment not found.");
        if (existing._count.attempts > 0) {
          await tx.test.update({ where: { id }, data: { isArchived: true } });
          const revision = await tx.test.create({
            data: {
              ...settings,
              isArchived: false,
              createdById: existing.createdById,
              questions: { create: questions }
            },
            include: { questions: { orderBy: { position: "asc" } } }
          });
          return { test: revision, revisionCreated: true };
        }
        await tx.question.deleteMany({ where: { testId: id } });
        const updated = await tx.test.update({ where: { id }, data: settings });
        for (const question of questions) {
          await tx.question.create({ data: { ...question, testId: id } });
        }
        return {
          test: await tx.test.findUniqueOrThrow({
            where: { id },
            include: { questions: { orderBy: { position: "asc" } } }
          }),
          revisionCreated: false
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      res.json(result);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        throw new HttpError(409, "The assessment changed while it was being saved. Refresh the admin page and try again.");
      }
      throw error;
    }
  }),
  setTestArchived: asyncRoute(async (req, res) => {
    const id = uuidSchema.parse(routeParam(req.params.id));
    const input = z.object({ archived: z.boolean() }).strict().parse(req.body);
    const test = await prisma.test.update({
      where: { id },
      data: { isArchived: input.archived },
      select: { id: true, isArchived: true }
    }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        throw new HttpError(404, "Assessment not found.");
      }
      throw error;
    });
    res.json({ testId: test.id, archived: test.isArchived });
  }),
  deleteTest: asyncRoute(async (req, res) => {
    const id = uuidSchema.parse(routeParam(req.params.id));
    let archived = false;
    try {
      archived = await prisma.$transaction(async (tx) => {
        const test = await tx.test.findUnique({ where: { id }, select: { id: true } });
        if (!test) throw new HttpError(404, "Assessment not found.");
        const attempts = await tx.attempt.count({ where: { testId: id } });
        if (attempts > 0) {
          await tx.test.update({ where: { id }, data: { isArchived: true } });
          return true;
        }
        await tx.test.delete({ where: { id } });
        return false;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        throw new HttpError(409, "The assessment changed while deletion was being checked. Refresh the admin page and try again.");
      }
      throw error;
    }
    res.json({ archived, deleted: !archived });
  })
};
