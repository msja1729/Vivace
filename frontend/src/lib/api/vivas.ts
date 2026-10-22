// Vivas: set up, schedule and review AI vivas. See backend/app/api/routes/vivas.py.

import type {
  CriterionResult,
  EngineStatus,
  ExaminerQueue,
  SessionReport,
  StoredFile,
  StudentViva,
  StudentWork,
  Viva,
  VivaAudience,
  VivaFeedback,
  VivaSetup,
  VivaStats,
  VivaSummary,
} from "@/types";
import { readSession } from "@/lib/auth/session";
import { api, API_URL, ApiError } from "./client";

const enc = encodeURIComponent;

export function listVivas(classId: string): Promise<VivaSummary[]> {
  return api(`/classes/${enc(classId)}/vivas`);
}

/** Creates a draft; the instructor fills in the rest in Setup. */
export function createViva(classId: string, audience: VivaAudience): Promise<Viva> {
  return api(`/classes/${enc(classId)}/vivas`, { method: "POST", body: { audience } });
}

export function getViva(id: string): Promise<Viva> {
  return api(`/vivas/${enc(id)}`);
}

export function saveViva(id: string, setup: VivaSetup): Promise<Viva> {
  return api(`/vivas/${enc(id)}`, { method: "PUT", body: setup });
}

export function scheduleViva(id: string): Promise<Viva> {
  return api(`/vivas/${enc(id)}/schedule`, { method: "POST" });
}

export function unscheduleViva(id: string): Promise<Viva> {
  return api(`/vivas/${enc(id)}/unschedule`, { method: "POST" });
}

export function deleteViva(id: string): Promise<void> {
  return api(`/vivas/${enc(id)}`, { method: "DELETE" });
}

export function uploadVivaFiles(id: string, files: File[]): Promise<StoredFile[]> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  return api(`/vivas/${enc(id)}/files`, { method: "POST", body: form });
}

export function getVivaStats(id: string): Promise<VivaStats> {
  return api(`/vivas/${enc(id)}/stats`);
}

/** Staff: send (or update) a student's viva feedback / report, with optional files. */
export function sendVivaFeedback(
  vivaId: string,
  studentId: string,
  input: { feedback: string; attachments: File[] },
): Promise<VivaFeedback> {
  const form = new FormData();
  form.append("feedback", input.feedback);
  input.attachments.forEach((f) => form.append("attachments", f));
  return api(`/vivas/${enc(vivaId)}/students/${enc(studentId)}/feedback`, { method: "PUT", body: form });
}

// ---------- Student ----------

export function listMyVivas(classId: string): Promise<StudentViva[]> {
  return api(`/classes/${enc(classId)}/my-vivas`);
}

export function getMyViva(id: string): Promise<StudentViva> {
  return api(`/vivas/${enc(id)}/mine`);
}

/** Open the viva. Only allowed within the join window after the start time. */
export function joinViva(id: string): Promise<{ vivaId: string; joinedAt: string; endsAt: string }> {
  return api(`/vivas/${enc(id)}/join`, { method: "POST" });
}

// ---------- Live vivas (staff-run) ----------

/** Staff: my students in slot order (the class owner sees every examiner's queue). */
export function getExaminerQueue(vivaId: string): Promise<ExaminerQueue> {
  return api(`/vivas/${enc(vivaId)}/queue`);
}

export function getSessionReport(sessionId: string): Promise<SessionReport> {
  return api(`/viva-sessions/${enc(sessionId)}`);
}

export function endSession(sessionId: string): Promise<SessionReport> {
  return api(`/viva-sessions/${enc(sessionId)}/end`, { method: "POST" });
}

export function saveSessionResult(
  sessionId: string,
  result: { score: number; criteriaScores: CriterionResult[]; notes: string },
): Promise<SessionReport> {
  return api(`/viva-sessions/${enc(sessionId)}/result`, { method: "PUT", body: result });
}

/** (Re)write the AI's report for a finished interview. */
export function writeAiReport(sessionId: string): Promise<SessionReport> {
  return api(`/viva-sessions/${enc(sessionId)}/ai-report`, { method: "POST" });
}

/** Send the student their marks, the AI's report and / or a message (sending again updates it). */
export function sendToStudent(
  sessionId: string,
  body: { includeMarks: boolean; includeAiReport: boolean; message: string },
): Promise<SessionReport> {
  return api(`/viva-sessions/${enc(sessionId)}/send`, { method: "POST", body });
}

/** Staff: what the student handed in for the viva's linked assignment. */
export function getStudentWork(vivaId: string, studentId: string): Promise<StudentWork> {
  return api(`/vivas/${enc(vivaId)}/students/${enc(studentId)}/work`);
}

export function getEngineStatus(): Promise<Record<string, EngineStatus>> {
  return api(`/live/engines`);
}

/** Integrity snapshot as an object URL (the image needs the login token). Revoke it when done. */
export async function snapshotUrl(sessionId: string, eventId: number): Promise<string> {
  const token = readSession()?.token;
  const res = await fetch(`${API_URL}/viva-sessions/${enc(sessionId)}/events/${eventId}/snapshot`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError("Snapshot not available.", res.status);
  return URL.createObjectURL(await res.blob());
}

/** WebSocket URL of the live room for one student (both the student and the examiner connect here). */
export function liveRoomUrl(vivaId: string, studentId: string): string {
  const token = readSession()?.token ?? "";
  const base = API_URL.replace(/^http/, "ws");
  return `${base}/ws/vivas/${enc(vivaId)}/students/${enc(studentId)}?token=${enc(token)}`;
}
