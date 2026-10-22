// The signed-in session ({ token, user }) kept in browser storage.
// React components subscribe to it through AuthProvider, so they re-render
// whenever it changes — in this tab or another one.

import type { User } from "@/types";

const KEY = "viva.session";

export interface Session {
  token: string;
  user: User;
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function subscribeSession(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** Raw stored string — a stable value React can compare cheaply. */
export function readSessionRaw(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function readSession(): Session | null {
  const raw = readSessionRaw();
  try {
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(session));
  } catch {}
  notify();
}

export function clearSession() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {}
  notify();
}
