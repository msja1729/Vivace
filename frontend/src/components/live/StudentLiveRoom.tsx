"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StudentViva } from "@/types";
import { listDevices, openCameraAndMic, stopStream, streamAudio, streamFrames } from "@/lib/live/media";
import { LiveRoom, type LiveMessage } from "@/lib/live/room";
import { useAuth } from "@/lib/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Display";
import { Checkbox, FormError, inputClass } from "@/components/ui/Field";
import { MicIcon, VideoIcon } from "@/components/ui/Icons";

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
    return <DeviceCheck stream={stream} onStream={setStream} onReady={() => setStep("calibrate")} />;
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

function DeviceCheck({
  stream,
  onStream,
  onReady,
}: {
  stream: MediaStream;
  onStream: (s: MediaStream) => void;
  onReady: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState(false);
  const [silentLong, setSilentLong] = useState(false);
  const [devices, setDevices] = useState<{ mics: MediaDeviceInfo[]; cameras: MediaDeviceInfo[] }>({ mics: [], cameras: [] });
  const [error, setError] = useState<string | null>(null);
  const audioId = stream.getAudioTracks()[0]?.getSettings().deviceId ?? "";
  const videoId = stream.getVideoTracks()[0]?.getSettings().deviceId ?? "";

  useEffect(() => {
    void listDevices().then(setDevices);
  }, []);

  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
    const ctx = new AudioContext();
    void ctx.resume();
    const analyser = ctx.createAnalyser();
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let frame = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const x of data) peak = Math.max(peak, Math.abs(x - 128));
      setLevel(peak / 128);
      if (peak / 128 > 0.08) setHeard(true);
      frame = requestAnimationFrame(tick);
    };
    tick();
    // No sound at all for a while usually means a silent (virtual) input is selected.
    const hint = setTimeout(() => setSilentLong(true), 5000);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(hint);
      void ctx.close();
    };
  }, [stream]);

  async function switchTo(choice: { audioId?: string; videoId?: string }) {
    setError(null);
    try {
      const next = await openCameraAndMic({ audioId: choice.audioId ?? audioId, videoId: choice.videoId ?? videoId });
      setHeard(false);
      setSilentLong(false);
      onStream(next);
    } catch {
      setError("Couldn't open that device. It may be in use by another app.");
    }
  }

  return (
    <Card className="mx-auto max-w-2xl space-y-4">
      <h2 className="text-lg font-semibold">Check your camera and microphone</h2>
      <video ref={video} autoPlay playsInline muted className="w-full -scale-x-100 rounded-lg bg-black" />
      <ul className="space-y-1 text-sm text-muted">
        <li>Sit facing the screen, with your whole face visible and lit from the front.</li>
        <li>Clear your desk: no phone, books or second screen in view. Be alone in the room.</li>
      </ul>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-muted">
          Microphone
          <select
            value={audioId}
            onChange={(e) => switchTo({ audioId: e.target.value })}
            className={`${inputClass} mt-1 text-sm`}
          >
            {devices.mics.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || "Microphone"}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          Camera
          <select
            value={videoId}
            onChange={(e) => switchTo({ videoId: e.target.value })}
            className={`${inputClass} mt-1 text-sm`}
          >
            {devices.cameras.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || "Camera"}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex items-center gap-3 text-sm">
        <MicIcon className="h-4 w-4 text-muted" />
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.min(100, level * 250)}%` }} />
        </div>
        <span className="w-28 text-right text-xs text-muted">{heard ? "Mic works" : "Say something…"}</span>
      </div>
      {!heard && silentLong && (
        <p className="rounded-lg border border-warning/25 bg-warning/[0.06] px-3 py-2 text-xs text-muted">
          <span className="text-warning">No sound from this microphone.</span> Pick another one above. Virtual devices
          (e.g. from game-audio or streaming apps) are often silent; choose your laptop or headset microphone.
        </p>
      )}
      <FormError message={error} />
      <Button variant="accent" disabled={!heard} onClick={onReady}>
        Continue to calibration
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
  const remoteVideo = useRef<HTMLVideoElement>(null);
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
    if (remoteVideo.current) remoteVideo.current.srcObject = remote;
  }, [remote]);
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
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
        <video ref={remoteVideo} autoPlay playsInline className="h-full w-full object-contain" />
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
      </div>
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
    return (
      <div className="fixed inset-0 z-50 bg-bg">
        <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-muted">
          Keep your head still and follow the dot with your eyes ({corner + 1}/4)
        </p>
        <span className={`absolute ${pos} h-6 w-6 animate-pulse rounded-full bg-accent shadow-[0_0_24px_rgb(124_140_255)]`} />
      </div>
    );
  }

  if (phase === "voice") {
    const seconds = voiceStarted ? (now - voiceStarted) / 1000 : 0;
    return (
      <Card className="mx-auto max-w-2xl space-y-4">
        <h2 className="text-lg font-semibold">Voice sample</h2>
        <p className="text-sm text-muted">Read this sentence aloud at a normal pace. It lets us recognise your voice.</p>
        <p className="rounded-lg border border-border bg-white/[0.03] p-4 text-lg">{SENTENCE}</p>
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
