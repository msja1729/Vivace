"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import type { Role, User } from "@/types";
import { api } from "@/lib/api/client";
import type { SignInResult } from "./microsoft";
import { clearSession, readSession, readSessionRaw, saveSession, subscribeSession } from "./session";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  /** Store the session from a completed sign-in (Microsoft or dev). */
  completeSignIn: (result: SignInResult) => User;
  setRole: (role: Role) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// On the server there is no storage yet → undefined means "still loading".
const readServerSnapshot = () => undefined;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const raw = useSyncExternalStore(subscribeSession, readSessionRaw, readServerSnapshot);
  const loading = raw === undefined;
  const user = useMemo<User | null>(() => (raw ? (readSession()?.user ?? null) : null), [raw]);

  // Returning users keep their saved role; new users get role = null.
  const completeSignIn = useCallback(({ accessToken, user }: SignInResult) => {
    saveSession({ token: accessToken, user });
    return user;
  }, []);

  const setRole = useCallback(async (role: Role) => {
    const session = readSession();
    if (!session) return;
    const user = await api<User>("/users/me/role", { method: "PUT", body: { role } });
    saveSession({ ...session, user });
  }, []);

  const signOut = useCallback(() => clearSession(), []);

  return (
    <AuthContext.Provider value={{ user, loading, completeSignIn, setRole, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
