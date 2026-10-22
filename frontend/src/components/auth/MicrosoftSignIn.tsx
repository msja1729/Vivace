"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { finishMicrosoftSignIn, microsoftConfigured, startMicrosoftSignIn } from "@/lib/auth/microsoft";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/Field";
import { MicrosoftIcon } from "@/components/ui/Icons";

/**
 * "Sign in with Microsoft", with an "or" divider below it. Name and email come from the Microsoft
 * account. Renders nothing until the Azure client ID is set in .env.local.
 */
export function MicrosoftSignIn() {
  if (!microsoftConfigured) return null;
  return (
    <div className="space-y-5">
      <MicrosoftButton />
      <p className="flex items-center gap-3 text-xs text-subtle before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
        or use email
      </p>
    </div>
  );
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
      <Button variant="outline" onClick={start} disabled={state !== "idle"} className="w-full py-2.5">
        <MicrosoftIcon />
        {state === "checking" ? "Checking sign-in…" : state === "redirecting" ? "Opening Microsoft…" : "Sign in with Microsoft"}
      </Button>
      <FormError message={error} />
      <p className="text-center text-xs text-subtle">Use your institute Microsoft account (e.g. you@iisc.ac.in).</p>
    </div>
  );
}
