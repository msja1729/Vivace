"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { StudentViva } from "@/types";
import { openCameraAndMic, stopStream, streamAudio, streamFrames } from "@/lib/live/media";
import { LiveRoom, type LiveMessage } from "@/lib/live/room";
import { useAuth } from "@/lib/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Display";
import { Checkbox, FormError } from "@/components/ui/Field";
import { MicIcon, VideoIcon } from "@/components/ui/Icons";
import { DeviceCheck, RemoteVideo } from "./Media";

type Step = "consent" | "devices" | "calibrate" | "room" | "ended";
const CORNERS = ["top-left", "top-right", "bottom-right", "bottom-left"] as const;
const CORNER_MS = 2500;
const SENTENCE = "I confirm that I am taking this viva on my own, and that every answer I give is my own work.";

/** The student's side of a staff-run viva. */
export function StudentLiveRoom({ v, onEnded }: { v: StudentViva; onEnded: () => void }) {
  const [step, setStep] = useState<Step>("consent");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => stopStream(stream), [stream]);

  async function openDevices() {
    setError(null);
    try {
      setStream(await openCameraAndMic());
      setStep("devices");
    } catch {
      setError("Camera and microphone access was blocked. Allow it in your browser's address bar, then try again.");
    }
  }

  if (step === "consent") return <Consent examiner={v.examiner?.name} onAgree={openDevices} error={error} />;
  if (step === "devices" && stream)
    return (
      <DeviceCheck
        stream={stream}
        onStream={setStream}
        onReady={() => setStep("calibrate")}
        readyLabel="Continue to calibration"
        tips={
          <ul className="space-y-1 text-sm text-muted">
            <li>Sit facing the screen, with your whole face visible and lit from the front.</li>
            <li>Clear your desk: no phone, books or second screen in view. Be alone in the room.</li>
          </ul>
        }
      />
    );
  if (stream && (step === "calibrate" || step === "room"))
    return (
      <Room
        v={v}
        stream={stream}
        calibrating={step === "calibrate"}
        onCalibrated={() => setStep("room")}
        onEnded={() => {
          setStep("ended");
          stopStream(stream);
          onEnded();
        }}
      />
    );
  return null;
}

function Consent({ examiner, onAgree, error }: { examiner?: string; onAgree: () => void; error: string | null }) {
  const [ok, setOk] = useState(false);
  return (
    <Card className="mx-auto max-w-2xl space-y-4">
      <h2 className="text-lg font-semibold">Before you start</h2>
      <p className="text-sm text-muted">
        {examiner ? `${examiner} will interview you` : "Your examiner will interview you"} by video. While the viva runs:
      </p>
      <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
        <li>Your camera image is analysed for integrity signals (looking away, another person, a phone or book in view).</li>
        <li>Your voice is transcribed, compared with a short voice sample you record now, and your answers are assessed by AI.</li>
        <li>When something is flagged, a snapshot is saved for your examiner. Nothing else is recorded.</li>
        <li>Flags are advisory only: a person reviews them before any decision. Data stays on the institute&apos;s server.</li>
      </ul>
      <Checkbox label="I understand and agree" checked={ok} onChange={(e) => setOk(e.target.checked)} />
      <FormError message={error} />
      <Button variant="accent" disabled={!ok} onClick={onAgree}>
        Allow camera & microphone
      </Button>
    </Card>
  );
}

function Room({
  v,
  stream,
  calibrating,
  onCalibrated,
  onEnded,
}: {
  v: StudentViva;
  stream: MediaStream;
  calibrating: boolean;
  onCalibrated: () => void;
  onEnded: () => void;
}) {
  const { user } = useAuth();
  const room = useRef<LiveRoom | null>(null);
  const [remote, setRemote] = useState<MediaStream | null>(null);
  const [conn, setConn] = useState<{ state: string; reason?: string }>({ state: "connecting" });
  const [status, setStatus] = useState<string>("waiting");
  const [examinerOnline, setExaminerOnline] = useState(false);
  const [question, setQuestion] = useState<string | null>(null);
  const [alreadyCalibrated, setAlreadyCalibrated] = useState(false);
  const selfVideo = useRef<HTMLVideoElement>(null);
  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);
  const send = useCallback((m: LiveMessage) => room.current?.send(m), []);

  useEffect(() => {
    if (!user) return;
    const r = new LiveRoom(v.id, user.id, "student", stream, {
      onMessage: (m: LiveMessage) => {
        if (m.type === "state") {
          setStatus(m.status as string);
          setExaminerOnline(Boolean(m.examinerOnline));
          setAlreadyCalibrated(Boolean(m.calibrated) && Boolean(m.voiceEnrolled));
          if (m.status === "ended") onEndedRef.current();
        } else if (m.type === "presence" && "examiner" in m) setExaminerOnline(Boolean(m.examiner));
        else if (m.type === "question") setQuestion(m.text as string);
        else if (m.type === "ended") onEndedRef.current();
      },
      onRemoteStream: setRemote,
      onConnection: (state, reason) => setConn({ state, reason }),
    });
    room.current = r;
    r.connect();
    const stopFrames = streamFrames(stream, r);
    let stopAudio: (() => void) | null = null;
    void streamAudio(stream, r).then((stop) => (stopAudio = stop));
    return () => {
      stopFrames();
      stopAudio?.();
      r.close();
      room.current = null;
    };
  }, [v.id, user, stream]);

  useEffect(() => {
    if (selfVideo.current) selfVideo.current.srcObject = stream;
  }, [stream, calibrating]);

  if (conn.state === "closed")
    return (
      <Card className="text-center text-sm text-danger">{conn.reason ?? "You were disconnected from the viva."}</Card>
    );

  if (calibrating)
    return (
      <Calibration
        ready={conn.state === "open"}
        skip={alreadyCalibrated}
        send={send}
        onDone={onCalibrated}
      />
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {status === "live" ? <Badge tone="success">Live</Badge> : <Badge tone="accent">Waiting room</Badge>}
        {conn.state !== "open" && <span className="text-sm text-warning">Reconnecting…</span>}
      </div>
      <RemoteVideo stream={remote}>
        {!remote && (
          <p className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-muted">
            {examinerOnline
              ? "Connecting to your examiner…"
              : `Waiting for ${v.examiner?.name ?? "your examiner"} to open the room. Stay on this page.`}
          </p>
        )}
        <video
          ref={selfVideo}
          autoPlay
          playsInline
          muted
          className="absolute right-3 bottom-3 w-40 -scale-x-100 rounded-lg border border-border-strong bg-black"
        />
      </RemoteVideo>
      {status === "waiting" && remote && (
        <p className="text-sm text-muted">Your examiner can see you. The viva starts when they begin the interview.</p>
      )}
      {question && (
        <div className="rounded-xl border border-accent/40 bg-accent-soft p-4">
          <p className="text-xs text-accent">Question</p>
          <p className="mt-1 text-lg">{question}</p>
        </div>
      )}
      <p className="text-xs text-subtle">
        Keep your face in view and answer out loud. Don&apos;t switch tabs or use other devices.
      </p>
    </div>
  );
}

/** Look at four dots (gaze bounds), then read one sentence (voice print). */
function Calibration({
  ready,
  skip,
  send,
  onDone,
}: {
  ready: boolean;
  skip: boolean;
  send: (m: LiveMessage) => void;
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<"intro" | "corners" | "voice">("intro");
  const [corner, setCorner] = useState(0);
  const [voiceStarted, setVoiceStarted] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (phase !== "corners") return;
    send({ type: "calibration", step: "corners_start" });
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      if (i < CORNERS.length) setCorner(i);
      else {
        clearInterval(timer);
        send({ type: "calibration", step: "corners_done" });
        setPhase("voice");
      }
    }, CORNER_MS);
    return () => clearInterval(timer);
  }, [phase, send]);

  useEffect(() => {
    if (voiceStarted === null) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [voiceStarted]);

  if (phase === "corners") {
    const pos = {
      "top-left": "top-6 left-6",
      "top-right": "top-6 right-6",
      "bottom-right": "bottom-6 right-6",
      "bottom-left": "bottom-6 left-6",
    }[CORNERS[corner]];
    // Rendered on <body>: the corners must be the screen's corners, not those of the app's glass
    // window (its blur makes it the frame that `fixed` elements are placed in).
    return createPortal(
      <div className="fixed inset-0 z-50 bg-bg">
        <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-muted">
          Keep your head still and follow the dot with your eyes ({corner + 1}/4)
        </p>
        <span className={`absolute ${pos} h-6 w-6 animate-pulse rounded-full bg-accent shadow-[0_0_24px_rgb(124_140_255)]`} />
      </div>,
      document.body,
    );
  }

  if (phase === "voice") {
    const seconds = voiceStarted ? (now - voiceStarted) / 1000 : 0;
    return (
      <Card className="mx-auto max-w-2xl space-y-4">
        <h2 className="text-lg font-semibold">Voice sample</h2>
        <p className="text-sm text-muted">Read this sentence aloud at a normal pace. It lets us recognise your voice.</p>
        <p className="rounded-lg border border-border bg-tint p-4 text-lg">{SENTENCE}</p>
        {voiceStarted === null ? (
          <Button
            variant="accent"
            onClick={() => {
              send({ type: "calibration", step: "voice_start" });
              setVoiceStarted(Date.now());
              setNow(Date.now());
            }}
          >
            <MicIcon className="h-4 w-4" /> Start reading
          </Button>
        ) : (
          <Button
            variant="accent"
            disabled={seconds < 4}
            onClick={() => {
              send({ type: "calibration", step: "voice_done" });
              onDone();
            }}
          >
            {seconds < 4 ? `Reading… ${Math.ceil(4 - seconds)}` : "Done"}
          </Button>
        )}
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-2xl space-y-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <VideoIcon className="h-5 w-5 text-accent" /> Calibration (about 30 seconds)
      </h2>
      <p className="text-sm text-muted">
        First, follow a dot to the four corners of your screen with your eyes. Then read one sentence aloud.
      </p>
      <div className="flex gap-2">
        <Button variant="accent" disabled={!ready} onClick={() => setPhase("corners")}>
          {ready ? "Start calibration" : "Connecting…"}
        </Button>
        {skip && (
          <Button variant="ghost" onClick={onDone}>
            Skip (already calibrated)
          </Button>
        )}
      </div>
    </Card>
  );
}
