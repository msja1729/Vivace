"use client";

import { useState } from "react";
import type { AssignmentInput } from "@/types";
import { fromLocalInput, toLocalInput } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { FormError, TextAreaField, TextField } from "@/components/ui/Field";

/** A week from now at 23:59 local time. */
function defaultDeadline(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  d.setHours(23, 59, 0, 0);
  return d.toISOString();
}

export function AssignmentForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: AssignmentInput;
  submitLabel: string;
  onSubmit: (input: AssignmentInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [instructions, setInstructions] = useState(initial?.instructions ?? "");
  const [deadline, setDeadline] = useState(toLocalInput(initial?.deadline ?? defaultDeadline()));
  const [graded, setGraded] = useState(initial?.graded ?? false);
  const [totalMarks, setTotalMarks] = useState(String(initial?.totalMarks ?? 100));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const deadlineIso = fromLocalInput(deadline);
    if (!title.trim()) return setError("Give the assignment a title.");
    if (!deadlineIso) return setError("Set a deadline.");
    if (!initial && new Date(deadlineIso) <= new Date()) return setError("The deadline must be in the future.");
    const total = Number(totalMarks);
    if (graded && !(Number.isInteger(total) && total >= 1 && total <= 1000))
      return setError("Total marks must be a whole number from 1 to 1000.");
    setError(null);
    setBusy(true);
    try {
      await onSubmit({ title, instructions, deadline: deadlineIso, graded, totalMarks: graded ? total : null });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <TextField
        label="Title"
        name="title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="e.g. Resume & project submission"
      />
      <TextAreaField
        label="Instructions for students"
        name="instructions"
        rows={6}
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        placeholder="What to upload, e.g. your resume as a PDF with the GitHub link for each project, and any Claude session transcripts as separate files."
        hint="Students turn in any number of files, plus optional GitHub links and a note."
      />
      <TextField
        label="Deadline"
        name="deadline"
        type="datetime-local"
        value={deadline}
        onChange={(e) => setDeadline(e.target.value)}
        hint="Students can turn in (and again) until this time. After it, submissions close."
        className="max-w-xs"
      />

      <div className="rounded-xl border border-border bg-white/[0.02] p-4">
        <p className="text-xs font-medium text-muted">Grading</p>
        <div role="radiogroup" aria-label="Grading" className="mt-2 inline-flex rounded-lg border border-border-strong p-0.5">
          {[
            { value: false, label: "No marks" },
            { value: true, label: "Graded" },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              role="radio"
              aria-checked={graded === o.value}
              onClick={() => setGraded(o.value)}
              className={`rounded-md px-3 py-1.5 text-sm transition ${
                graded === o.value ? "bg-white/10 font-medium text-text" : "text-muted hover:text-text"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        {graded ? (
          <div className="mt-4 flex items-end gap-3">
            <TextField
              label="Total marks"
              name="totalMarks"
              type="number"
              min={1}
              max={1000}
              value={totalMarks}
              onChange={(e) => setTotalMarks(e.target.value)}
              className="max-w-28"
            />
            <p className="pb-2 text-xs text-muted">You return each submission with marks out of this, plus feedback.</p>
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted">You can still return each submission with written feedback.</p>
        )}
      </div>

      <FormError message={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
