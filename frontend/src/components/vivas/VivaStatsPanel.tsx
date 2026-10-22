"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import type { Viva, VivaStats } from "@/types";
import { getVivaStats, sendVivaFeedback } from "@/lib/api/vivas";
import { formatDateTime } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";
import { FileChip } from "@/components/files/FileChip";
import { FilePicker } from "@/components/files/FilePicker";
import { Button } from "@/components/ui/Button";
import { Section } from "@/components/ui/Card";
import { Avatar, Badge, Loading, StatTile } from "@/components/ui/Display";
import { FormError, inputClass } from "@/components/ui/Field";
import { SUMMARY_STATS } from "./options";

const FLAG_LABELS: Record<string, string> = {
  gaze_off_screen: "Looking away",
  head_turned: "Head turned",
  reading_pattern: "Reading pattern",
  no_face: "No face",
  multiple_faces: "Several faces",
  prohibited_object: "Prohibited object",
  second_person: "Another person",
  secondary_speaker: "Another voice",
  lipsync_mismatch: "Lip-sync mismatch",
};

const RESUME: Record<VivaStats["students"][number]["resumeStatus"], React.ReactNode> = {
  submitted: <Badge tone="success">Submitted</Badge>,
  late: <Badge tone="warning">Late</Badge>,
  missing: <Badge tone="danger">Missing</Badge>,
  not_linked: <span className="text-subtle">—</span>,
};

type Row = VivaStats["students"][number];

function VivaStatus({ row, windowMinutes }: { row: Row; windowMinutes: number }) {
  switch (row.vivaStatus) {
    case "joined":
      return (
        <span className="space-y-0.5">
          <Badge tone="accent">Joined on time</Badge>
          {row.joinedAt && <span className="block text-xs text-subtle">at {formatTime(row.joinedAt)}</span>}
        </span>
      );
    case "missed":
      return (
        <span className="space-y-0.5">
          <Badge tone="danger">Missed: not on time</Badge>
          <span className="block text-xs text-subtle">Didn&apos;t open it within {windowMinutes} min</span>
        </span>
      );
    case "completed":
      return <Badge tone="success">Completed</Badge>;
    default:
      return <Badge>Not started</Badge>;
  }
}

const formatTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Class-wide view of the viva: readiness now, performance once students have taken it. */
export function VivaStatsPanel({ viva }: { viva: Viva }) {
  const { data: stats, error, reload } = useLoad(() => getVivaStats(viva.id), `${viva.id}:${viva.updatedAt}`);
  const [openFor, setOpenFor] = useState<string | null>(null);

  if (stats === undefined) return error ? <FormError message={error} /> : <Loading />;

  const n = stats.assignedCount;
  const pct = (x: number) => (n ? `${Math.round((x / n) * 100)}%` : "–");
  const chosen = SUMMARY_STATS.filter((s) => stats.summaryStats.includes(s.value));
  const hasResults = stats.completedCount > 0;

  return (
    <div className="space-y-5">
      {stats.phase === "draft" && (
        <p className="rounded-lg border border-border-strong bg-raised px-4 py-3 text-sm text-muted">
          This viva is still a draft. Finish the Setup tab and schedule it; results appear here as students complete it.
        </p>
      )}

      {stats.phase !== "draft" && (
        <p className="rounded-xl border border-warning/25 bg-warning/[0.06] px-4 py-3 text-sm text-muted">
          Strict entry: students must open the viva within{" "}
          <span className="text-text">{stats.joinWindowMinutes} minutes</span> of the start time
          {viva.startsAt && viva.joinClosesAt && (
            <>
              {" "}
              ({formatDateTime(viva.startsAt)} – {formatTime(viva.joinClosesAt)})
            </>
          )}
          . Anyone who doesn&apos;t is marked <span className="text-danger">not on time</span> and can&apos;t take it.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Students assigned" value={n} />
        <StatTile
          label="Resumes ready"
          value={viva.assignmentId ? `${stats.resumesReady}/${n}` : "–"}
          hint={viva.assignmentId ? pct(stats.resumesReady) : "No assignment linked"}
          tone={viva.assignmentId && stats.resumesReady < n ? "warning" : undefined}
        />
        <StatTile label="Joined on time" value={`${stats.joinedCount}/${n}`} hint={pct(stats.joinedCount)} />
        <StatTile
          label="Missed (late)"
          value={stats.missedCount}
          hint={`Not opened within ${stats.joinWindowMinutes} min`}
          tone={stats.missedCount ? "danger" : undefined}
        />
        <StatTile label="Average score" value={stats.averageScore ?? "–"} hint={hasResults ? "out of 10" : "No results yet"} />
      </div>

      <Section title="Summary report" description="The statistics you chose in Setup.">
        {chosen.length === 0 ? (
          <p className="text-sm text-muted">No summary statistics selected. Pick some in the Setup tab.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {chosen.map((s) => (
              <li key={s.value} className="rounded-xl border border-border bg-white/[0.03] p-4">
                <p className="text-sm font-medium">{s.label}</p>
                <p className="mt-0.5 text-xs text-muted">{s.description}</p>
                <div className="mt-3 text-xs text-subtle">
                  <StatDetail stat={s.value} stats={stats} n={n} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Students" description={`${n} student${n === 1 ? "" : "s"} take this viva.`}>
        {n === 0 ? (
          <p className="text-sm text-muted">
            {viva.audience === "selected" ? "No students picked yet. Choose them in Setup." : "No students in this class yet."}
          </p>
        ) : (
          <div className="-mx-5 -my-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-subtle">
                <tr className="border-b border-border">
                  <th className="px-5 py-2.5 font-medium">Student</th>
                  <th className="px-5 py-2.5 font-medium">Resume</th>
                  <th className="px-5 py-2.5 font-medium">Viva</th>
                  {viva.conductedBy === "staff" && <th className="px-5 py-2.5 font-medium">Examiner</th>}
                  <th className="px-5 py-2.5 text-right font-medium">Score</th>
                  <th className="px-5 py-2.5 text-right font-medium">Mastery</th>
                  <th className="px-5 py-2.5 text-right font-medium">Risk</th>
                  <th className="px-5 py-2.5 text-right font-medium">Flags</th>
                  <th className="px-5 py-2.5 font-medium">Feedback</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {stats.students.map((r) => (
                  <Fragment key={r.student.id}>
                  <tr className="hover:bg-raised/50">
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-3">
                        <Avatar name={r.student.name} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{r.student.name}</span>
                          <span className="block truncate text-xs text-muted">{r.student.email}</span>
                        </span>
                      </span>
                    </td>
                    <td className="px-5 py-3">{RESUME[r.resumeStatus]}</td>
                    <td className="px-5 py-3">
                      <VivaStatus row={r} windowMinutes={stats.joinWindowMinutes} />
                    </td>
                    {viva.conductedBy === "staff" && (
                      <td className="px-5 py-3 text-xs">
                        {r.examiner ? (
                          <>
                            <span className="block text-sm">{r.examiner.name}</span>
                            {r.slotStartsAt && <span className="text-subtle">{formatTime(r.slotStartsAt)}</span>}
                          </>
                        ) : (
                          <span className="text-warning">Not allocated</span>
                        )}
                      </td>
                    )}
                    <td className="px-5 py-3 text-right tabular-nums">
                      {r.sessionId && r.sessionStatus === "ended" ? (
                        <Link href={`/classes/${viva.classId}/vivas/${viva.id}/report/${r.sessionId}`} className="text-accent hover:underline">
                          {r.score ?? "Report"}
                        </Link>
                      ) : (
                        r.score ?? <span className="text-subtle">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {r.masteryScore !== null ? `${Math.round(r.masteryScore)}%` : <span className="text-subtle">—</span>}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {r.riskScore !== null && r.sessionStatus !== "waiting" ? (
                        <span className={r.riskScore >= 60 ? "text-danger" : r.riskScore >= 30 ? "text-warning" : ""}>
                          {Math.round(r.riskScore)}%
                        </span>
                      ) : (
                        <span className="text-subtle">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {r.vivaStatus === "not_started" ? <span className="text-subtle">—</span> : r.flags}
                    </td>
                    <td className="px-5 py-3">
                      {stats.phase === "draft" ? (
                        <span className="text-subtle">—</span>
                      ) : (
                        <Button
                          size="sm"
                          variant={r.feedback ? "ghost" : "outline"}
                          onClick={() => setOpenFor(openFor === r.student.id ? null : r.student.id)}
                        >
                          {openFor === r.student.id ? "Close" : r.feedback ? "Sent · edit" : "Send feedback"}
                        </Button>
                      )}
                    </td>
                  </tr>
                  {openFor === r.student.id && (
                    <tr>
                      <td colSpan={viva.conductedBy === "staff" ? 9 : 8} className="bg-white/[0.02] px-5 py-4">
                        <VivaFeedbackForm
                          vivaId={viva.id}
                          row={r}
                          onSent={() => {
                            setOpenFor(null);
                            reload();
                          }}
                        />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

/** The number behind one chosen summary statistic, once there are results. */
function StatDetail({ stat, stats, n }: { stat: VivaStats["summaryStats"][number]; stats: VivaStats; n: number }) {
  const scored = stats.students.filter((r) => r.score !== null).map((r) => r.score as number);
  const none = <>Available once students complete the viva.</>;
  switch (stat) {
    case "completion_rate":
      return <>{`${stats.completedCount} of ${n} completed`}</>;
    case "average_score": {
      if (!scored.length) return none;
      const sorted = [...scored].sort((a, b) => a - b);
      const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
      return (
        <span className="text-sm text-text">
          Mean {stats.averageScore} · median {median} <span className="text-xs text-subtle">out of 10</span>
        </span>
      );
    }
    case "score_distribution": {
      if (!scored.length) return none;
      const bands = [
        ["0–4", (x: number) => x < 5],
        ["5–6", (x: number) => x >= 5 && x < 7],
        ["7–8", (x: number) => x >= 7 && x < 9],
        ["9–10", (x: number) => x >= 9],
      ] as const;
      return (
        <span className="text-text">
          {bands.map(([label, test]) => `${label}: ${scored.filter(test).length}`).join(" · ")}
        </span>
      );
    }
    case "criteria_breakdown":
      return stats.criteriaAverages.length ? (
        <ul className="space-y-0.5 text-text">
          {stats.criteriaAverages.map((c) => (
            <li key={c.name} className="flex justify-between gap-2">
              <span className="truncate">{c.name}</span>
              <span className="tabular-nums">{c.average}/10</span>
            </li>
          ))}
        </ul>
      ) : (
        none
      );
    case "proctoring_flags": {
      const entries = Object.entries(stats.flagCounts).sort((a, b) => b[1] - a[1]);
      if (!entries.length) return stats.completedCount ? <>No flags.</> : none;
      const most = [...stats.students].sort((a, b) => b.flags - a.flags)[0];
      return (
        <span className="text-text">
          {entries.map(([k, v]) => `${FLAG_LABELS[k] ?? k}: ${v}`).join(" · ")}
          {most?.flags ? <span className="block text-subtle">Most flagged: {most.student.name} ({most.flags})</span> : null}
        </span>
      );
    }
    case "top_and_bottom": {
      const done = stats.students.filter((r) => r.score !== null).sort((a, b) => (b.score as number) - (a.score as number));
      if (!done.length) return none;
      const top = done[0];
      const bottom = done[done.length - 1];
      return (
        <span className="text-text">
          Top: {top.student.name} ({top.score}) · Lowest: {bottom.student.name} ({bottom.score})
        </span>
      );
    }
    default:
      return stats.completedCount ? <>See each student&apos;s report (weak points per answer).</> : none;
  }
}

/** Staff write a student's viva feedback / report and attach files (e.g. a PDF report). The student sees it at once. */
function VivaFeedbackForm({ vivaId, row, onSent }: { vivaId: string; row: Row; onSent: () => void }) {
  const [text, setText] = useState(row.feedback?.feedback ?? "");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const existing = row.feedback?.files ?? [];

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() && !attachments.length && !existing.length) return setError("Write feedback or attach a report.");
    setBusy(true);
    setError(null);
    try {
      await sendVivaFeedback(vivaId, row.student.id, { feedback: text, attachments });
      onSent();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={send} className="space-y-3">
      <p className="text-sm font-medium">
        Feedback for {row.student.name}
        {row.vivaStatus === "missed" && <span className="ml-2 text-xs text-danger">(missed: not on time)</span>}
        {row.feedback?.releasedAt && (
          <span className="ml-2 text-xs font-normal text-muted">sent {formatDateTime(row.feedback.releasedAt)}</span>
        )}
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        maxLength={20000}
        placeholder="How they did: strengths, gaps, next steps…"
        aria-label={`Feedback for ${row.student.name}`}
        className={inputClass}
      />
      {existing.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {existing.map((f) => (
            <FileChip key={f.id} file={f} label={`Attached · ${f.name}`} />
          ))}
        </div>
      )}
      <FilePicker files={attachments} onChange={setAttachments} accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg" label="Attach report / files" />
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button type="submit" size="sm" disabled={busy}>
        {busy ? "Sending…" : row.feedback ? "Update & send" : "Send to student"}
      </Button>
    </form>
  );
}
