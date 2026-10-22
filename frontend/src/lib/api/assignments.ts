// Assignments: the instructor asks the class to upload resumes, GitHub links and Claude transcripts.
// See backend/app/api/routes/assignments.py.

import type { Assignment, AssignmentDetail, AssignmentInput, StudentAssignment, Submission } from "@/types";
import { api } from "./client";

const enc = encodeURIComponent;

export function listAssignments(classId: string): Promise<Assignment[]> {
  return api(`/classes/${enc(classId)}/assignments`);
}

export function createAssignment(classId: string, input: AssignmentInput): Promise<Assignment> {
  return api(`/classes/${enc(classId)}/assignments`, { method: "POST", body: input });
}

export function getAssignment(id: string): Promise<AssignmentDetail> {
  return api(`/assignments/${enc(id)}`);
}

export function updateAssignment(id: string, input: AssignmentInput): Promise<AssignmentDetail> {
  return api(`/assignments/${enc(id)}`, { method: "PUT", body: input });
}

export function deleteAssignment(id: string): Promise<void> {
  return api(`/assignments/${enc(id)}`, { method: "DELETE" });
}

/** Return a submission with marks (graded assignments only), feedback and optional files. */
export function gradeSubmission(
  id: string,
  grade: { marks: number | null; feedback: string; attachments: File[] },
): Promise<Submission> {
  const form = new FormData();
  if (grade.marks !== null) form.append("marks", String(grade.marks));
  form.append("feedback", grade.feedback);
  grade.attachments.forEach((f) => form.append("attachments", f));
  return api(`/submissions/${enc(id)}/grade`, { method: "PUT", body: form });
}

// ---------- Student ----------

export function listMyAssignments(classId: string): Promise<StudentAssignment[]> {
  return api(`/classes/${enc(classId)}/my-assignments`);
}

export function getMyAssignment(id: string): Promise<StudentAssignment> {
  return api(`/assignments/${enc(id)}/mine`);
}

/** Turn in (or turn in again): new files plus the ids of earlier files to keep. Earlier files not kept are removed. */
export function turnIn(
  id: string,
  input: { files: File[]; keepFileIds: string[]; githubLinks: string; note: string },
): Promise<Submission> {
  const form = new FormData();
  input.files.forEach((f) => form.append("files", f));
  input.keepFileIds.forEach((fid) => form.append("keepFileIds", fid));
  form.append("githubLinks", input.githubLinks);
  form.append("note", input.note);
  return api(`/assignments/${enc(id)}/submission`, { method: "POST", body: form });
}
