// Class API — calls the FastAPI backend (see backend/app/api/routes/classes.py).
// The server enforces who may create, join and view classes.

import type { ClassRoom, CreateClassInput, Member, Person, TA } from "@/types";
import { api } from "./client";

export function createClass(input: CreateClassInput): Promise<ClassRoom> {
  return api<ClassRoom>("/classes", { method: "POST", body: input });
}

export function joinClass(code: string): Promise<ClassRoom> {
  return api<ClassRoom>("/classes/join", { method: "POST", body: { code: code.trim().toUpperCase() } });
}

export interface MyClasses {
  teaching: ClassRoom[];
  assisting: ClassRoom[]; // classes where the user is a TA
  joined: ClassRoom[];
}

/** Classes the user teaches, assists (as a TA) or has joined. */
export function listMyClasses(): Promise<MyClasses> {
  return api("/classes/mine");
}

/** Returns null if the class doesn't exist or the user isn't allowed to see it. */
export async function getClass(id: string): Promise<ClassRoom | null> {
  try {
    return await api<ClassRoom>(`/classes/${encodeURIComponent(id)}`);
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null;
    throw err;
  }
}

/** Class staff only: students in the class. */
export function listMembers(classId: string): Promise<Member[]> {
  return api(`/classes/${encodeURIComponent(classId)}/members`);
}

// ---------- Teaching assistants ----------

export function listTAs(classId: string): Promise<TA[]> {
  return api(`/classes/${encodeURIComponent(classId)}/tas`);
}

/** Owner only: registered users matching an email or name (3+ characters). */
export function searchTACandidates(classId: string, query: string): Promise<Person[]> {
  return api(`/classes/${encodeURIComponent(classId)}/ta-candidates?q=${encodeURIComponent(query)}`);
}

export function addTA(classId: string, userId: string): Promise<TA[]> {
  return api(`/classes/${encodeURIComponent(classId)}/tas`, { method: "POST", body: { userId } });
}

export function removeTA(classId: string, userId: string): Promise<void> {
  return api(`/classes/${encodeURIComponent(classId)}/tas/${encodeURIComponent(userId)}`, { method: "DELETE" });
}
