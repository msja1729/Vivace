"use client";

import { useState } from "react";
import type { Submission } from "@/types";
import { gradeSubmission } from "@/lib/api/assignments";
import { formatDateTime } from "@/lib/format";
import { FileChip } from "@/components/files/FileChip";
import { FilePicker } from "@/components/files/FilePicker";
import { Button } from "@/components/ui/Button";
import { FormError, inputClass } from "@/components/ui/Field";

/**
 * Return a submission to the student: marks out of the total (graded assignments), feedback and files.
 * Once returned it shows a summary, with "Edit" to change and return again.
 */
export function GradePanel({
  submission,
  totalMarks,
  onReturned,
}: {
  submission: Submission;
  totalMarks: number | null; // null = ungraded, feedback only
  onReturned: (s: Submission) => void;
}) {
  const returned = !!submission.returnedAt;
  const [editing, setEditing] = useState(!returned);
  const [marks, setMarks] = useState(submission.marks?.toString() ?? "");
  const [feedback, setFeedback] = useState(submission.feedback);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReturn(e: React.FormEvent) {
    e.preventDefault();
    const value = marks.trim() === "" ? null : Number(marks);
    if (totalMarks !== null && (value === null || Number.isNaN(value) || value < 0 || value > totalMarks))
      return setError(`Enter marks from 0 to ${totalMarks}.`);
    if (totalMarks === null && !feedback.trim() && !attachments.length && !submission.feedbackFiles.length)
      return setError("Write some feedback or attach a file first.");
    setBusy(true);
    setError(null);
    try {
      onReturned(await gradeSubmission(submission.id, { marks: totalMarks === null ? null : value, feedback, attachments }));
      setAttachments([]);
      setEditing(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="rounded-xl border border-success/20 bg-success/[0.06] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-success">
            Returned {submission.returnedAt && formatDateTime(submission.returnedAt)}
            {totalMarks !== null && submission.marks !== null && (
              <span className="ml-2 text-sm font-semibold text-text tabular-nums">
                {submission.marks}/{totalMarks}
              </span>
            )}
          </p>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
        </div>
        {submission.feedback && <p className="mt-1.5 text-sm whitespace-pre-line text-muted">{submission.feedback}</p>}
        {submission.feedbackFiles.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {submission.feedbackFiles.map((f) => (
              <FileChip key={f.id} file={f} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleReturn} className="space-y-2 rounded-xl border border-border bg-tint p-3">
      <div className="flex flex-wrap items-center gap-2">
        {totalMarks !== null && (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-xs text-muted">Marks</span>
            <input
              type="number"
              min={0}
              max={totalMarks}
              step="0.5"
              value={marks}
              onChange={(e) => setMarks(e.target.value)}
              aria-label={`Marks out of ${totalMarks}`}
              className={`${inputClass} max-w-24`}
            />
            <span className="text-muted">/ {totalMarks}</span>
          </label>
        )}
      </div>
      <textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        rows={2}
        maxLength={5000}
        placeholder="Feedback for the student"
        aria-label="Feedback"
        className={inputClass}
      />
      {submission.feedbackFiles.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {submission.feedbackFiles.map((f) => (
            <FileChip key={f.id} file={f} label={`Attached · ${f.name}`} />
          ))}
        </div>
      )}
      <FilePicker files={attachments} onChange={setAttachments} accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg" />
      <FormError message={error} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? "Returning…" : returned ? "Return again" : "Return"}
        </Button>
        {returned && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
