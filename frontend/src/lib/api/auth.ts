// Email + password accounts: register first, then log in.

import type { AiSettings, Role, User } from "@/types";
import { api } from "./client";
import type { SignInResult } from "@/lib/auth/microsoft";

export function register(account: { name: string; email: string; password: string; role: Role }): Promise<User> {
  return api<User>("/auth/register", { method: "POST", body: account });
}

export function logIn(credentials: { email: string; password: string }): Promise<SignInResult> {
  return api<SignInResult>("/auth/login", { method: "POST", body: credentials });
}

// ---------- Instructors: their own AI key for vivas ----------

export function getAiSettings(): Promise<AiSettings> {
  return api<AiSettings>("/users/me/ai");
}

/** Leave `apiKey` empty to keep the saved key. */
export function saveAiSettings(body: { provider: string; model: string; apiKey: string }): Promise<AiSettings> {
  return api<AiSettings>("/users/me/ai", { method: "PUT", body });
}

export function removeAiSettings(): Promise<AiSettings> {
  return api<AiSettings>("/users/me/ai", { method: "DELETE" });
}

export function checkAiSettings(): Promise<{ ok: boolean; message: string }> {
  return api("/users/me/ai/check", { method: "POST" });
}
