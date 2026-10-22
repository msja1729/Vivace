"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";
import { logIn } from "@/lib/api/auth";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { Button } from "@/components/ui/Button";
import { FormError, TextField } from "@/components/ui/Field";

export default function LoginPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  // Signed in already: on to the dashboard (or the role step for a new Microsoft sign-in).
  useEffect(() => {
    if (user) router.replace(user.role ? "/dashboard" : "/register");
  }, [user, router]);

  if (loading || user) return null;

  return (
    <AuthFrame
      eyebrow="Log in"
      title="Welcome back"
      description="Log in with the email and password you registered with."
      footer={
        <>
          New here?{" "}
          <Link href="/register" className="font-medium text-accent hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      {/* useSearchParams needs a Suspense boundary */}
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthFrame>
  );
}

function LoginForm() {
  const { completeSignIn } = useAuth();
  const params = useSearchParams();
  const justRegistered = params.get("registered") === "1";
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return setError("Enter your email and password.");
    setError(null);
    setBusy(true);
    try {
      completeSignIn(await logIn({ email: email.trim(), password }));
    } catch (err) {
      setError((err as Error).message || "Couldn't log in. Please try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {justRegistered && (
        <p role="status" className="rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          Account created. Log in to continue.
        </p>
      )}
      <TextField
        label="School email"
        name="email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@iisc.ac.in"
        autoComplete="email"
      />
      <TextField
        label="Password"
        name="password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        autoFocus={justRegistered}
      />
      <FormError message={error} />
      <Button type="submit" disabled={busy} className="w-full py-2.5">
        {busy ? "Logging in…" : "Log in"}
      </Button>
    </form>
  );
}
