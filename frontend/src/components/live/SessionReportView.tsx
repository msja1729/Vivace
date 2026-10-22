"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SessionReport } from "@/types";
import { snapshotUrl } from "@/lib/api/vivas";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Section } from "@/components/ui/Card";
import { Badge, StatTile } from "@/components/ui/Display";
import { ChevronLeftIcon, PrinterIcon } from "@/components/ui/Icons";
import { AnswerNotes, Transcript, clock, riskBand } from "./LiveParts";

/** The per-student report. "Download PDF" uses the browser's print dialog (Save as PDF). */
export function SessionReportView({ report: r }: { report: SessionReport }) {
  const [snaps, setSnaps] = useState<Record<number, string>>({});

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

  const band = riskBand(r.riskScore);
  const minutes =
    r.startedAt && r.endedAt ? Math.round((new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) / 60000) : null;
  const answers = r.turns.filter((t) => t.speaker === "student" && t.analysis && !t.analysis.typed);
  const given = new Map(r.criteriaScores.map((c) => [c.name, c.score]));
  const suggested = new Map(r.suggestedCriteriaScores.map((c) => [c.name, c.score]));

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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs tracking-wide text-subtle uppercase">Viva report · {r.vivaTitle}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{r.student.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {r.student.email}
            {r.examiner && <> · Examiner: {r.examiner.name}</>}
            {r.startedAt && <> · {formatDateTime(r.startedAt)}</>}
            {minutes !== null && <> · {minutes} min</>}
          </p>
        </div>
        <Button variant="outline" className="print:hidden" onClick={() => window.print()}>
          <PrinterIcon /> Download PDF
        </Button>
      </div>

      {/* 1. Summary */}
      <Section title="1. Summary">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Examiner's score" value={r.score !== null ? `${r.score}/10` : "–"} hint={r.score === null ? "Not graded yet" : undefined} />
          <StatTile
            label="Conceptual mastery (AI)"
            value={r.masteryScore !== null ? `${Math.round(r.masteryScore)}%` : "–"}
            hint={`${answers.length} graded answer${answers.length === 1 ? "" : "s"}`}
          />
          <StatTile label="Cheating risk (peak)" value={`${Math.round(r.riskScore)}%`} hint={band.label} tone={band.tone} />
          <StatTile label="Integrity flags" value={r.events.length} hint={r.calibrated ? "Gaze calibrated" : "Not calibrated"} />
        </div>
        {r.evaluationCriteria.length > 0 && (
          <table className="mt-4 w-full text-sm">
            <thead className="text-left text-xs text-subtle">
              <tr className="border-b border-border">
                <th className="py-2 font-medium">Criterion</th>
                <th className="py-2 text-right font-medium">Weight</th>
                <th className="py-2 text-right font-medium">Examiner</th>
                <th className="py-2 text-right font-medium">AI suggestion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {r.evaluationCriteria.map((c) => (
                <tr key={c.name}>
                  <td className="py-2">{c.name}</td>
                  <td className="py-2 text-right text-muted tabular-nums">{c.weight}</td>
                  <td className="py-2 text-right tabular-nums">{given.get(c.name) ?? "–"}</td>
                  <td className="py-2 text-right text-muted tabular-nums">{suggested.get(c.name) ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {r.notes && <p className="mt-4 text-sm whitespace-pre-line">{r.notes}</p>}
        <p className="mt-4 rounded-lg border border-warning/25 bg-warning/[0.06] px-3 py-2 text-xs text-muted">
          Integrity flags and AI scores are advisory. A person must review the evidence below before any decision.
        </p>
      </Section>

      {/* 2. Integrity timeline */}
      <Section title="2. Integrity timeline" description="Times are from when the student opened the room.">
        {r.events.length === 0 ? (
          <p className="text-sm text-muted">No integrity flags.</p>
        ) : (
          <ul className="space-y-3">
            {r.events.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-4 rounded-lg border border-border p-3 break-inside-avoid">
                {snaps[e.id] && (
                  // eslint-disable-next-line @next/next/no-img-element -- object URL from an authenticated fetch
                  <img src={snaps[e.id]} alt={`Snapshot: ${e.label}`} className="w-48 rounded-md" />
                )}
                <div className="text-sm">
                  <p className="font-medium">{e.label}</p>
                  <p className="text-muted tabular-nums">
                    {clock(e.startTs)} – {clock(e.endTs)} ({Math.max(0, e.endTs - e.startTs).toFixed(0)} s) · confidence{" "}
                    {Math.round(e.confidence * 100)}%
                  </p>
                  {e.detail && <p className="text-muted">{e.detail}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 3. Per-answer breakdown */}
      <Section title="3. Answers" description="Each answer as graded by the AI, with its question.">
        {answers.length === 0 ? (
          <p className="text-sm text-muted">No graded answers.</p>
        ) : (
          <ol className="space-y-4">
            {answers.map((t, i) => (
              <li key={t.id} className="break-inside-avoid">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">Q{i + 1}.</span>
                  <span className="text-sm">{t.analysis?.question || "(question not captured)"}</span>
                  {t.analysis?.memorizationFlag ? (
                    <Badge tone="warning">Sounds memorised</Badge>
                  ) : t.analysis?.correctness !== undefined ? (
                    <Badge tone="success">Own understanding</Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-muted">“{t.text}”</p>
                {t.analysis && <AnswerNotes a={t.analysis} />}
              </li>
            ))}
          </ol>
        )}
      </Section>

      {/* 4. Transcript */}
      <Section title="4. Transcript">
        <Transcript turns={r.turns.map((t) => ({ ...t, analysis: t.speaker === "examiner" ? t.analysis : null }))} examinerName={r.examiner?.name ?? "Examiner"} studentName={r.student.name} />
      </Section>
    </div>
  );
}
