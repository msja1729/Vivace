// Class files: student submissions, viva instructions and shared material. See backend/app/api/routes/files.py.

import type { StoredFile } from "@/types";
import { readSession } from "@/lib/auth/session";
import { api, API_URL, ApiError } from "./client";

export { downloadFile } from "./client";

export function listClassFiles(classId: string): Promise<StoredFile[]> {
  return api(`/classes/${encodeURIComponent(classId)}/files`);
}

export function uploadMaterial(classId: string, files: File[]): Promise<StoredFile[]> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  return api(`/classes/${encodeURIComponent(classId)}/files`, { method: "POST", body: form });
}

export function deleteFile(id: string): Promise<void> {
  return api(`/files/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** A file as an object URL, to show it in the page (it needs the login token). Revoke it when done. */
export async function fileObjectUrl(id: string): Promise<string> {
  const token = readSession()?.token;
  const res = await fetch(`${API_URL}/files/${encodeURIComponent(id)}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError("Couldn't open the file.", res.status);
  return URL.createObjectURL(await res.blob());
}
