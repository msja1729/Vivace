"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { devSignIn, finishMicrosoftSignIn, microsoftConfigured, startMicrosoftSignIn } from "@/lib/auth/microsoft";
import { Button } from "@/components/ui/Button";
import { FormError, TextField } from "@/components/ui/Field";
import { MicrosoftIcon } from "@/components/ui/Icons";

/** "Sign in with Microsoft". Name and email come from the Microsoft account; nothing is typed. */
export function MicrosoftSignIn() {
  return microsoftConfigured ? <MicrosoftButton /> : <DevSignIn />;
}

function MicrosoftButton() {
  const { completeSignIn } = useAuth();
  const [state, setState] = useState<"checking" | "idle" | "redirecting">("checking");
  const [error, setError] = useState<string | null>(null);

  // Coming back from Microsoft: finish the sign-in.
  useEffect(() => {
    finishMicrosoftSignIn().then(
      (result) => {
        if (result) completeSignIn(result);
        else setState("idle");
      },
      (err: Error) => {
        setError(err.message || "Microsoft sign-in failed. Please try again.");
        setState("idle");
      },
    );
  }, [completeSignIn]);

  async function start() {
    setError(null);
    setState("redirecting");
    try {
      await startMicrosoftSignIn();
    } catch (err) {
      setError((err as Error).message || "Couldn't reach Microsoft. Please try again.");
      setState("idle");
    }
  }

  return (
    <div className="space-y-4">
      <Button onClick={start} disabled={state !== "idle"} className="w-full py-3">
        <MicrosoftIcon />
        {state === "checking" ? "Checking sign-in…" : state === "redirecting" ? "Opening Microsoft…" : "Sign in with Microsoft"}
      </Button>
      <FormError message={error} />
      <p className="text-center text-xs text-subtle">Use your institute Microsoft account (e.g. you@iisc.ac.in).</p>
    </div>
  );
}

// Personal email domains are rejected — only school (Microsoft) accounts are allowed.
const PERSONAL_DOMAINS = ["gmail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com"];

/** Local development only, until the Microsoft app registration is set in .env.local. */
function DevSignIn() {
  const { completeSignIn } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const domain = email.split("@")[1]?.toLowerCase();
    if (!name.trim()) return setError("Enter your full name.");
    if (!domain) return setError("Enter a valid email address.");
    if (PERSONAL_DOMAINS.includes(domain)) return setError("Use your school Microsoft account, not a personal email.");

    setError(null);
    setBusy(true);
    try {
      completeSignIn(await devSignIn({ name, email }));
    } catch (err) {
      setError((err as Error).message || "Sign-in failed. Please try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="rounded-lg border border-warning/25 bg-warning/[0.06] px-3 py-2 text-xs text-muted">
        <span className="font-medium text-warning">Developer sign-in.</span> Microsoft sign-in turns on once the app&apos;s
        Azure client ID is set in <code>frontend/.env.local</code>; then this form disappears.
      </p>
      <TextField label="Full name" name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Aditi Sharma" autoComplete="name" />
      <TextField
        label="School email"
        name="email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@iisc.ac.in"
        autoComplete="email"
      />
      <FormError message={error} />
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Signing in…" : "Sign in (dev)"}
      </Button>
    </form>
  );
}
