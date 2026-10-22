"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";
import { Card } from "@/components/ui/Card";
import { MicrosoftSignIn } from "@/components/auth/MicrosoftSignIn";
import { RoleSelector } from "@/components/auth/RoleSelector";

// Step 1: sign in with Microsoft school account. Step 2: pick Student / Instructor.
export default function RegisterPage() {
  const { user, loading, setRole } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (user?.role) router.replace("/dashboard");
  }, [user, router]);

  if (loading || user?.role) return null;

  const step = user ? 2 : 1;

  return (
    <div className="mx-auto w-full max-w-xl py-16">
      <p className="text-xs font-medium tracking-wide text-subtle uppercase">Step {step} of 2</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight">
        {step === 1 ? "Register" : "Who are you?"}
      </h1>
      <p className="mt-2 text-sm text-muted">
        {step === 1
          ? "Sign in with your school Microsoft account."
          : `Welcome, ${user!.name.split(" ")[0]}. Choose how you'll use the platform.`}
      </p>

      <Card className="mt-8">
        {step === 1 ? <MicrosoftSignIn /> : <RoleSelector onConfirm={setRole} />}
      </Card>
    </div>
  );
}
