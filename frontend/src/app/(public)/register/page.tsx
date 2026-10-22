"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Role } from "@/types";
import { useAuth } from "@/lib/auth/AuthProvider";
import { register } from "@/lib/api/auth";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { MicrosoftSignIn } from "@/components/auth/MicrosoftSignIn";
import { RoleCards, RoleSelector } from "@/components/auth/RoleSelector";
import { Button } from "@/components/ui/Button";
import { FormError, TextField } from "@/components/ui/Field";

// Create an account (name, school email, password, role), then log in on /login.
// Microsoft sign-ins land here too and pick their role on a second step.
export default function RegisterPage() {
  const { user, loading, setRole } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (user?.role) router.replace("/dashboard");
  }, [user, router]);

  if (loading || user?.role) return null;

  if (user) {
    return (
      <AuthFrame
        eyebrow="Step 2 of 2"
        title="Who are you?"
        description={`Welcome, ${user.name.split(" ")[0]}. Choose how you'll use the platform.`}
      >
        <RoleSelector onConfirm={setRole} />
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      eyebrow="Register"
      title="Create your account"
      description="Use your school email. You'll log in with it next."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-accent hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <MicrosoftSignIn />
      <RegisterForm />
    </AuthFrame>
  );
}

function RegisterForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [role, setRole] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Enter your full name.");
    if (!email.includes("@")) return setError("Enter your school email.");
    if (password.length < 8) return setError("Use a password of at least 8 characters.");
    if (password !== confirm) return setError("The two passwords don't match.");
    if (!role) return setError("Choose Student or Instructor.");

    setError(null);
    setBusy(true);
    try {
      const user = await register({ name: name.trim(), email: email.trim(), password, role });
      router.push(`/login?registered=1&email=${encodeURIComponent(user.email)}`);
    } catch (err) {
      setError((err as Error).message || "Couldn't create your account. Please try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <TextField
        label="Full name"
        name="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Aditi Sharma"
        autoComplete="name"
      />
      <TextField
        label="School email"
        name="email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@iisc.ac.in"
        autoComplete="email"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Password"
          name="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint="At least 8 characters"
          autoComplete="new-password"
        />
        <TextField
          label="Confirm password"
          name="confirm"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
        />
      </div>
      <div className="space-y-1.5">
        <span className="block text-xs font-medium text-muted">I am a…</span>
        <RoleCards value={role} onChange={setRole} compact />
      </div>
      <FormError message={error} />
      <Button type="submit" disabled={busy} className="w-full py-2.5">
        {busy ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
