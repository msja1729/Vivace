"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type {
  ClassRoom,
  CopilotState,
  EngineStatus,
  IntegrityEvent,
  Person,
  SessionState,
  Turn,
  Viva,
  VisionStatus,
} from "@/types";
import { openCameraAndMic, stopStream, streamAudio } from "@/lib/live/media";
import { LiveRoom, type LiveMessage } from "@/lib/live/room";
import { useAuth } from "@/lib/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Section } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Display";
import { FormError } from "@/components/ui/Field";
import { ChevronLeftIcon, MicIcon, PlayIcon, StopIcon } from "@/components/ui/Icons";
import { CopilotPanel } from "./CopilotPanel";
import { EventList, ScoreMeter, Transcript, clock } from "./LiveParts";
import { DeviceCheck, MicMeter, NvidiaTip, RemoteVideo } from "./Media";
import { StudentWorkPanel } from "./StudentWorkPanel";

const NO_COPILOT: CopilotState = {
  topics: [],
  current: null,
  suggestions: [],
  mode: null,
  busy: null,
  error: null,
  notice: null,
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
  copilot: CopilotState;
  away: string[]; // the student has left the viva right now (another tab or app, or out of full screen)
  engines: Record<string, EngineStatus>;
  llm: string;
  calibration: string | null;
  vision: VisionStatus | null;
  aiReport: "writing" | "ready" | { error: string } | null;
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
  copilot: NO_COPILOT,
  away: [],
  engines: {},
  llm: "",
  calibration: null,
  vision: null,
  aiReport: null,
};

/** The examiner's live dashboard for one student: a device check, then the video call, scores,
 * transcript, integrity flags and the AI Co-Pilot; then the result form. The AI watches the video on
 * the server; the examiner sees it clean. */
export function ExaminerConsole({ cls, viva, student }: { cls: ClassRoom; viva: Viva; student: Person }) {
  const { user } = useAuth();
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [devicesChecked, setDevicesChecked] = useState(false);
  const [remote, setRemote] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [conn, setConn] = useState<{ state: "connecting" | "open" | "closed"; reason?: string }>({ state: "connecting" });
  const [s, setS] = useState<RoomState>(EMPTY);
  const [micOn, setMicOn] = useState(true);
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
          copilot: (m.copilot as CopilotState) ?? p.copilot,
          engines: (m.engines as Record<string, EngineStatus>) ?? p.engines,
          llm: (m.llm as string) ?? p.llm,
          aiReport: m.status === "ended" && p.status === "live" ? "writing" : p.aiReport,
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
          vision: (m.vision as VisionStatus | null) ?? null,
          away: (m.away as string[]) ?? [],
        }));
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
      case "copilot":
        setS((p) => ({ ...p, copilot: m as unknown as CopilotState }));
        break;
      case "ai_report":
        setS((p) => ({ ...p, aiReport: m.error ? { error: m.error as string } : "ready" }));
        break;
      case "calibration":
        setS((p) => ({ ...p, calibration: m.step as string }));
        break;
    }
  }

  // 1. Camera + mic. Switching devices in the check replaces the stream (and stops the old one).
  useEffect(() => {
    let cancelled = false;
    openCameraAndMic().then(
      (stream) => (cancelled ? stopStream(stream) : setLocal(stream)),
      () => setMediaError("Allow camera and microphone access so the student can see and hear you."),
    );
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => () => stopStream(local), [local]);

  // 2. Once the devices are checked: the room, and your voice to the transcript too
  //    (questions are paired with the student's answers).
  useEffect(() => {
    if (!devicesChecked || !local) return;
    let stopAudio: (() => void) | null = null;
    const r = new LiveRoom(viva.id, student.id, "examiner", local, {
      onMessage: (m) => apply(m),
      onRemoteStream: setRemote,
      onConnection: (state, reason) => setConn({ state, reason }),
    });
    room.current = r;
    r.connect();
    void streamAudio(local, r).then(
      (stop) => (stopAudio = stop),
      () => {},
    );
    return () => {
      stopAudio?.();
      r.close();
      room.current = null;
    };
  }, [devicesChecked, local, viva.id, student.id]);

  useEffect(() => {
    if (selfView.current) selfView.current.srcObject = local;
  }, [local, devicesChecked]); // the self-view mounts when the device check is done

  const send = (m: LiveMessage) => room.current?.send(m);
  const ask = (text: string) => {
    if (!text.trim()) return;
    send({ type: "show_question", text: text.trim() });
  };

  const examinerName = user?.name ?? "Examiner";

  if (!devicesChecked) {
    return (
      <div className="space-y-5">
        <Link
          href={`/classes/${cls.id}/vivas/${viva.id}`}
          className="inline-flex items-center gap-1 text-xs text-subtle transition hover:text-text"
        >
          <ChevronLeftIcon className="h-3.5 w-3.5" /> {viva.title} · {student.name}
        </Link>
        <FormError message={mediaError} />
        {local ? (
          <DeviceCheck
            stream={local}
            onStream={setLocal}
            onReady={() => setDevicesChecked(true)}
            readyLabel="Join the live room"
            tips={
              <div className="space-y-3">
                <p className="text-sm text-muted">Make sure the student will hear you: speak and watch the bar move.</p>
                <NvidiaTip />
              </div>
            }
          />
        ) : (
          !mediaError && <p className="text-sm text-muted">Opening your camera and microphone…</p>
        )}
      </div>
    );
  }
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

      {s.status === "ended" && sessionId && (
        <div className="panel flex flex-wrap items-center justify-between gap-3 rounded-2xl p-5">
          <div>
            <p className="font-semibold">The interview has ended</p>
            <p className="text-sm text-muted">
              {s.aiReport === "ready"
                ? "The AI's report is ready. Open the report to check the marks and send the results to the student."
                : s.aiReport && typeof s.aiReport === "object"
                  ? `The AI couldn't write its report (${s.aiReport.error}). You can retry from the report.`
                  : "The AI is writing its report. Open the report to give marks and send the results."}
            </p>
          </div>
          <Button variant="accent" href={`/classes/${cls.id}/vivas/${viva.id}/report/${sessionId}`}>
            Open report
          </Button>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-5">
          <div className="relative">
            <RemoteVideo stream={remote}>
            {s.status === "live" && (
              <span
                className={`absolute top-3 left-3 rounded-full px-3 py-1 text-xs font-medium text-white backdrop-blur ${
                  s.risk >= 60 ? "bg-danger/85" : s.risk >= 30 ? "bg-warning/85" : "bg-black/45"
                }`}
              >
                Risk {Math.round(s.risk)}% · {s.events.length} flag{s.events.length === 1 ? "" : "s"}
              </span>
            )}
            {s.status === "live" && s.away.length > 0 && (
              <span className="absolute top-3 right-3 rounded-full bg-danger/90 px-3 py-1 text-xs font-medium text-white backdrop-blur">
                {s.away.includes("tab_switch") ? "Student left the viva (another tab or app)" : "Student left full screen"}
              </span>
            )}
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
            </RemoteVideo>
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
            <MicMeter stream={local} muted={!micOn} />
            <ProctorStatus vision={s.vision} live={s.status === "live"} />
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
            <Transcript turns={s.turns} examinerName={examinerName} studentName={student.name} follow />
            {s.status === "live" && (
              <Button size="sm" variant="ghost" className="mt-3" onClick={() => send({ type: "grade_now" })}>
                Grade the current answer now
              </Button>
            )}
          </Section>

          <StudentWorkPanel vivaId={viva.id} studentId={student.id} />
        </div>

        {/* Stays in view while you scroll the student's work and the transcript. */}
        <div className="space-y-5 xl:sticky xl:top-5 xl:max-h-[calc(100vh-2.5rem)] xl:self-start xl:overflow-y-auto xl:pr-1">
          <CopilotPanel c={s.copilot} live={s.status === "live"} send={send} ask={ask} />

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

/** What the proctoring sees right now: proof it is watching, without drawing on the video. */
function ProctorStatus({ vision: v, live }: { vision: VisionStatus | null; live: boolean }) {
  if (!v) {
    return <span className={live ? "text-warning" : ""}>AI proctoring: {live ? "no video from the student" : "waiting for video"}</span>;
  }
  const faces = v.faces === 1 ? "1 face" : v.faces === 0 ? "no face" : `${v.faces} faces`;
  const gaze = v.gaze === "away" ? "looking away" : v.gaze === "up" ? "looking up" : v.gaze === "screen" ? "eyes on screen" : null;
  const alert = v.faces !== 1 || v.gaze === "away" || v.objects.length > 0 || (v.persons ?? 1) > 1;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${alert ? "bg-warning" : "bg-success"}`} />
      AI proctoring: {faces}
      {gaze && ` · ${gaze}`}
      {(v.persons ?? 0) > 1 && ` · ${v.persons} people`}
      {v.objects.length > 0 && ` · ${v.objects.join(", ")} in view`}
    </span>
  );
}
