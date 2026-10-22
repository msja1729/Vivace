"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SessionReport } from "@/types";
import { sendToStudent, snapshotUrl, writeAiReport } from "@/lib/api/vivas";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Section } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Display";
import { Checkbox, FormError, TextAreaField } from "@/components/ui/Field";
import { ChevronLeftIcon, PrinterIcon, SparkleIcon } from "@/components/ui/Icons";
import { Transcript, clock, riskBand } from "./LiveParts";
import { AiReportView, MarksView, QAList } from "./ReportParts";
import { ResultForm } from "./ResultForm";

/**
 * One student's viva report, for anyone to read: marks, the AI's assessment, every question with the
 * student's answer, integrity, and the full transcript. Staff can edit the marks, (re)write the AI
 * report and send results to the student. "Download PDF" prints just the report.
 */
export function SessionReportView({ report: initial }: { report: SessionReport }) {
  const [r, setR] = useState(initial);
  const [snaps, setSnaps] = useState<Record<number, string>>({});
  const [editingMarks, setEditingMarks] = useState(initial.score === null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Snapshots need the login token, so fetch them as blobs (all of them, so they print too).
  useEffect(() => {
    let urls: string[] = [];
    let cancelled = false;
    Promise.all(
      r.events.filter((e) => e.hasSnapshot).map(async (e) => [e.id, await snapshotUrl(r.id, e.id).catch(() => "")] as const),
    ).then((pairs) => {
      urls = pairs.map(([, u]) => u).filter(Boolean);
      if (!cancelled) setSnaps(Object.fromEntries(pairs.filter(([, u]) => u)));
    });
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [r.id, r.events]);

  async function writeReport() {
    setAiBusy(true);
    setAiError(null);
    try {
      setR(await writeAiReport(r.id));
    } catch (e) {
      setAiError((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  }

  const band = riskBand(r.riskScore);
  const minutes =
    r.startedAt && r.endedAt ? Math.round((new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) / 60000) : null;
  const weights = new Map(r.evaluationCriteria.map((c) => [c.name, c.weight]));
  const marks =
    r.score !== null
      ? {
          score: r.score,
          outOf: 10,
          criteria: r.criteriaScores.map((c) => ({ name: c.name, weight: weights.get(c.name) ?? null, score: c.score })),
        }
      : null;

  return (
    <div id="viva-report" className="space-y-5">
      <div className="print:hidden">
        <Link
          href={`/classes/${r.classId}/vivas/${r.vivaId}`}
          className="inline-flex items-center gap-1 text-xs text-subtle transition hover:text-text"
        >
          <ChevronLeftIcon className="h-3.5 w-3.5" /> {r.vivaTitle}
        </Link>
      </div>

      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-subtle uppercase">Viva report · {r.vivaTitle}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{r.student.name}</h1>
          <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
            <div>{r.student.email}</div>
            {r.examiner && <div>Examiner: {r.examiner.name}</div>}
            {r.startedAt && <div>{formatDateTime(r.startedAt)}</div>}
            {minutes !== null && <div>{minutes} min</div>}
          </dl>
        </div>
        <Button variant="outline" className="print:hidden" onClick={() => window.print()}>
          <PrinterIcon /> Download PDF
        </Button>
      </header>

      <SendPanel report={r} onSent={setR} />

      {/* 1. Marks */}
      <Section
        title="1. Marks"
        description="Out of 10 per evaluation criterion, and overall."
        actions={
          marks && (
            <Button size="sm" variant="ghost" className="print:hidden" onClick={() => setEditingMarks((x) => !x)}>
              {editingMarks ? "Close" : "Edit marks"}
            </Button>
          )
        }
      >
        {marks && !editingMarks && <MarksView marks={marks} />}
        {(!marks || editingMarks) && (
          <div className="print:hidden">
            {!marks && <p className="mb-4 text-sm text-muted">Not marked yet. The AI&apos;s scores are filled in as a starting point.</p>}
            <ResultForm
              key={r.aiReport ? "with-ai" : "no-ai"}
              report={r}
              criteria={r.evaluationCriteria}
              onSaved={(next) => {
                setR(next);
                setEditingMarks(false);
              }}
            />
          </div>
        )}
        {r.notes && !editingMarks && (
          <div className="mt-4 rounded-xl border border-border bg-tint p-4">
            <p className="text-xs font-medium text-subtle">Examiner&apos;s notes</p>
            <p className="mt-1 text-sm whitespace-pre-line">{r.notes}</p>
          </div>
        )}
      </Section>

      {/* 2. The AI's assessment */}
      <Section
        title="2. Assessment by the AI"
        description="Written from the whole interview. Advisory: the examiner decides the marks."
        actions={
          r.aiReport && (
            <Button size="sm" variant="ghost" className="print:hidden" disabled={aiBusy} onClick={writeReport}>
              <SparkleIcon className="h-3.5 w-3.5" /> {aiBusy ? "Writing…" : "Rewrite"}
            </Button>
          )
        }
      >
        {r.aiReport ? (
          <AiReportView report={r.aiReport} />
        ) : (
          <div className="print:hidden">
            <p className="text-sm text-muted">
              {aiBusy ? "The AI is reading the interview…" : "The AI report isn't written yet (it is made when the interview ends)."}
            </p>
            {!aiBusy && (
              <Button size="sm" variant="accent" className="mt-3" onClick={writeReport}>
                <SparkleIcon className="h-3.5 w-3.5" /> Write the AI report
              </Button>
            )}
          </div>
        )}
        <FormError message={aiError} />
      </Section>

      {/* 3. Questions and answers */}
      <Section title="3. Questions and answers" description="Each question asked, and the student's answer word for word.">
        <QAList qa={r.qa} />
      </Section>

      {/* 4. Integrity */}
      <Section title="4. Integrity" description="What the proctoring flagged. Advisory: review the snapshots before deciding.">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Badge tone={band.tone}>{band.label}</Badge>
          <span className="text-muted">
            Peak cheating risk {Math.round(r.riskScore)}% · {r.events.length} flag{r.events.length === 1 ? "" : "s"} ·{" "}
            {r.calibrated ? "gaze calibrated" : "gaze not calibrated"}
          </span>
        </div>
        {r.events.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Nothing was flagged.</p>
        ) : (
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {r.events.map((e) => (
              <li key={e.id} className="flex gap-3 rounded-xl border border-border bg-tint p-3 break-inside-avoid">
                {snaps[e.id] && (
                  // eslint-disable-next-line @next/next/no-img-element -- object URL from an authenticated fetch
                  <img src={snaps[e.id]} alt={`Snapshot: ${e.label}`} className="w-32 shrink-0 rounded-lg" />
                )}
                <div className="min-w-0 text-sm">
                  <p className="font-medium">{e.label}</p>
                  <p className="text-muted tabular-nums">
                    at {clock(e.startTs)} for {Math.max(1, Math.round(e.endTs - e.startTs))} s
                  </p>
                  {e.detail && <p className="text-xs text-subtle">{e.detail}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 5. Full transcript */}
      <Section title="5. Full transcript">
        <details className="group">
          <summary className="cursor-pointer text-sm text-accent print:hidden">Show the whole conversation, with times</summary>
          <div className="mt-4">
            <Transcript
              turns={r.turns.map((t) => ({ ...t, analysis: t.analysis?.typed ? t.analysis : null }))}
              examinerName={r.examiner?.name ?? "Examiner"}
              studentName={r.student.name}
            />
          </div>
        </details>
      </Section>
    </div>
  );
}

/** Send the student their marks, the AI's report and a message. They see it on their viva page. */
function SendPanel({ report: r, onSent }: { report: SessionReport; onSent: (r: SessionReport) => void }) {
  const sent = r.sentToStudent;
  const [marks, setMarks] = useState(sent ? !!sent.marks : true);
  const [ai, setAi] = useState(sent ? !!sent.aiReport : true);
  const [message, setMessage] = useState(sent?.feedback ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      onSent(
        await sendToStudent(r.id, {
          includeMarks: marks && r.score !== null,
          includeAiReport: ai && !!r.aiReport,
          message,
        }),
      );
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel rounded-2xl p-5 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold">Send to the student</p>
          <p className="text-sm text-muted">
            {sent?.releasedAt
              ? `Sent ${formatDateTime(sent.releasedAt)}: ${[sent.marks && "marks", sent.aiReport && "AI report", sent.feedback && "message"].filter(Boolean).join(", ")}.`
              : "Nothing sent yet. The student sees it on their viva page."}
          </p>
        </div>
        <Button variant={sent ? "outline" : "primary"} onClick={() => setOpen((x) => !x)}>
          {open ? "Close" : sent ? "Update what was sent" : "Send results"}
        </Button>
      </div>
      {open && (
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          <Checkbox
            label="Marks"
            description={r.score === null ? "Save the marks below first." : `Overall ${r.score}/10, with the breakdown by criterion.`}
            checked={marks && r.score !== null}
            disabled={r.score === null}
            onChange={(e) => setMarks(e.target.checked)}
          />
          <Checkbox
            label="The AI's report"
            description={r.aiReport ? "Exactly as shown in section 2." : "Write the AI report first (section 2)."}
            checked={ai && !!r.aiReport}
            disabled={!r.aiReport}
            onChange={(e) => setAi(e.target.checked)}
          />
          <TextAreaField label="Message (optional)" name="message" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
          <FormError message={error} />
          <Button variant="accent" disabled={busy} onClick={send}>
            {busy ? "Sending…" : "Send to student"}
          </Button>
        </div>
      )}
    </div>
  );
}
