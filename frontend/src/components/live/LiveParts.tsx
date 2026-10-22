"use client";

// Pieces shared by the examiner console and the per-student report.

import { useEffect, useRef, useState } from "react";
import type { AnswerAnalysis, IntegrityEvent, Turn } from "@/types";
import { snapshotUrl } from "@/lib/api/vivas";
import { Badge } from "@/components/ui/Display";
import { AlertIcon } from "@/components/ui/Icons";

/** 75.4 s → "1:15" */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function riskBand(risk: number): { label: string; tone: "success" | "warning" | "danger"; bar: string } {
  if (risk < 30) return { label: "Low risk", tone: "success", bar: "bg-success" };
  if (risk < 60) return { label: "Medium risk", tone: "warning", bar: "bg-warning" };
  return { label: "High risk", tone: "danger", bar: "bg-danger" };
}

/** A headline number with a 0–100 meter underneath. */
export function ScoreMeter({
  label,
  value,
  hint,
  kind,
}: {
  label: string;
  value: number | null;
  hint?: string;
  kind: "risk" | "mastery";
}) {
  const band = kind === "risk" && value !== null ? riskBand(value) : null;
  return (
    <div className="panel rounded-xl p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs text-muted">{label}</p>
        {band && <Badge tone={band.tone}>{band.label}</Badge>}
      </div>
      <p className="mt-1 text-3xl font-bold tabular-nums">
        {value === null ? "–" : Math.round(value)}
        {value !== null && <span className="text-base font-medium text-subtle">%</span>}
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised" role="meter" aria-valuenow={value ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div
          className={`h-full rounded-full transition-all ${band ? band.bar : "bg-accent"}`}
          style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%` }}
        />
      </div>
      {hint && <p className="mt-2 text-xs text-subtle">{hint}</p>}
    </div>
  );
}

/** Integrity flags, newest first. Snapshots load on demand (they need the login token). */
export function EventList({ sessionId, events, empty }: { sessionId: string; events: IntegrityEvent[]; empty: string }) {
  if (!events.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-2">
      {[...events].reverse().map((e) => (
        <EventRow key={e.id} sessionId={sessionId} event={e} />
      ))}
    </ul>
  );
}

function EventRow({ sessionId, event: e }: { sessionId: string; event: IntegrityEvent }) {
  const [img, setImg] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => () => void (img && URL.revokeObjectURL(img)), [img]);

  async function toggle() {
    setOpen((o) => !o);
    if (!img && e.hasSnapshot) setImg(await snapshotUrl(sessionId, e.id).catch(() => null));
  }

  return (
    <li className={`rounded-lg border px-3 py-2 text-sm ${e.open ? "border-danger/40 bg-danger/[0.07]" : "border-border bg-tint"}`}>
      <button type="button" onClick={toggle} className="flex w-full items-start gap-2 text-left">
        <AlertIcon className={`mt-0.5 h-4 w-4 shrink-0 ${e.open ? "text-danger" : "text-warning"}`} />
        <span className="min-w-0 flex-1">
          <span className="font-medium">{e.label}</span>
          {e.detail && <span className="text-muted"> · {e.detail}</span>}
          <span className="block text-xs text-subtle tabular-nums">
            {clock(e.startTs)}
            {e.open ? " · now" : ` – ${clock(e.endTs)} (${Math.max(0, e.endTs - e.startTs).toFixed(0)} s)`} · confidence{" "}
            {Math.round(e.confidence * 100)}%
          </span>
        </span>
      </button>
      {open && e.hasSnapshot && (
        <div className="mt-2">
          {img ? (
            // eslint-disable-next-line @next/next/no-img-element -- object URL from an authenticated fetch
            <img src={img} alt={`Snapshot: ${e.label}`} className="w-full rounded-md" />
          ) : (
            <p className="text-xs text-subtle">Loading snapshot…</p>
          )}
        </div>
      )}
    </li>
  );
}

const pct = (x: number | null | undefined) => (x === null || x === undefined ? "–" : `${Math.round(x * 100)}%`);

/** The Grader's notes on one answer. */
export function AnswerNotes({ a }: { a: AnswerAnalysis }) {
  return (
    <div className="mt-2 rounded-lg border border-border bg-tint p-3 text-xs">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted">
        {a.mastery !== undefined && a.mastery !== null && (
          <span>
            Mastery <span className="text-text tabular-nums">{Math.round(a.mastery)}%</span>
          </span>
        )}
        {a.correctness !== undefined && <span>Correctness <span className="text-text">{pct(a.correctness)}</span></span>}
        {a.depth !== undefined && <span>Depth <span className="text-text">{pct(a.depth)}</span></span>}
        {a.similarity !== undefined && <span>Similarity <span className="text-text">{pct(a.similarity)}</span></span>}
        {a.latencyS !== undefined && a.latencyS !== null && <span>Latency <span className="text-text">{a.latencyS.toFixed(1)} s</span></span>}
        {a.wpm !== undefined && a.wpm !== null && <span>{Math.round(a.wpm)} wpm</span>}
        {a.fillerRate !== undefined && <span>{a.fillerRate.toFixed(1)} fillers/min</span>}
        {a.memorizationFlag && <Badge tone="warning">Sounds memorised</Badge>}
      </div>
      {a.reasoning && <p className="mt-2 text-muted">{a.reasoning}</p>}
      {!!a.weakPoints?.length && (
        <p className="mt-1">
          <span className="text-warning">Gaps:</span> <span className="text-muted">{a.weakPoints.join(" · ")}</span>
        </p>
      )}
      {!!a.strengths?.length && (
        <p className="mt-1">
          <span className="text-success">Strengths:</span> <span className="text-muted">{a.strengths.join(" · ")}</span>
        </p>
      )}
      {a.note && <p className="mt-1 text-subtle">{a.note}</p>}
    </div>
  );
}

/**
 * The dialogue, with the Grader's notes under each graded answer. Live (`follow`), it is a fixed-height
 * box like a live-stream chat: new lines scroll the box itself (never the page), and only while you are
 * at the bottom, so you can scroll back to read without being pulled down.
 */
export function Transcript({
  turns,
  examinerName,
  studentName,
  follow = false,
}: {
  turns: Turn[];
  examinerName: string;
  studentName: string;
  follow?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  useEffect(() => {
    const el = box.current;
    if (follow && el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [turns, follow]);

  const list = !turns.length ? (
    <p className="text-sm text-muted">The transcript appears here as people speak.</p>
  ) : (
    <ol className="space-y-3">
      {turns.map((t) => (
        <li key={t.id} className="text-sm">
          <p className="text-xs text-subtle">
            <span className={t.speaker === "examiner" ? "text-accent" : "text-text"}>
              {t.speaker === "examiner" ? examinerName : studentName}
            </span>{" "}
            · {clock(t.startTs)}
            {t.analysis?.typed && " · shown as text"}
          </p>
          <p className="mt-0.5">{t.text}</p>
          {t.speaker === "student" && t.analysis && !t.analysis.typed && <AnswerNotes a={t.analysis} />}
        </li>
      ))}
    </ol>
  );
  if (!follow) return list;
  return (
    <div
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget;
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      }}
      className="h-[22rem] overflow-y-auto overscroll-contain pr-1"
    >
      {list}
    </div>
  );
}