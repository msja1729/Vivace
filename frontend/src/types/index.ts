export type Role = "student" | "instructor";

export interface User {
  id: string;
  name: string;
  email: string; // Microsoft school account
  role: Role | null; // null until the user picks a role during registration
}

export interface ClassRoom {
  id: string;
  name: string;
  subject: string;
  description: string;
  joinCode: string | null; // only sent to the class staff (owner and TAs)
  instructorId: string;
  instructorName: string;
  memberCount: number; // students (TAs not counted)
  createdAt: string;
  myRole: ClassRole;
}

/** owner = created the class; ta = teaching assistant with instructor powers; student = joined with the code */
export type ClassRole = "owner" | "ta" | "student";

export const isStaff = (cls: ClassRoom) => cls.myRole === "owner" || cls.myRole === "ta";

export interface CreateClassInput {
  name: string;
  subject: string;
  description: string;
}

export interface Person {
  id: string;
  name: string;
  email: string;
}

export interface Member extends Person {
  joinedAt: string;
}

export interface TA extends Person {
  addedAt: string;
}

// ---------- Files ----------

export type FileKind =
  | "submission" // a file a student turned in
  | "resume" // older submissions (fixed resume slot)
  | "transcript" // older submissions (fixed transcript slot)
  | "viva_instructions"
  | "material"
  | "feedback"
  | "viva_feedback";

export interface StoredFile {
  id: string;
  name: string;
  kind: FileKind;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  uploaderName: string;
  context: string | null; // e.g. "Resume collection · Asha Rao" or a viva title
}

// ---------- Assignments (resume collection) ----------

export interface AssignmentInput {
  title: string;
  instructions: string;
  deadline: string; // ISO with timezone
  graded: boolean;
  totalMarks: number | null; // set when graded
}

export interface Assignment extends AssignmentInput {
  id: string;
  classId: string;
  createdAt: string;
  isOpen: boolean;
  totalStudents: number;
  submittedCount: number; // includes late
  lateCount: number;
  missingCount: number;
  returnedCount: number; // returned with marks / feedback
  averageMarks: number | null; // graded assignments only
}

export type SubmissionStatus = "submitted" | "late" | "missing";

export interface Submission {
  id: string;
  submittedAt: string;
  isLate: boolean;
  githubLinks: string[];
  note: string;
  files: StoredFile[]; // the student's uploads
  marks: number | null;
  feedback: string;
  returnedAt: string | null;
  feedbackFiles: StoredFile[]; // attached by staff when returning
}

/** What a student sees of an assignment. */
export interface StudentAssignment {
  id: string;
  classId: string;
  title: string;
  instructions: string;
  deadline: string;
  isOpen: boolean; // can still turn in
  graded: boolean;
  totalMarks: number | null;
  myStatus: "assigned" | "turned_in" | "returned" | "missed";
  submission: Submission | null;
}

export interface AssignmentDetail extends Assignment {
  students: { student: Person; status: SubmissionStatus; submission: Submission | null }[];
}

// ---------- Vivas ----------

export type VivaAudience = "whole_class" | "selected";
/** staff: the instructor and TAs interview students one-to-one in slots. ai: the AI examiner (not built yet). */
export type VivaConductor = "staff" | "ai";
export type VivaPhase = "draft" | "upcoming" | "live" | "closed";

export type SummaryStat =
  | "average_score"
  | "score_distribution"
  | "criteria_breakdown"
  | "completion_rate"
  | "common_strengths"
  | "common_gaps"
  | "proctoring_flags"
  | "top_and_bottom";

export interface Criterion {
  name: string;
  description: string;
  weight: number;
}

export interface VivaSummary {
  id: string;
  title: string;
  audience: VivaAudience;
  conductedBy: VivaConductor;
  status: "draft" | "scheduled";
  phase: VivaPhase;
  startsAt: string | null;
  joinClosesAt: string | null; // students who haven't opened the viva by now miss it
  endsAt: string | null;
  studentCount: number;
  createdAt: string;
}

export interface VivaSetup {
  title: string;
  assignmentId: string | null;
  studentIds: string[];
  startsAt: string | null; // the end time follows from the join window + duration
  durationMinutes: number;
  conductedBy: VivaConductor;
  breakMinutes: number;
  examinerIds: string[];
  /** Who interviews whom; each examiner takes their students in this order. */
  allocation: { studentId: string; examinerId: string }[];
  interviewInstructions: string;
  evaluationCriteria: Criterion[];
  reportFormat: string;
  summaryStats: SummaryStat[];
}

export interface Examiner extends Person {
  isOwner: boolean;
}

export interface VivaSlot {
  student: Person;
  examinerId: string;
  position: number;
  startsAt: string | null;
  joinClosesAt: string | null;
  endsAt: string | null;
}

export interface Viva extends VivaSummary {
  classId: string;
  assignmentId: string | null;
  assignmentTitle: string | null;
  durationMinutes: number;
  breakMinutes: number;
  joinWindowMinutes: number;
  students: Person[];
  staff: Examiner[];
  examinerIds: string[];
  slots: VivaSlot[];
  unallocated: Person[];
  interviewInstructions: string;
  evaluationCriteria: Criterion[];
  reportFormat: string;
  summaryStats: SummaryStat[];
  files: StoredFile[];
  updatedAt: string;
}

export interface VivaFeedback {
  feedback: string;
  files: StoredFile[];
  releasedAt: string | null;
  marks?: ReleasedMarks | null; // sent with the result: overall + per-criterion breakdown
  aiReport?: AiReport | null; // the AI's report, as sent
}

export interface ReleasedMarks {
  score: number;
  outOf: number;
  criteria: { name: string; weight: number | null; score: number | null }[];
}

export type Understanding = "strong" | "partial" | "weak" | "not_demonstrated";

/** The AI's written assessment of one viva (backend: live/evaluation/report.py). */
export interface AiReport {
  verdict: "strong" | "good" | "partial" | "weak" | "insufficient_evidence";
  summary: string;
  projects: { name: string; understanding: Understanding; comment: string; evidence: string }[];
  criteria: { name: string; score: number | null; comment: string }[];
  strengths: string[];
  gaps: string[];
  claimsVsShown: string[];
  nextSteps: string[];
}

/** What a student handed in for the viva's linked assignment. */
export interface StudentWork {
  assignmentTitle: string | null;
  submittedAt: string | null;
  files: StoredFile[];
  links: string[];
  note: string;
}

/** What a student sees of a viva: timing and their own status / feedback. */
export interface StudentViva {
  id: string;
  classId: string;
  title: string;
  conductedBy: VivaConductor;
  startsAt: string; // staff vivas: this student's own slot
  joinClosesAt: string;
  endsAt: string;
  durationMinutes: number;
  joinWindowMinutes: number;
  myStatus: "upcoming" | "open" | "in_progress" | "attended" | "missed";
  joinedAt: string | null;
  myEndsAt: string | null;
  examiner: Person | null;
  sessionId: string | null;
  feedback: VivaFeedback | null;
}

export interface VivaStats {
  vivaId: string;
  phase: VivaPhase;
  summaryStats: SummaryStat[];
  assignedCount: number;
  resumesReady: number;
  joinedCount: number;
  missedCount: number;
  completedCount: number;
  joinWindowMinutes: number;
  averageScore: number | null;
  criteriaAverages: { name: string; average: number }[];
  flagCounts: Record<string, number>;
  students: {
    student: Person;
    resumeStatus: SubmissionStatus | "not_linked";
    vivaStatus: "not_started" | "joined" | "missed" | "completed";
    joinedAt: string | null;
    examiner: Person | null;
    slotStartsAt: string | null;
    sessionId: string | null;
    sessionStatus: SessionState | null;
    score: number | null;
    riskScore: number | null;
    masteryScore: number | null;
    flags: number;
    feedback: VivaFeedback | null;
  }[];
}

// ---------- Live vivas (staff-run) ----------

export type SessionState = "waiting" | "live" | "ended";

export interface QueueRow {
  student: Person;
  examiner: Person;
  position: number;
  startsAt: string;
  joinClosesAt: string;
  joinedAt: string | null;
  missed: boolean;
  sessionId: string | null;
  sessionStatus: SessionState | null;
  studentOnline: boolean;
  score: number | null;
}

export interface ExaminerQueue {
  vivaId: string;
  title: string;
  phase: VivaPhase;
  durationMinutes: number;
  canConductAll: boolean;
  rows: QueueRow[];
}

export interface IntegrityEvent {
  id: number;
  type: string;
  label: string;
  startTs: number; // seconds since the session opened
  endTs: number;
  confidence: number;
  detail: string;
  hasSnapshot: boolean;
  open?: boolean; // live only: still happening
}

/** The evaluation engine's notes on one student answer (stored on its first turn). */
export interface AnswerAnalysis {
  typed?: boolean; // examiner turns: typed in, not spoken
  question?: string;
  turnIds?: number[];
  latencyS?: number | null;
  wpm?: number | null;
  fillerRate?: number;
  longPauses?: number;
  fluency?: number;
  correctness?: number;
  depth?: number;
  similarity?: number | null;
  memorizationFlag?: boolean;
  reasoning?: string;
  strengths?: string[];
  weakPoints?: string[];
  referenceAnswer?: string;
  criteria?: { name: string; tested: boolean; score: number }[];
  mastery?: number | null;
  note?: string;
}

export interface Turn {
  id: number;
  speaker: "examiner" | "student";
  text: string;
  startTs: number;
  endTs: number;
  analysis: AnswerAnalysis | null;
}

export interface CriterionResult {
  name: string;
  score: number | null;
}

export interface SessionReport {
  id: string;
  vivaId: string;
  vivaTitle: string;
  classId: string;
  student: Person;
  examiner: Person | null;
  status: SessionState;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  riskScore: number;
  riskBand: "low" | "medium" | "high";
  masteryScore: number | null;
  score: number | null;
  criteriaScores: CriterionResult[];
  suggestedCriteriaScores: CriterionResult[];
  notes: string;
  evaluationCriteria: Criterion[];
  reportFormat: string;
  calibrated: boolean;
  events: IntegrityEvent[];
  turns: Turn[];
  qa: { question: string; answer: string }[];
  topics: TopicGrade[];
  integrity: { level: "clear" | "minor" | "concerns" | "unverified"; text: string };
  aiReport: AiReport | null;
  sentToStudent: VivaFeedback | null;
}

export interface Suggestion {
  question: string;
  kind: "opening" | "follow_up" | "different";
  why: string;
  criterion: string;
}

/** The Co-Pilot's judgement of one topic (a running check, or the final grade). */
export interface TopicAssessment {
  ready: boolean;
  confidence: "high" | "medium" | "low";
  level: Understanding;
  score: number;
  summary: string;
  evidence: string;
  missing: string;
  answers: number;
  limited?: boolean; // final grade given before the AI was confident
}

/** One thing in the student's work that can be tested (a project, experience, skill, claim). */
export interface CopilotTopic {
  id: string;
  name: string;
  kind: "project" | "experience" | "skill" | "claim" | "course";
  summary: string;
  status: "new" | "started" | "current" | "ready" | "graded";
  asked: number;
  ready: boolean;
  assessment: TopicAssessment | null;
  grade: TopicAssessment | null;
}

/** The Co-Pilot, topic by topic. */
export interface CopilotState {
  topics: CopilotTopic[];
  current: string | null;
  suggestions: Suggestion[];
  mode: Suggestion["kind"] | null;
  busy: "topics" | "questions" | null;
  error: string | null;
  notice: string | null; // "Ready to grade …"
}

/** A topic grade in the report. */
export interface TopicGrade {
  name: string;
  kind: string;
  level: Understanding;
  score: number;
  summary: string;
  evidence: string;
  limited: boolean;
  answers: number;
}

/** An instructor's own AI for their vivas. The key itself is never sent back, only its last 4 characters. */
export interface AiSettings {
  provider: "gemini" | "claude" | null;
  model: string | null;
  keyHint: string | null;
  serverDefault: boolean;
  models: Record<string, string[]>;
}

/** What the proctoring sees right now (null = no recent frames from the student). */
export interface VisionStatus {
  faces: number;
  persons: number | null;
  gaze: "screen" | "away" | "up" | null;
  objects: string[];
}

export interface EngineStatus {
  label: string;
  state: "ready" | "not_loaded" | "error";
  detail: string;
}
