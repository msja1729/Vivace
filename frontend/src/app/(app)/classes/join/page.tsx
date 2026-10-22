"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { joinClass } from "@/lib/api/classes";
import { useWorkspace } from "@/lib/workspace";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/Display";
import { FormError, TextField } from "@/components/ui/Field";

export default function JoinClassPage() {
  const router = useRouter();
  const { refreshClasses } = useWorkspace();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (code.trim().length !== 6) return setError("Class codes are 6 characters long.");
    setError(null);
    setBusy(true);
    try {
      const joined = await joinClass(code);
      refreshClasses();
      router.push(`/classes/${joined.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-6">
      <PageHeader title="Join a class" description="Enter the 6-character code from the instructor." />
      <Card>
        <form onSubmit={handleSubmit} className="space-y-4">
          <TextField
            label="Class code"
            name="code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={6}
            placeholder="AB12CD"
            autoComplete="off"
            className="text-center font-mono text-lg tracking-[0.4em]"
          />
          <FormError message={error} />
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Joining…" : "Join class"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
