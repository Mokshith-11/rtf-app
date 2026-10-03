import { HttpClient } from "@angular/common/http";
import { inject, Injectable } from "@angular/core";
import { Observable } from "rxjs";

export interface User {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "CANDIDATE";
  batchNumber?: string | null;
  phone?: string | null;
  createdAt?: string;
}

export interface Assessment {
  id: string;
  title: string;
  description: string;
  category: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  durationMinutes: number;
  startTime?: string | null;
  endTime?: string | null;
  status?: "DRAFT" | "SCHEDULED" | "ACTIVE" | "CLOSED" | "UPCOMING" | "IN_PROGRESS" | "COMPLETED";
  negativeMarking?: number;
  showResults?: boolean;
  totalMarks: number;
  passingMarks: number;
  questionCount: number;
}

export interface CandidateAssessment extends Assessment {
  status: "UPCOMING" | "ACTIVE" | "CLOSED" | "IN_PROGRESS" | "COMPLETED";
  attempt: {
    id: string;
    status: string;
    startedAt: string;
    submittedAt: string | null;
    score: number | null;
    percentage: number | null;
    timeTakenSeconds: number | null;
  } | null;
}

export interface AdmitCard {
  candidate: {
    id: string;
    candidateId: string;
    name: string;
    email: string;
    phone: string | null;
    batchNumber: string | null;
  };
  assessment: {
    id: string;
    title: string;
    category: string;
    difficulty: "EASY" | "MEDIUM" | "HARD";
    description: string;
    questionCount: number;
    totalMarks: number;
    passingMarks: number;
    negativeMarking: number;
    durationMinutes: number;
    startTime: string;
    endTime: string | null;
    reportingTime: string;
  };
  instructions: string[];
}

export interface AttemptQuestion {
  id: string;
  questionText: string;
  options: string[];
  marks: number;
  position: number;
}

export interface AttemptDetails {
  id: string;
  status: string;
  deadline: string;
  test: { id: string; title: string; durationMinutes: number; totalMarks: number; questions: AttemptQuestion[] };
  answers: Array<{ questionId: string; selectedIndex: number | null }>;
}

export interface ResultData {
  attemptId: string;
  testTitle: string;
  score: number | null;
  totalMarks: number;
  percentage: number | null;
  passed: boolean;
  rank: number;
  status: string;
  startedAt: string;
  submittedAt: string;
  timeTakenSeconds: number;
  answers: Array<{
    questionId: string;
    questionText: string;
    options: string[];
    selectedIndex: number | null;
    correctIndex: number;
    isCorrect: boolean;
    marksAwarded: number;
    explanation: string | null;
  }>;
}

export interface SubmitResult {
  id: string;
  status: string;
  score: number | null;
  percentage: number | null;
  passed: boolean;
  submittedAt: string;
  timeTakenSeconds: number;
}

export interface AdminOverview {
  metrics: { candidates: number; tests: number; activeTests: number; completedAttempts: number; averageScore: number; passRate: number; violations: number };
  violationEvents: Array<{
    id: string;
    type: string;
    details: string | null;
    createdAt: string;
    candidateName: string;
    candidateEmail: string;
    batchNumber: string | null;
    testId: string;
    testTitle: string;
    attemptId: string;
  }>;
  tests: Array<{
    id: string;
    title: string;
    category: string;
    difficulty: "EASY" | "MEDIUM" | "HARD";
    description: string;
    durationMinutes: number;
    startTime: string | null;
    endTime: string | null;
    passingMarks: number;
    negativeMarking: number;
    showResults: boolean;
    showExplanations: boolean;
    status: "DRAFT" | "SCHEDULED" | "ACTIVE" | "CLOSED" | "ARCHIVED";
    questionCount: number;
    totalMarks: number;
    questions: Array<{
      id: string;
      questionText: string;
      options: string[];
      correctIndex: number;
      marks: number;
      negativeMarks: number;
      explanation: string | null;
      topic: string | null;
      difficulty: "EASY" | "MEDIUM" | "HARD";
      position: number;
    }>;
    attendance: Array<{ name: string; batchNumber: string | null; status: string; joinedAt: string | null; submittedAt: string | null }>;
    results: Array<{ name: string; batchNumber: string | null; score: number | null; status: string }>;
  }>;
}

export interface ViolationEvent {
  id: string;
  type: string;
  details: string | null;
  createdAt: string;
  candidateName: string;
  candidateEmail: string;
  batchNumber: string | null;
  testId: string;
  testTitle: string;
  attemptId: string;
}

@Injectable({ providedIn: "root" })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = "/api";
  private readonly options = { withCredentials: true };

  health(): Observable<{ status: string }> { return this.http.get<{ status: string }>(`${this.base}/health`); }
  register(body: object): Observable<{ user: User }> {
    return this.http.post<{ user: User }>(`${this.base}/auth/register`, body, this.options);
  }
  login(body: object): Observable<{ user: User }> {
    return this.http.post<{ user: User }>(`${this.base}/auth/login`, body, this.options);
  }
  requestPasswordReset(email: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.base}/auth/forgot-password`, { email });
  }
  resetPassword(token: string, password: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.base}/auth/reset-password`, { token, password });
  }
  me(): Observable<{ user: User }> { return this.http.get<{ user: User }>(`${this.base}/auth/me`, this.options); }
  logout(): Observable<void> { return this.http.post<void>(`${this.base}/auth/logout`, {}, this.options); }
  currentAttempt(): Observable<{ attempt: { id: string; status: string } | null }> {
    return this.http.get<{ attempt: { id: string; status: string } | null }>(`${this.base}/attempts/current`, this.options);
  }
  tests(): Observable<{ tests: Assessment[] }> { return this.http.get<{ tests: Assessment[] }>(`${this.base}/tests`, this.options); }
  candidateAssessments(): Observable<{ assessments: CandidateAssessment[] }> {
    return this.http.get<{ assessments: CandidateAssessment[] }>(`${this.base}/candidate/assessments`, this.options);
  }
  admitCard(testId: string): Observable<{ admitCard: AdmitCard }> {
    return this.http.get<{ admitCard: AdmitCard }>(`${this.base}/admit-cards/${testId}`, this.options);
  }
  test(id: string): Observable<{ test: Assessment }> { return this.http.get<{ test: Assessment }>(`${this.base}/tests/${id}`, this.options); }
  start(testId: string): Observable<{ attempt: { id: string } }> {
    return this.http.post<{ attempt: { id: string } }>(`${this.base}/attempts`, { testId }, this.options);
  }
  attempt(id: string): Observable<{ attempt: AttemptDetails }> {
    return this.http.get<{ attempt: AttemptDetails }>(`${this.base}/attempts/${id}`, this.options);
  }
  saveAnswer(id: string, questionId: string, selectedIndex: number | null): Observable<unknown> {
    return this.http.put(`${this.base}/attempts/${id}/answers/${questionId}`, { selectedIndex }, this.options);
  }
  violation(id: string): Observable<unknown> {
    return this.http.post(`${this.base}/attempts/${id}/violations`, { type: "TAB_HIDDEN" }, this.options);
  }
  submit(id: string): Observable<{ result: SubmitResult }> {
    return this.http.post<{ result: SubmitResult }>(`${this.base}/attempts/${id}/submit`, {}, this.options);
  }
  result(id: string): Observable<{ result: ResultData }> {
    return this.http.get<{ result: ResultData }>(`${this.base}/results/${id}`, this.options);
  }
  overview(): Observable<AdminOverview> { return this.http.get<AdminOverview>(`${this.base}/admin/overview`, this.options); }
  violationActivity(): Observable<{ count: number; violationEvents: AdminOverview["violationEvents"] }> {
    return this.http.get<{ count: number; violationEvents: AdminOverview["violationEvents"] }>(`${this.base}/admin/violation-activity`, this.options);
  }
  testViolationActivity(testId: string): Observable<{ testId: string; count: number; violationEvents: ViolationEvent[] }> {
    return this.http.get<{ testId: string; count: number; violationEvents: ViolationEvent[] }>(`${this.base}/admin/tests/${testId}/violations`, this.options);
  }
  createTest(body: object): Observable<{ test: Assessment }> {
    return this.http.post<{ test: Assessment }>(`${this.base}/admin/tests`, body, this.options);
  }
  updateTest(id: string, body: object): Observable<{ test: Assessment; revisionCreated: boolean }> {
    return this.http.put<{ test: Assessment; revisionCreated: boolean }>(`${this.base}/admin/tests/${id}`, body, this.options);
  }
  setTestArchived(id: string, archived: boolean): Observable<{ testId: string; archived: boolean }> {
    return this.http.patch<{ testId: string; archived: boolean }>(`${this.base}/admin/tests/${id}/archive`, { archived }, this.options);
  }
  deleteTest(id: string): Observable<{ archived: boolean; deleted: boolean }> {
    return this.http.delete<{ archived: boolean; deleted: boolean }>(`${this.base}/admin/tests/${id}`, this.options);
  }
}
