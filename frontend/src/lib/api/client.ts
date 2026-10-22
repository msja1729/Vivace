// Thin wrapper around fetch() for calling the FastAPI backend.
// Adds the login token, turns error responses into readable messages,
// and signs the user out if the server says the session is no longer valid.

import { clearSession, readSession } from "@/lib/auth/session";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

// FastAPI errors look like {"detail": "text"} or, for invalid input, {"detail": [{msg: ...}]}.
function messageFrom(body: unknown, status: number): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail[0]?.msg) return `Please check your input: ${detail[0].msg}`;
  return `Something went wrong (error ${status}).`;
}

async function send(path: string, method: string, body: unknown): Promise<Response> {
  const token = readSession()?.token;
  // FormData (file uploads) sets its own multipart Content-Type.
  const isForm = body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        ...(isForm || body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Can't reach the server. Is the backend running?", 0);
  }
  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    if (res.status === 401 && token) clearSession();
    throw new ApiError(messageFrom(errorBody, res.status), res.status);
  }
  return res;
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await send(path, options.method ?? "GET", options.body);
  return (res.status === 204 ? null : await res.json().catch(() => null)) as T;
}

/** Downloads a file that needs the login token, then saves it with its original name. */
export async function downloadFile(fileId: string, name: string): Promise<void> {
  const res = await send(`/files/${encodeURIComponent(fileId)}/download`, "GET", undefined);
  const url = URL.createObjectURL(await res.blob());
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
