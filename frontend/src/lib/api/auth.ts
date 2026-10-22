// Email + password accounts: register first, then log in.

import type { Role, User } from "@/types";
import { api } from "./client";
import type { SignInResult } from "@/lib/auth/microsoft";

export function register(account: { name: string; email: string; password: string; role: Role }): Promise<User> {
  return api<User>("/auth/register", { method: "POST", body: account });
}

export function logIn(credentials: { email: string; password: string }): Promise<SignInResult> {
  return api<SignInResult>("/auth/login", { method: "POST", body: credentials });
}
