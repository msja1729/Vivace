"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Role, User } from "@/types";
import { useAuth } from "@/lib/auth/AuthProvider";

/**
 * Client-side page guard. Sends signed-out users to /register and users with
 * the wrong role to /dashboard. (Real protection will also live on the backend.)
 */
export function RequireAuth({
  role,
  children,
}: {
  role?: Role;
  children: (user: User) => React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const router = useRouter();

  const allowed = !!user?.role && (!role || user.role === role);

  useEffect(() => {
    if (loading) return;
    if (!user?.role) router.replace("/register");
    else if (role && user.role !== role) router.replace("/dashboard");
  }, [loading, user, role, router]);

  if (loading || !allowed || !user) {
    return <p className="py-24 text-center text-sm text-muted">Loading…</p>;
  }
  return <>{children(user)}</>;
}
