"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ClassRoom, EngineStatus, IntegrityEvent, Person, SessionReport, SessionState, Suggestion, Turn, Viva } from "@/types";
import { getSessionReport, saveSessionResult } from "@/lib/api/vivas";
import { openCameraAndMic, stopStream, streamAudio } from "@/lib/live/media";
import { LiveRoom, type LiveMessage } from "@/lib/live/room";
import { useAuth } from "@/lib/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Section } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Display";
import { Checkbox, FormError, TextAreaField, inputClass } from "@/components/ui/Field";
import { ChevronLeftIcon, MicIcon, PlayIcon, SparkleIcon, StopIcon } from "@/components/ui/Icons";
import { EventList, OverlayVideo, ScoreMeter, Transcript, clock, type FrameOverlay } from "./LiveParts";

const KIND_LABEL: Record<Suggestion["kind"], string> = {
  opening: "Opening",
  follow_up: "Follow-up",
  devils_advocate: "Devil's advocate",
};

interface RoomState {
  status: SessionState;
  studentOnline: boolean;
  t: number;
  risk: number;
  mastery: number | null;
  fps: number;
  studentSpeaking: boolean;
  events: IntegrityEvent[];
  turns: Turn[];
  suggestions: Suggestion[];
  suggestionsError: string | null;
  suggestionsLoading: boolean;
  engines: Record<string, EngineStatus>;
  llm: string;
  meshSegments: number[][];
  calibration: string | null;
}

const EMPTY: RoomState = {
  status: "waiting",
  studentOnline: false,
  t: 0,
  risk: 0,
  mastery: null,
  fps: 0,
  studentSpeaking: false,
  events: [],
  turns: [],
  suggestions: [],
  suggestionsError: null,
  suggestionsLoading: false,
  engines: {},
  llm: "",
  meshSegments: [],
  calibration: null,
};

/** The examiner's live dashboard for one student: video call with overlays, scores, transcript,
 * integrity flags and the AI Co-Pilot; then the result form. */
export function ExaminerConsole({ cls, viva, student }: { cls: ClassRoom; viva: Viva; student: Person }) {
  const { user } = useAuth();
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [remote, setRemote] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [conn, setConn] = useState<{ state: "connecting" | "open" | "closed"; reason?: string }>({ state: "connecting" });
  const [s, setS] = useState<RoomState>(EMPTY);
  const [overlay, setOverlay] = useState<FrameOverlay | null>(null);
  const [showOverlay, setShowOverlay] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [question, setQuestion] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const room = useRef<LiveRoom | null>(null);
  const selfView = useRef<HTMLVideoElement>(null);

  // Applies one message from the room. Only calls state setters.
  function apply(m: LiveMessage) {
    switch (m.type) {
      case "state":
        setSessionId(m.sessionId as string);
        setS((p) => ({
          ...p,
          status: m.status as SessionState,
          studentOnline: Boolean(m.studentOnline),
          t: (m.t as number) ?? p.t,
          risk: (m.risk as number) ?? 0,
          mastery: (m.mastery as number | null) ?? null,
          events: (m.events as IntegrityEvent[]) ?? p.events,
          turns: (m.turns as Turn[]) ?? p.turns,
          suggestions: (m.suggestions as Suggestion[]) ?? p.suggestions,
          suggestionsError: (m.suggestionsError as string | null) ?? null,
          engines: (m.engines as Record<string, EngineStatus>) ?? p.engines,
          llm: (m.llm as string) ?? p.llm,
          meshSegments: (m.meshSegments as number[][]) ?? p.meshSegments,
        }));
        break;
      case "presence":
        if ("student" in m) setS((p) => ({ ...p, studentOnline: Boolean(m.student) }));
        break;
      case "scores":
        setS((p) => ({
          ...p,
          t: m.t as number,
          risk: m.risk as number,
          mastery: m.mastery as number | null,
          fps: m.fps as number,
          studentSpeaking: Boolean(m.studentSpeaking),
          status: m.status as SessionState,
        }));
        break;
      case "frame":
        setOverlay(m as unknown as FrameOverlay);
        break;
      case "event": {
        const e = m.event as IntegrityEvent;
        setS((p) => ({ ...p, events: [...p.events.filter((x) => x.id !== e.id), e].sort((a, b) => a.startTs - b.startTs) }));
        break;
      }
      case "turn":
        setS((p) => ({ ...p, turns: [...p.turns, m.turn as Turn] }));
        break;
      case "grade":
        setS((p) => ({
          ...p,
          mastery: (m.mastery as number | null) ?? p.mastery,
          turns: p.turns.map((t) => (t.id === m.turnId ? { ...t, analysis: m.analysis as Turn["analysis"] } : t)),
        }));
        break;
      case "suggestions":
        setS((p) => ({
          ...p,
          suggestions: (m.items as Suggestion[]) ?? p.suggestions,
          suggestionsError: (m.error as string | null) ?? null,
          suggestionsLoading: Boolean(m.loading),
        }));
        break;
      case "calibration":
        setS((p) => ({ ...p, calibration: m.step as string }));
        break;
    }
  }

  // Camera + mic, then the room.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopAudio: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        stream = await openCameraAndMic();
      } catch {
        setMediaError("Allow camera and microphone access so the student can see and hear you.");
        return;
      }
      if (cancelled) return stopStream(stream);
      setLocal(stream);
      const r = new LiveRoom(viva.id, student.id, "examiner", stream, {
        onMessage: (m) => apply(m),
        onRemoteStream: setRemote,
        onConnection: (state, reason) => setConn({ state, reason }),
      });
      room.current = r;
      r.connect();
      // Your voice goes to the transcript too (questions are paired with the student's answers).
      stopAudio = await streamAudio(stream, r).catch(() => null);
    })();
    return () => {
      cancelled = true;
      stopAudio?.();
      room.current?.close();
      room.current = null;
      stopStream(stream);
    };
  }, [viva.id, student.id]);

  useEffect(() => {
    if (selfView.current) selfView.current.srcObject = local;
  }, [local]);

  const send = (m: LiveMessage) => room.current?.send(m);
  const ask = (text: string) => {
    if (!text.trim()) return;
    send({ type: "show_question", text: text.trim() });
    setQuestion("");
  };

  const examinerName = user?.name ?? "Examiner";
  const engineProblems = Object.values(s.engines).filter((e) => e.state === "error");

  return (
    <div className="space-y-5">
      <div>
        <Link
          href={`/classes/${cls.id}/vivas/${viva.id}`}
          className="inline-flex items-center gap-1 text-xs text-subtle transition hover:text-text"
        >
          <ChevronLeftIcon className="h-3.5 w-3.5" /> {viva.title} · Live room
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{student.name}</h1>
            <StatusBadge status={s.status} online={s.studentOnline} />
            {s.status === "live" && <span className="text-sm text-muted tabular-nums">{clock(s.t)}</span>}
          </div>
          <div className="flex gap-2">
            {s.status === "waiting" && (
              <Button variant="accent" disabled={!s.studentOnline || conn.state !== "open"} onClick={() => send({ type: "start" })}>
                <PlayIcon className="h-4 w-4" /> Start interview
              </Button>
            )}
            {s.status === "live" && (
              <Button variant="danger" onClick={() => send({ type: "end" })}>
                <StopIcon className="h-4 w-4" /> End interview
              </Button>
            )}
          </div>
        </div>
        {conn.state !== "open" && (
          <p className="mt-2 text-sm text-warning">{conn.state === "connecting" ? "Connecting to the live room…" : conn.reason ?? "Disconnected."}</p>
        )}
        <FormError message={mediaError} />
        {s.status === "waiting" && (
          <p className="mt-2 text-sm text-muted">
            {s.studentOnline
              ? s.calibration === "corners_done" || s.calibration === "voice_done"
                ? "The student has calibrated. Start when you're ready."
                : "The student is in the waiting room (consent, device check and calibration)."
              : "Waiting for the student to join."}
          </p>
        )}
      </div>

      {s.status === "ended" && sessionId && <ResultForm viva={viva} sessionId={sessionId} classId={cls.id} />}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-5">
          <div className="relative">
            <OverlayVideo stream={remote} overlay={overlay} segments={s.meshSegments} show={showOverlay} />
            {!remote && (
              <p className="absolute inset-0 grid place-items-center text-sm text-muted">
                {s.studentOnline ? "Connecting video…" : "The student's video appears here."}
              </p>
            )}
            <video
              ref={selfView}
              autoPlay
              playsInline
              muted
              className="absolute right-3 bottom-3 w-36 -scale-x-100 rounded-lg border border-border-strong bg-black"
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
            <Button
              size="sm"
              variant={micOn ? "outline" : "danger"}
              disabled={!local}
              onClick={() => {
                // A disabled track sends silence: to the student and to the transcript.
                local?.getAudioTracks().forEach((t) => (t.enabled = !micOn));
                setMicOn(!micOn);
              }}
            >
              <MicIcon className="h-3.5 w-3.5" /> {micOn ? "Mute mic" : "Unmute mic"}
            </Button>
            <Checkbox label="Show AI overlays" checked={showOverlay} onChange={(e) => setShowOverlay(e.target.checked)} />
            <span className="tabular-nums">Vision {s.fps.toFixed(1)} fps</span>
            {s.studentSpeaking && <Badge tone="accent">Student speaking</Badge>}
            {engineProblems.map((e) => (
              <span key={e.label} className="text-warning" title={e.detail}>
                {e.label}: off
              </span>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <ScoreMeter label="Cheating risk" value={s.risk} kind="risk" hint="Advisory: review the flags before deciding." />
            <ScoreMeter
              label="Conceptual mastery"
              value={s.mastery}
              kind="mastery"
              hint={s.mastery === null ? "Appears after the first graded answer." : "Average over graded answers."}
            />
          </div>

          <Section title="Transcript" description="Speech-to-text of both of you, with the Grader's notes on each answer.">
            <div className="max-h-[32rem] overflow-y-auto pr-1">
              <Transcript turns={s.turns} examinerName={examinerName} studentName={student.name} follow />
            </div>
            {s.status === "live" && (
              <Button size="sm" variant="ghost" className="mt-3" onClick={() => send({ type: "grade_now" })}>
                Grade the current answer now
              </Button>
            )}
          </Section>
        </div>

        <div className="space-y-5">
          <Section
            title="Co-Pilot"
            description="Suggested questions from the student's work and their weak points."
            actions={
              <Button size="sm" variant="ghost" disabled={s.suggestionsLoading} onClick={() => send({ type: "suggest" })}>
                <SparkleIcon className="h-3.5 w-3.5" /> {s.suggestionsLoading ? "Thinking…" : "Refresh"}
              </Button>
            }
          >
            {s.suggestionsError && <p className="mb-3 text-xs text-warning">{s.suggestionsError}</p>}
            {s.suggestions.length === 0 ? (
              <p className="text-sm text-muted">{s.suggestionsLoading ? "Reading the student's work…" : "No suggestions yet."}</p>
            ) : (
              <ul className="space-y-3">
                {s.suggestions.map((q, i) => (
                  <li key={i} className="rounded-lg border border-border bg-white/[0.02] p-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={q.kind === "devils_advocate" ? "warning" : "accent"}>{KIND_LABEL[q.kind] ?? q.kind}</Badge>
                      {q.criterion && <span className="text-xs text-subtle">{q.criterion}</span>}
                    </div>
                    <p className="mt-2 text-sm">{q.question}</p>
                    <p className="mt-1 text-xs text-muted">{q.why}</p>
                    <Button size="sm" variant="outline" className="mt-2" disabled={s.status !== "live"} onClick={() => ask(q.question)}>
                      Show to student
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <form
              className="mt-4 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                ask(question);
              }}
            >
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Type your own question"
                aria-label="Your own question"
                className={inputClass}
                disabled={s.status !== "live"}
              />
              <Button type="submit" size="sm" variant="outline" disabled={s.status !== "live" || !question.trim()}>
                Show
              </Button>
            </form>
            <p className="mt-2 text-xs text-subtle">Ask out loud as usual; &quot;Show&quot; also puts the question on the student&apos;s screen.</p>
          </Section>

          <Section title="Integrity flags" description="Advisory. Click a flag to see its snapshot.">
            <div className="max-h-96 overflow-y-auto pr-1">
              <EventList sessionId={sessionId ?? ""} events={s.events} empty={s.status === "live" ? "No flags so far." : "Flags appear once the interview starts."} />
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status, online }: { status: SessionState; online: boolean }) {
  if (status === "ended") return <Badge>Ended</Badge>;
  if (status === "live") return <Badge tone="success">Live</Badge>;
  return <Badge tone={online ? "accent" : "neutral"}>{online ? "In waiting room" : "Not joined"}</Badge>;
}

/** After the interview: the examiner's score, per-criterion scores (pre-filled with the AI's averages) and notes. */
function ResultForm({ viva, sessionId, classId }: { viva: Viva; sessionId: string; classId: string }) {
  const [report, setReport] = useState<SessionReport | null>(null);
  const [score, setScore] = useState("");
  const [criteria, setCriteria] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSessionReport(sessionId).then((r) => {
      setReport(r);
      setNotes(r.notes);
      if (r.score !== null) setScore(String(r.score));
      const given = new Map(r.criteriaScores.map((c) => [c.name, c.score]));
      const suggested = new Map(r.suggestedCriteriaScores.map((c) => [c.name, c.score]));
      setCriteria(
        Object.fromEntries(
          r.evaluationCriteria.map((c) => [c.name, String(given.get(c.name) ?? suggested.get(c.name) ?? "")]),
        ),
      );
      setSaved(r.score !== null);
    }, (e: Error) => setError(e.message));
  }, [sessionId]);

  // Weighted average of the criterion scores, as a starting point for the overall score.
  const weighted = useMemo(() => {
    let total = 0;
    let weight = 0;
    for (const c of viva.evaluationCriteria) {
      const v = Number(criteria[c.name]);
      if (criteria[c.name] !== "" && !Number.isNaN(v)) {
        total += v * c.weight;
        weight += c.weight;
      }
    }
    return weight ? Math.round((total / weight) * 10) / 10 : null;
  }, [criteria, viva.evaluationCriteria]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await saveSessionResult(sessionId, {
        score: Number(score),
        criteriaScores: viva.evaluationCriteria.map((c) => ({
          name: c.name,
          score: criteria[c.name] === "" || criteria[c.name] === undefined ? null : Number(criteria[c.name]),
        })),
        notes,
      });
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!report) return error ? <FormError message={error} /> : null;
  return (
    <Section
      title="Result"
      description="Your decision. The AI's numbers are suggestions; flags are advisory."
      actions={
        <Button size="sm" variant="outline" href={`/classes/${classId}/vivas/${viva.id}/report/${sessionId}`}>
          Open report
        </Button>
      }
    >
      <div className="grid gap-4 md:grid-cols-[1fr_2fr]">
        <div className="space-y-3">
          {viva.evaluationCriteria.map((c) => (
            <label key={c.name} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{c.name}</span>
              <input
                type="number"
                min={0}
                max={10}
                step={0.5}
                value={criteria[c.name] ?? ""}
                onChange={(e) => setCriteria((x) => ({ ...x, [c.name]: e.target.value }))}
                className={`${inputClass} w-20`}
                aria-label={`${c.name} score out of 10`}
              />
            </label>
          ))}
          <label className="flex items-center justify-between gap-3 border-t border-border pt-3 text-sm font-semibold">
            Overall (out of 10)
            <input
              type="number"
              min={0}
              max={10}
              step={0.5}
              value={score}
              placeholder={weighted !== null ? String(weighted) : ""}
              onChange={(e) => setScore(e.target.value)}
              className={`${inputClass} w-20`}
            />
          </label>
          {weighted !== null && score === "" && (
            <button type="button" className="text-xs text-accent" onClick={() => setScore(String(weighted))}>
              Use weighted average ({weighted})
            </button>
          )}
        </div>
        <TextAreaField label="Notes for the report" name="notes" rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button variant="accent" disabled={busy || score === ""} onClick={save}>
          {busy ? "Saving…" : saved ? "Update result" : "Save result"}
        </Button>
        {saved && !busy && <span className="text-sm text-success">Saved</span>}
        <FormError message={error} />
      </div>
    </Section>
  );
}
