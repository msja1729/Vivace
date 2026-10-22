"use client";

import { useState } from "react";
import type { ClassRoom } from "@/types";
import { createClass } from "@/lib/api/classes";
import { useWorkspace } from "@/lib/workspace";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/Display";
import { FormError, TextAreaField, TextField } from "@/components/ui/Field";
import { JoinCode } from "@/components/classes/JoinCode";

export default function CreateClassPage() {
  return <RequireAuth role="instructor">{() => <CreateClassForm />}</RequireAuth>;
}

function CreateClassForm() {
  const { refreshClasses } = useWorkspace();
  const [form, setForm] = useState({ name: "", subject: "", description: "" });
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ClassRoom | null>(null);
  const [busy, setBusy] = useState(false);

  const update = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [key]: e.target.value });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.subject.trim()) return setError("Class name and subject are required.");
    setError(null);
    setBusy(true);
    try {
      setCreated(await createClass(form));
      refreshClasses();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div className="mx-auto w-full max-w-lg">
        <Card className="p-8 text-center">
          <p className="text-xs text-muted">Class created</p>
          <h1 className="mt-1 text-2xl font-bold">{created.name}</h1>
          <p className="mt-6 text-sm text-muted">Share this code with your students</p>
          <div className="mt-3 flex justify-center">
            <JoinCode code={created.joinCode ?? ""} large />
          </div>
          <Button href={`/classes/${created.id}`} className="mt-8">
            Open class
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-6">
      <PageHeader title="Create a class" description="Students join using the code generated for this class." />
      <Card>
        <form onSubmit={handleSubmit} className="space-y-4">
          <TextField label="Class name" name="name" value={form.name} onChange={update("name")} placeholder="Machine Learning — Section A" />
          <TextField label="Subject" name="subject" value={form.subject} onChange={update("subject")} placeholder="Machine Learning" />
          <TextAreaField
            label="Description (optional)"
            name="description"
            value={form.description}
            onChange={update("description")}
            placeholder="What this class covers"
          />
          <FormError message={error} />
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Creating…" : "Create class"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
