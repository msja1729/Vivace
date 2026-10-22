// Class files: student submissions, viva instructions and shared material. See backend/app/api/routes/files.py.

import type { StoredFile } from "@/types";
import { api } from "./client";

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
