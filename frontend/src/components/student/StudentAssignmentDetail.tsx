"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { ClassRoom, StudentAssignment } from "@/types";
import { getMyAssignment, turnIn } from "@/lib/api/assignments";
import { formatDateTime, fromNow } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";
import { FileChip } from "@/components/files/FileChip";
import { FilePicker } from "@/components/files/FilePicker";
import { Button } from "@/components/ui/Button";
import { Card, Section } from "@/components/ui/Card";
import { Loading } from "@/components/ui/Display";
import { FormError, TextAreaField } from "@/components/ui/Field";
import { ChevronLeftIcon, LinkIcon, XIcon } from "@/components/ui/Icons";
import { AssignmentStatusBadge } from "./StudentAssignments";

/** One assignment for a student: instructions, turn in (again) until the deadline, and returned feedback. */
export function StudentAssignmentDetail({ cls }: { cls: ClassRoom }) {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const { data: a, error, setData } = useLoad(() => getMyAssignment(assignmentId), assignmentId);

  if (a === undefined) return error ? <FormError message={error} /> : <Loading />;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/classes/${cls.id}/assignments`} className="inline-flex items-center gap-1 text-xs text-subtle hover:text-text">
          <ChevronLeftIcon className="h-3.5 w-3.5" /> All assignments
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{a.title}</h1>
          <AssignmentStatusBadge a={a} />
        </div>
        <p className="mt-1.5 text-sm text-muted">
          Due {formatDateTime(a.deadline)} ({fromNow(a.deadline)}){a.graded && ` · ${a.totalMarks} marks`}
        </p>
      </div>

      {a.instructions && <Card className="text-sm whitespace-pre-line text-muted">{a.instructions}</Card>}

      {a.submission?.returnedAt && <ReturnedFeedback a={a} />}

      {a.isOpen ? (
        <TurnInForm a={a} onTurnedIn={setData} />
      ) : (
        <Card className="text-sm">
          <p className="font-medium">The deadline has passed.</p>
          <p className="mt-1 text-muted">
            {a.submission ? "Your last turned-in work is shown below." : "Nothing was turned in for this assignment."}
          </p>
        </Card>
      )}

      {a.submission && !a.isOpen && <SubmittedWork a={a} />}
    </div>
  );
}

function ReturnedFeedback({ a }: { a: StudentAssignment }) {
  const s = a.submission!;
  return (
    <section className="rounded-xl border border-success/25 bg-success/[0.06] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold text-success">Returned with feedback</h2>
        <span className="text-xs text-muted">{s.returnedAt && formatDateTime(s.returnedAt)}</span>
      </div>
      {a.graded && s.marks !== null && (
        <p className="mt-3 text-3xl font-bold tabular-nums">
          {s.marks}
          <span className="text-lg text-muted"> / {a.totalMarks}</span>
        </p>
      )}
      {s.feedback && <p className="mt-3 text-sm whitespace-pre-line">{s.feedback}</p>}
      {s.feedbackFiles.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {s.feedbackFiles.map((f) => (
            <FileChip key={f.id} file={f} />
          ))}
        </div>
      )}
    </section>
  );
}

function SubmittedWork({ a }: { a: StudentAssignment }) {
  const s = a.submission!;
  return (
    <Section title="Your work" description={`Turned in ${formatDateTime(s.submittedAt)}`}>
      <div className="flex flex-wrap gap-2">
        {s.files.map((f) => (
          <FileChip key={f.id} file={f} />
        ))}
      </div>
      {s.githubLinks.length > 0 && (
        <ul className="mt-3 space-y-1">
          {s.githubLinks.map((l) => (
            <li key={l}>
              <a href={l} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline">
                <LinkIcon className="h-3.5 w-3.5" /> {l.replace(/^https?:\/\/(www\.)?/, "")}
              </a>
            </li>
          ))}
        </ul>
      )}
      {s.note && <p className="mt-3 text-xs whitespace-pre-line text-muted">“{s.note}”</p>}
    </Section>
  );
}

function TurnInForm({ a, onTurnedIn }: { a: StudentAssignment; onTurnedIn: (a: StudentAssignment) => void }) {
  const s = a.submission;
  const [keepIds, setKeepIds] = useState<string[]>(s?.files.map((f) => f.id) ?? []);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [links, setLinks] = useState(s?.githubLinks.join("\n") ?? "");
  const [note, setNote] = useState(s?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const kept = s?.files.filter((f) => keepIds.includes(f.id)) ?? [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (kept.length + newFiles.length === 0) return setError("Add at least one file.");
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await turnIn(a.id, { files: newFiles, keepFileIds: keepIds, githubLinks: links, note });
      const updated = await getMyAssignment(a.id);
      onTurnedIn(updated);
      setKeepIds(updated.submission?.files.map((f) => f.id) ?? []);
      setNewFiles([]);
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Your work"
      description={
        s
          ? `Turned in ${formatDateTime(s.submittedAt)}. You can change your files and turn in again until the deadline.`
          : "Add your files and turn in. You can turn in again as many times as you like before the deadline."
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-3">
          <p className="text-xs font-medium text-muted">Files</p>
          {kept.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {kept.map((f) => (
                <li key={f.id} className="flex items-center gap-1">
                  <FileChip file={f} />
                  <button
                    type="button"
                    onClick={() => setKeepIds(keepIds.filter((id) => id !== f.id))}
                    aria-label={`Remove ${f.name}`}
                    title="Remove from your work"
                    className="rounded p-1 text-subtle hover:text-danger"
                  >
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <FilePicker files={newFiles} onChange={setNewFiles} label="Add files" />
          <p className="text-xs text-subtle">
            PDF, Word, PowerPoint, Excel, text, notebooks, code, ZIP or images · up to 15 MB each.
          </p>
        </div>

        <TextAreaField
          label="GitHub links (optional, one per line)"
          name="githubLinks"
          rows={2}
          value={links}
          onChange={(e) => setLinks(e.target.value)}
          placeholder="https://github.com/you/project"
        />
        <TextAreaField
          label="Note for your instructor (optional)"
          name="note"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        <FormError message={error} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="accent" disabled={busy}>
            {busy ? "Turning in…" : s ? "Turn in again" : "Turn in"}
          </Button>
          {done && !busy && <span className="text-sm text-success">Turned in.</span>}
        </div>
      </form>
    </Section>
  );
}
