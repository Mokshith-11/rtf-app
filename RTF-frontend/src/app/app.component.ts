import { CommonModule } from "@angular/common";
import { Component, HostListener, inject, OnDestroy, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { firstValueFrom } from "rxjs";
import { AdminOverview, AdmitCard, ApiService, Assessment, AttemptQuestion, CandidateAssessment, ResultData, User, ViolationEvent } from "./api.service";

type View = "auth" | "dashboard" | "my-assessments" | "history" | "profile" | "admit-card" | "instructions" | "system-check" | "exam" | "result" | "admin";
type QuestionDraft = {
  id?: string;
  questionText: string;
  options: string[];
  correctIndex: number;
  marks: number;
  negativeMarks: number;
  explanation: string;
  topic: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
};
type TestDraft = {
  title: string;
  description: string;
  category: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  durationMinutes: number;
  startTime: string;
  endTime: string;
  passingMarks: number;
  negativeMarking: number;
  showResults: boolean;
  showExplanations: boolean;
  questions: QuestionDraft[];
};
type TestEditDraft = TestDraft;

function createQuestionDraft(): QuestionDraft {
  return { questionText: "", options: ["", "", "", ""], correctIndex: 0, marks: 1, negativeMarks: 0, explanation: "", topic: "", difficulty: "MEDIUM" };
}

function createTestDraft(): TestDraft {
  return {
    title: "", description: "", category: "", difficulty: "MEDIUM",
    durationMinutes: 30, startTime: "", endTime: "", passingMarks: 0, negativeMarking: 0,
    showResults: true, showExplanations: true, questions: [createQuestionDraft()]
  };
}

@Component({
  selector: "rtf-root",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./app.component.html"
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  readonly optionIndexes = [0, 1, 2, 3];
  theme: "dark" | "light" = "dark";
  user: User | null = null;
  view: View = "auth";
  authMode: "login" | "register" | "forgot" | "reset" = "login";
  passwordVisible = false;
  form: Record<string, string> = { name: "", batchNumber: "", email: "", phone: "", password: "", confirmPassword: "" };
  instructionsAccepted = false;
  systemReady = false;
  tests: Assessment[] = [];
  candidateAssessments: CandidateAssessment[] = [];
  admitCard: AdmitCard | null = null;
  selectedTest: Assessment | null = null;
  attemptId = "";
  questions: AttemptQuestion[] = [];
  answers: Record<string, number | null> = {};
  markedForReview = new Set<string>();
  current = 0;
  result: ResultData | null = null;
  adminData: AdminOverview | null = null;
  violationNotice = "";
  studentViolationNotice = "";
  readonly expandedViolationTests = new Set<string>();
  readonly violationEventsByTest: Record<string, ViolationEvent[]> = {};
  readonly violationCountsByTest: Record<string, number> = {};
  readonly violationLoadingByTest: Record<string, boolean> = {};
  showCreateTest = false;
  editingTestId = "";
  editingTestHasAttempts = false;
  testEditDraft: TestEditDraft | null = null;
  testDraft = createTestDraft();
  busy = false;
  savedState = "All changes saved";
  error = "";
  remainingSeconds = 0;
  warning = "";
  authNotice = "";
  private resetToken = "";
  private timer?: ReturnType<typeof setInterval>;
  private violationPollTimer?: ReturnType<typeof setInterval>;
  private violationNoticeTimer?: ReturnType<typeof setTimeout>;
  private studentViolationNoticeTimer?: ReturnType<typeof setTimeout>;
  private violationPollInFlight = false;
  private deadlineAt = 0;
  private saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private get pendingKey(): string { return `rtf-pending-answers:${this.attemptId}`; }

  ngOnInit(): void {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("resetToken");
    if (token) {
      this.resetToken = token;
      this.authMode = "reset";
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    const savedTheme = localStorage.getItem("rtf-theme");
    this.theme = savedTheme === "light" ? "light" : "dark";
    this.applyTheme();
    if (!token) {
      this.api.me().subscribe({
        next: ({ user }) => this.openUser(user),
        error: () => {}
      });
    }
  }
  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.violationPollTimer) clearInterval(this.violationPollTimer);
    if (this.violationNoticeTimer) clearTimeout(this.violationNoticeTimer);
    if (this.studentViolationNoticeTimer) clearTimeout(this.studentViolationNoticeTimer);
    this.saveTimers.forEach(clearTimeout);
  }
  get currentQuestion(): AttemptQuestion | undefined { return this.questions[this.current]; }
  get themeActionLabel(): string { return this.theme === "dark" ? "Switch to light theme" : "Switch to dark theme"; }
  get answeredCount(): number { return Object.values(this.answers).filter((answer) => answer !== null).length; }
  get greetingName(): string { return this.user?.name.split(" ")[0] ?? "there"; }
  get visibleCandidateAssessments(): CandidateAssessment[] {
    return this.view === "history"
      ? this.candidateAssessments.filter((assessment) => assessment.status === "COMPLETED")
      : this.candidateAssessments;
  }
  get registrationPasswordValid(): boolean {
    const password = this.form["password"] ?? "";
    return (password.match(/[A-Za-z]/g)?.length ?? 0) >= 8 &&
      (password.match(/[0-9]/g)?.length ?? 0) >= 4 &&
      /[^A-Za-z0-9\s]/.test(password);
  }
  get resetPasswordsMatch(): boolean {
    return this.form["password"] === this.form["confirmPassword"];
  }
  get correctCount(): number { return this.result?.answers.filter((answer) => answer.isCorrect).length ?? 0; }
  get wrongCount(): number { return this.result?.answers.filter((answer) => answer.selectedIndex !== null && !answer.isCorrect).length ?? 0; }
  get unansweredCount(): number { return this.result?.answers.filter((answer) => answer.selectedIndex === null).length ?? 0; }
  get timeTakenLabel(): string {
    const total = this.result?.timeTakenSeconds ?? 0;
    return `${Math.floor(total / 60)}m ${total % 60}s`;
  }
  get timeLabel(): string {
    const minutes = Math.floor(this.remainingSeconds / 60).toString().padStart(2, "0");
    const seconds = (this.remainingSeconds % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  }
  formatScheduledTime(value: string | null): string {
    if (!value) return "Not configured";
    return `${new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    }).format(new Date(value))} IST`;
  }
  formatDateTime(value: string | null | undefined): string {
    if (!value) return "—";
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value)) + " IST";
  }
  formatDuration(seconds: number | null | undefined): string {
    if (seconds == null) return "—";
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }

  toggleTheme(): void {
    this.theme = this.theme === "dark" ? "light" : "dark";
    localStorage.setItem("rtf-theme", this.theme);
    this.applyTheme();
  }
  togglePasswordVisibility(): void {
    this.passwordVisible = !this.passwordVisible;
  }
  private applyTheme(): void {
    document.documentElement.dataset["theme"] = this.theme;
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", this.theme === "dark" ? "#071522" : "#f2f6f7");
  }

  openUser(user: User): void {
    this.user = user;
    if (user.role === "ADMIN") this.loadAdmin();
    else {
      this.api.currentAttempt().subscribe({
        next: ({ attempt }) => attempt ? this.loadAttempt(attempt.id) : this.loadTests(),
        error: () => this.loadTests()
      });
    }
  }
  submitAuth(): void {
    this.error = "";
    this.authNotice = "";
    if (this.authMode === "reset") {
      this.submitPasswordReset();
      return;
    }
    if (this.authMode === "forgot") {
      this.busy = true;
      this.api.requestPasswordReset(this.form["email"] ?? "").subscribe({
        next: ({ message }) => { this.busy = false; this.authNotice = message; },
        error: (error: Error) => { this.busy = false; this.error = error.message; }
      });
      return;
    }
    if (this.authMode === "register" && !this.registrationPasswordValid) {
      this.error = "Password must contain at least 8 letters, 4 numbers, and 1 special character.";
      return;
    }
    this.busy = true;
    const request = this.authMode === "login" ? this.api.login(this.form) : this.api.register(this.form);
    request.subscribe({
      next: ({ user }) => { this.busy = false; this.openUser(user); },
      error: (error: Error) => { this.busy = false; this.error = error.message; }
    });
  }
  submitPasswordReset(): void {
    this.error = "";
    this.authNotice = "";
    if (!this.resetPasswordsMatch) {
      this.error = "The passwords do not match.";
      return;
    }
    this.busy = true;
    this.api.resetPassword(this.resetToken, this.form["password"] ?? "").subscribe({
      next: ({ message }) => {
        this.busy = false;
        this.authMode = "login";
        this.resetToken = "";
        this.form["password"] = "";
        this.form["confirmPassword"] = "";
        this.authNotice = message;
      },
      error: (error: Error) => { this.busy = false; this.error = error.message; }
    });
  }
  signOut(): void {
    this.api.logout().subscribe({ complete: () => this.resetUser(), error: () => this.resetUser() });
  }
  private resetUser(): void {
    if (this.violationPollTimer) clearInterval(this.violationPollTimer);
    this.violationPollTimer = undefined;
    if (this.violationNoticeTimer) clearTimeout(this.violationNoticeTimer);
    this.violationNotice = "";
    if (this.studentViolationNoticeTimer) clearTimeout(this.studentViolationNoticeTimer);
    this.studentViolationNotice = "";
    this.user = null;
    this.view = "auth";
    this.result = null;
    this.attemptId = "";
    this.error = "";
  }
  private loadTests(): void {
    this.api.tests().subscribe({
      next: ({ tests }) => { this.tests = tests; this.view = "dashboard"; },
      error: (error: Error) => { this.error = error.message; this.view = "dashboard"; }
    });
  }
  selectTest(test: Assessment): void { this.selectedTest = test; this.view = "instructions"; this.error = ""; }
  showCandidateAssessments(): void { this.loadCandidateAssessments("my-assessments"); }
  showAssessmentHistory(): void { this.loadCandidateAssessments("history"); }
  private loadCandidateAssessments(target: "my-assessments" | "history"): void {
    this.error = "";
    this.api.candidateAssessments().subscribe({
      next: ({ assessments }) => { this.candidateAssessments = assessments; this.view = target; },
      error: (error: Error) => { this.error = error.message; }
    });
  }
  openAdmitCard(testId: string): void {
    this.error = "";
    this.api.admitCard(testId).subscribe({
      next: ({ admitCard }) => { this.admitCard = admitCard; this.view = "admit-card"; },
      error: (error: Error) => { this.error = error.message; }
    });
  }
  printAdmitCard(): void { window.print(); }
  showProfile(): void {
    this.api.me().subscribe({
      next: ({ user }) => { this.user = user; this.view = "profile"; this.error = ""; },
      error: (error: Error) => this.error = error.message
    });
  }
  resumeAssessment(assessment: CandidateAssessment): void {
    if (assessment.status === "IN_PROGRESS" && assessment.attempt) this.loadAttempt(assessment.attempt.id);
  }
  openAssessmentResult(assessment: CandidateAssessment): void {
    if (assessment.status === "COMPLETED" && assessment.attempt && assessment.showResults) {
      this.busy = true;
      this.api.result(assessment.attempt.id).subscribe({
        next: ({ result }) => { this.result = result; this.view = "result"; this.busy = false; },
        error: (error: Error) => { this.error = error.message; this.busy = false; }
      });
    }
  }
  checkSystem(): void {
    this.view = "system-check";
    this.systemReady = false;
    this.error = "";
    this.api.health().subscribe({
      next: () => this.systemReady = "visibilityState" in document && "fetch" in window,
      error: (error: Error) => this.error = error.message
    });
  }
  beginTest(): void {
    if (!this.selectedTest) return;
    this.busy = true;
    this.error = "";
    this.api.start(this.selectedTest.id).subscribe({
      next: ({ attempt }) => this.loadAttempt(attempt.id),
      error: (error: Error) => { this.busy = false; this.error = error.message; }
    });
  }
  private loadAttempt(id: string): void {
    this.attemptId = id;
    this.api.attempt(id).subscribe({
      next: ({ attempt }) => {
        this.questions = attempt.test.questions;
        this.answers = Object.fromEntries(this.questions.map((question) => [question.id, null]));
        for (const answer of attempt.answers ?? []) this.answers[answer.questionId] = answer.selectedIndex;
        this.syncPendingAnswers();
        this.deadlineAt = new Date(attempt.deadline).getTime();
        this.remainingSeconds = Math.max(0, Math.ceil((this.deadlineAt - Date.now()) / 1000));
        this.view = attempt.status === "IN_PROGRESS" ? "exam" : "result";
        if (attempt.status !== "IN_PROGRESS") this.loadResult(id);
        else {
          this.startTimer();
          if (this.remainingSeconds === 0) void this.submitTest();
        }
        this.busy = false;
      },
      error: (error: Error) => { this.busy = false; this.error = error.message; this.loadTests(); }
    });
  }
  private startTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.remainingSeconds = Math.max(0, Math.ceil((this.deadlineAt - Date.now()) / 1000));
      if (this.remainingSeconds === 60) this.warning = "One minute remaining. Review your answers and submit before time expires.";
      if (this.remainingSeconds === 0) void this.submitTest();
    }, 1000);
  }
  choose(index: number): void {
    const question = this.currentQuestion;
    if (!question) return;
    this.answers[question.id] = index;
    this.queueSave(question.id, index);
  }
  clearAnswer(): void {
    const question = this.currentQuestion;
    if (!question) return;
    this.answers[question.id] = null;
    this.queueSave(question.id, null);
  }
  toggleReview(): void {
    const questionId = this.currentQuestion?.id;
    if (!questionId) return;
    if (this.markedForReview.has(questionId)) this.markedForReview.delete(questionId);
    else this.markedForReview.add(questionId);
  }
  private queueSave(questionId: string, selectedIndex: number | null): void {
    this.savedState = "Saving…";
    const pending: Record<string, number | null> = JSON.parse(localStorage.getItem(this.pendingKey) ?? "{}");
    pending[questionId] = selectedIndex;
    localStorage.setItem(this.pendingKey, JSON.stringify(pending));
    const old = this.saveTimers.get(questionId);
    if (old) clearTimeout(old);
    this.saveTimers.set(questionId, setTimeout(() => {
      this.api.saveAnswer(this.attemptId, questionId, selectedIndex).subscribe({
        next: () => {
          const stored: Record<string, number | null> = JSON.parse(localStorage.getItem(this.pendingKey) ?? "{}");
          if (stored[questionId] === selectedIndex) delete stored[questionId];
          localStorage.setItem(this.pendingKey, JSON.stringify(stored));
          this.savedState = Object.keys(stored).length ? "Saving…" : "All changes saved";
        },
        error: () => this.savedState = this.remainingSeconds === 0
          ? "Time expired — reconnect to submit saved answers"
          : "Saved on this device — reconnect to sync"
      });
    }, 250));
  }
  private syncPendingAnswers(): void {
    const pending: Record<string, number | null> = JSON.parse(localStorage.getItem(this.pendingKey) ?? "{}");
    if (Object.keys(pending).length) this.savedState = "Saving…";
    for (const [questionId, selectedIndex] of Object.entries(pending)) {
      if (questionId in this.answers) {
        this.answers[questionId] = selectedIndex;
        this.api.saveAnswer(this.attemptId, questionId, selectedIndex).subscribe({
          next: () => {
            const stored: Record<string, number | null> = JSON.parse(localStorage.getItem(this.pendingKey) ?? "{}");
            if (stored[questionId] === selectedIndex) delete stored[questionId];
            localStorage.setItem(this.pendingKey, JSON.stringify(stored));
            this.savedState = Object.keys(stored).length ? "Saving…" : "All changes saved";
          }
        });
      }
    }
  }
  moveQuestion(step: number): void { this.current = Math.min(this.questions.length - 1, Math.max(0, this.current + step)); }
  async confirmSubmit(): Promise<void> {
    const unanswered = this.questions.length - this.answeredCount;
    if (!window.confirm(`Submit this test now?\n\nAnswered: ${this.answeredCount}\nUnanswered: ${unanswered}\nMarked for review: ${this.markedForReview.size}`)) return;
    this.busy = true;
    this.error = "";
    try {
      await this.persistPendingAnswers();
      await firstValueFrom(this.api.submit(this.attemptId));
      this.loadResult(this.attemptId);
    } catch (error) {
      this.busy = false;
      this.error = error instanceof Error ? error.message : "Submission failed. Check your connection and try again.";
    }
  }
  private async submitTest(): Promise<void> {
    if (!this.attemptId || this.view !== "exam" || this.busy) return;
    this.busy = true;
    if (this.timer) clearInterval(this.timer);
    for (const timeout of this.saveTimers.values()) clearTimeout(timeout);
    try {
      await this.persistPendingAnswers();
      await firstValueFrom(this.api.submit(this.attemptId));
      this.loadResult(this.attemptId);
    } catch (error) {
      if (this.remainingSeconds === 0) {
        this.loadResult(this.attemptId);
        return;
      }
      this.busy = false;
      this.error = error instanceof Error ? error.message : "Submission failed. Check your connection and try again.";
    }
  }
  private async persistPendingAnswers(): Promise<void> {
    await Promise.all(Object.entries(this.answers).map(([questionId, selectedIndex]) =>
      firstValueFrom(this.api.saveAnswer(this.attemptId, questionId, selectedIndex))
    ));
    localStorage.removeItem(this.pendingKey);
  }
  private loadResult(id: string): void {
    this.api.result(id).subscribe({
      next: ({ result }) => { this.result = result; this.view = "result"; this.busy = false; },
      error: (error: Error) => { this.busy = false; this.error = error.message; }
    });
  }
  @HostListener("document:visibilitychange")
  onVisibilityChange(): void {
    if (document.hidden && this.view === "exam" && this.attemptId) {
      this.api.violation(this.attemptId).subscribe({
        next: () => {
          this.warning = "You have left the test window. Your activity has been recorded.";
          this.studentViolationNotice = "You left the assessment page. This activity has been recorded for your assessment supervisor.";
          if (this.studentViolationNoticeTimer) clearTimeout(this.studentViolationNoticeTimer);
          this.studentViolationNoticeTimer = setTimeout(() => this.studentViolationNotice = "", 10_000);
        },
        error: () => {
          this.warning = "You have left the test window. The activity could not be recorded; check your connection.";
          this.studentViolationNotice = "We could not record this activity because the connection failed. Please return to the assessment and check your connection.";
          if (this.studentViolationNoticeTimer) clearTimeout(this.studentViolationNoticeTimer);
          this.studentViolationNoticeTimer = setTimeout(() => this.studentViolationNotice = "", 10_000);
        }
      });
    }
  }
  @HostListener("window:online")
  onConnectionRestored(): void {
    if (this.attemptId && this.view === "exam") {
      this.syncPendingAnswers();
      if (this.remainingSeconds === 0) void this.submitTest();
    }
  }
  private loadAdmin(): void {
    this.api.overview().subscribe({
      next: (data) => {
        this.adminData = data;
        this.view = "admin";
        if (!this.violationPollTimer) {
          this.violationPollTimer = setInterval(() => this.refreshViolationActivity(), 10_000);
        }
      },
      error: (error: Error) => { this.error = error.message; }
    });
  }
  private refreshViolationActivity(): void {
    if (this.view !== "admin" || this.user?.role !== "ADMIN" || this.violationPollInFlight) return;
    this.violationPollInFlight = true;
    this.api.violationActivity().subscribe({
      next: ({ count, violationEvents }) => {
        const previousCount = this.adminData?.metrics.violations ?? count;
        this.adminData = this.adminData
          ? {
              ...this.adminData,
              metrics: { ...this.adminData.metrics, violations: count },
              violationEvents
            }
          : this.adminData;
        if (count > previousCount) {
          const newEvents = count - previousCount;
          this.violationNotice = `${newEvents} new activity alert${newEvents === 1 ? "" : "s"} recorded. ${count} total.`;
          if (this.violationNoticeTimer) clearTimeout(this.violationNoticeTimer);
          this.violationNoticeTimer = setTimeout(() => this.violationNotice = "", 8_000);
        }
        this.violationPollInFlight = false;
      },
      error: (error: Error) => {
        this.error = `Could not refresh activity alerts: ${error.message}`;
        this.violationPollInFlight = false;
      }
    });
  }
  scrollToViolationActivity(): void {
    document.getElementById("assessment-activity-alerts")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  toggleTestViolationActivity(testId: string): void {
    if (this.expandedViolationTests.has(testId)) {
      this.expandedViolationTests.delete(testId);
      return;
    }
    this.expandedViolationTests.add(testId);
    if (this.violationEventsByTest[testId] || this.violationLoadingByTest[testId]) return;
    this.violationLoadingByTest[testId] = true;
    this.api.testViolationActivity(testId).subscribe({
      next: (activity) => {
        this.violationCountsByTest[testId] = activity.count;
        this.violationEventsByTest[testId] = activity.violationEvents;
        this.violationLoadingByTest[testId] = false;
      },
      error: (error: Error) => {
        this.violationLoadingByTest[testId] = false;
        this.error = `Could not load activity for this assessment: ${error.message}`;
      }
    });
  }
  hasTestViolationCount(testId: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.violationCountsByTest, testId);
  }
  addQuestion(): void {
    if (this.testDraft.questions.length < 100) this.testDraft.questions.push(createQuestionDraft());
  }
  removeQuestion(index: number): void {
    if (this.testDraft.questions.length > 1) this.testDraft.questions.splice(index, 1);
  }
  createAssessment(): void {
    if (this.testDraft.startTime && this.testDraft.endTime &&
        this.istDateTimeToIso(this.testDraft.startTime) >= this.istDateTimeToIso(this.testDraft.endTime)) {
      this.error = "The test end time must be later than its start time.";
      return;
    }
    this.busy = true;
    this.error = "";
    const payload = {
      ...this.testDraft,
      startTime: this.testDraft.startTime ? this.istDateTimeToIso(this.testDraft.startTime) : null,
      endTime: this.testDraft.endTime ? this.istDateTimeToIso(this.testDraft.endTime) : null
    };
    this.api.createTest(payload).subscribe({
      next: () => {
        this.busy = false;
        this.showCreateTest = false;
        this.testDraft = createTestDraft();
        this.loadAdmin();
      },
      error: (error: Error) => { this.busy = false; this.error = error.message; }
    });
  }
  beginEditTest(test: AdminOverview["tests"][number]): void {
    this.error = "";
    this.editingTestId = test.id;
    this.editingTestHasAttempts = test.attendance.length > 0;
    this.testEditDraft = {
      title: test.title,
      description: test.description,
      category: test.category,
      difficulty: test.difficulty,
      durationMinutes: test.durationMinutes,
      startTime: test.startTime ? this.isoToIstDateTime(test.startTime) : "",
      endTime: test.endTime ? this.isoToIstDateTime(test.endTime) : "",
      passingMarks: test.passingMarks,
      negativeMarking: test.negativeMarking,
      showResults: test.showResults,
      showExplanations: test.showExplanations,
      questions: test.questions.map((question) => ({
        id: question.id,
        questionText: question.questionText,
        options: [...question.options],
        correctIndex: question.correctIndex,
        marks: question.marks,
        negativeMarks: question.negativeMarks,
        explanation: question.explanation ?? "",
        topic: question.topic ?? "",
        difficulty: question.difficulty
      }))
    };
  }
  addEditQuestion(): void {
    if (this.testEditDraft && this.testEditDraft.questions.length < 100) this.testEditDraft.questions.push(createQuestionDraft());
  }
  removeEditQuestion(index: number): void {
    if (this.testEditDraft && this.testEditDraft.questions.length > 1) this.testEditDraft.questions.splice(index, 1);
  }
  moveEditQuestion(index: number, step: number): void {
    const questions = this.testEditDraft?.questions;
    const target = index + step;
    if (!questions || target < 0 || target >= questions.length) return;
    [questions[index], questions[target]] = [questions[target], questions[index]];
  }
  cancelEditTest(): void {
    this.editingTestId = "";
    this.editingTestHasAttempts = false;
    this.testEditDraft = null;
  }
  saveTestEdits(): void {
    const draft = this.testEditDraft;
    if (!draft || !this.editingTestId) return;
    if (draft.startTime && draft.endTime && this.istDateTimeToIso(draft.startTime) >= this.istDateTimeToIso(draft.endTime)) {
      this.error = "The test end time must be later than its start time.";
      return;
    }
    this.busy = true;
    this.error = "";
    const payload = {
      ...draft,
      questions: draft.questions.map(({ questionText, options, correctIndex, marks, negativeMarks, explanation, topic, difficulty }) => ({
        questionText, options, correctIndex, marks, negativeMarks, explanation, topic, difficulty
      })),
      startTime: draft.startTime ? this.istDateTimeToIso(draft.startTime) : null,
      endTime: draft.endTime ? this.istDateTimeToIso(draft.endTime) : null
    };
    this.api.updateTest(this.editingTestId, payload).subscribe({
      next: ({ revisionCreated }) => {
        this.busy = false;
        this.authNotice = revisionCreated
          ? "Assessment corrected. Existing candidate attempts are preserved in the archived version; the corrected version is ready for future attempts."
          : "Assessment updated.";
        this.cancelEditTest();
        this.loadAdmin();
      },
      error: (error: Error) => { this.busy = false; this.error = error.message; }
    });
  }
  deleteAssessment(test: AdminOverview["tests"][number]): void {
    if (!window.confirm(`Permanently delete "${test.title}"?\n\nThis assessment has no candidate attempts.`)) return;
    this.busy = true;
    this.error = "";
    this.api.deleteTest(test.id).subscribe({
      next: ({ archived, deleted }) => {
        this.busy = false;
        this.authNotice = archived
          ? "The assessment has candidate attempts, so it was archived instead. Existing history is preserved."
          : deleted ? "Assessment deleted." : "Assessment was not deleted.";
        this.loadAdmin();
      },
      error: (error: Error) => { this.busy = false; this.error = error.message; }
    });
  }
  setAssessmentArchived(test: AdminOverview["tests"][number], archived: boolean): void {
    const action = archived ? "archive" : "restore";
    const impact = archived
      ? "Candidates will not be able to start new attempts. Existing attempts and results will be preserved."
      : "Candidates will be able to access it again when its schedule allows.";
    if (!window.confirm(`Are you sure you want to ${action} "${test.title}"?\n\n${impact}`)) return;
    this.busy = true;
    this.error = "";
    this.api.setTestArchived(test.id, archived).subscribe({
      next: () => {
        this.busy = false;
        this.authNotice = archived
          ? "Assessment archived; candidate history is preserved."
          : "Assessment restored and available according to its schedule.";
        this.loadAdmin();
      },
      error: (error: Error) => { this.busy = false; this.error = error.message; }
    });
  }
  private istDateTimeToIso(value: string): string {
    return new Date(`${value}:00+05:30`).toISOString();
  }
  private isoToIstDateTime(value: string): string {
    return new Date(new Date(value).getTime() + 330 * 60_000).toISOString().slice(0, 16);
  }
  backToDashboard(): void { this.error = ""; this.result = null; this.attemptId = ""; this.loadTests(); }
  goHome(): void {
    if (!this.user || this.view === "exam") return;
    if (this.user?.role === "ADMIN") this.loadAdmin();
    else this.backToDashboard();
  }
}
