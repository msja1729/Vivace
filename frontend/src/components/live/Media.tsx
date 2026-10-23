"use client";

// Camera / microphone pieces shared by the student and the examiner: the device check before
// joining, a live microphone meter, and the other person's video (with sound).

import { useEffect, useRef, useState } from "react";
import { listDevices, openCameraAndMic } from "@/lib/live/media";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError, inputClass } from "@/components/ui/Field";
import { MicIcon } from "@/components/ui/Icons";

/** How loud the microphone is right now (0..1), about 15 times a second. */
export function useMicLevel(stream: MediaStream | null): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!stream || !stream.getAudioTracks().length) return;
    const ctx = new AudioContext();
    void ctx.resume();
    const analyser = ctx.createAnalyser();
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const timer = setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const x of data) peak = Math.max(peak, Math.abs(x - 128));
      setLevel(peak / 128);
    }, 66);
    return () => {
      clearInterval(timer);
      void ctx.close();
    };
  }, [stream]);
  return level;
}

/** A small bar showing that the microphone picks up sound. */
export function MicMeter({ stream, muted = false }: { stream: MediaStream | null; muted?: boolean }) {
  const level = useMicLevel(stream);
  return (
    <span className="inline-flex items-center gap-2" title="Your microphone level">
      <MicIcon className="h-3.5 w-3.5" />
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-raised">
        <span
          className="block h-full rounded-full bg-accent transition-[width] duration-75"
          style={{ width: muted ? 0 : `${Math.min(100, level * 250)}%` }}
        />
      </span>
    </span>
  );
}

/**
 * Camera and microphone check before joining: pick devices, see yourself, and prove the mic picks
 * up sound. Joining is blocked until it does: a silent (often virtual) microphone is the usual
 * reason the other person can't hear you.
 */
export function DeviceCheck({
  stream,
  onStream,
  onReady,
  readyLabel,
  tips,
}: {
  stream: MediaStream;
  onStream: (s: MediaStream) => void;
  onReady: () => void;
  readyLabel: string;
  tips?: React.ReactNode;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const level = useMicLevel(stream);
  const [heardFor, setHeardFor] = useState<MediaStream | null>(null);
  const [silentFor, setSilentFor] = useState<MediaStream | null>(null);
  const [devices, setDevices] = useState<{ mics: MediaDeviceInfo[]; cameras: MediaDeviceInfo[] }>({ mics: [], cameras: [] });
  const [error, setError] = useState<string | null>(null);
  const audioId = stream.getAudioTracks()[0]?.getSettings().deviceId ?? "";
  const videoId = stream.getVideoTracks()[0]?.getSettings().deviceId ?? "";
  const heard = heardFor === stream || level > 0.08;
  if (level > 0.08 && heardFor !== stream) setHeardFor(stream);

  useEffect(() => {
    void listDevices().then(setDevices);
  }, []);

  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
    // No sound at all for a while usually means a silent (virtual) input is selected.
    const hint = setTimeout(() => setSilentFor(stream), 5000);
    return () => clearTimeout(hint);
  }, [stream]);

  async function switchTo(choice: { audioId?: string; videoId?: string }) {
    setError(null);
    try {
      onStream(await openCameraAndMic({ audioId: choice.audioId ?? audioId, videoId: choice.videoId ?? videoId }));
    } catch {
      setError("Couldn't open that device. It may be in use by another app.");
    }
  }

  return (
    <Card className="mx-auto max-w-2xl space-y-4">
      <h2 className="text-lg font-semibold">Check your camera and microphone</h2>
      <video ref={video} autoPlay playsInline muted className="w-full -scale-x-100 rounded-lg bg-black" />
      {tips}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-muted">
          Microphone
          <select value={audioId} onChange={(e) => switchTo({ audioId: e.target.value })} className={`${inputClass} mt-1 text-sm`}>
            {devices.mics.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || "Microphone"}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          Camera
          <select value={videoId} onChange={(e) => switchTo({ videoId: e.target.value })} className={`${inputClass} mt-1 text-sm`}>
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
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-raised">
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.min(100, level * 250)}%` }} />
        </div>
        <span className="w-28 text-right text-xs text-muted">{heard ? "Mic works" : "Say something…"}</span>
      </div>
      {!heard && silentFor === stream && (
        <p className="rounded-lg border border-warning/25 bg-warning/[0.06] px-3 py-2 text-xs text-muted">
          <span className="text-warning">No sound from this microphone.</span> Pick another one above. Virtual devices
          (e.g. from game-audio or streaming apps) are often silent; choose your laptop or headset microphone.
        </p>
      )}
      <FormError message={error} />
      <Button variant="accent" disabled={!heard} onClick={onReady}>
        {readyLabel}
      </Button>
    </Card>
  );
}

/**
 * The other person's video, with their voice. Browsers may refuse to start sound on their own;
 * then the video plays muted and a "Turn on sound" button appears, instead of silently failing.
 */
export function RemoteVideo({ stream, children }: { stream: MediaStream | null; children?: React.ReactNode }) {
  const video = useRef<HTMLVideoElement>(null);
  const [blockedFor, setBlockedFor] = useState<MediaStream | null>(null);
  const soundBlocked = !!stream && blockedFor === stream;

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.srcObject = stream;
    if (!stream) return;
    v.muted = false;
    v.play().catch(() => {
      // Sound wasn't allowed yet: show the picture now, and ask for one click for the sound.
      v.muted = true;
      void v.play().catch(() => {});
      setBlockedFor(stream);
    });
  }, [stream]);

  function enableSound() {
    const v = video.current;
    if (!v) return;
    v.muted = false;
    void v.play().then(() => setBlockedFor(null), () => {});
  }

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
      <video ref={video} autoPlay playsInline className="h-full w-full object-contain" />
      {soundBlocked && (
        <button
          type="button"
          onClick={enableSound}
          className="brand-gradient absolute top-3 left-1/2 -translate-x-1/2 rounded-full px-4 py-2 text-sm font-medium text-white shadow-lg"
        >
          Turn on sound
        </button>
      )}
      {children}
    </div>
  );
}

/** For anyone with an NVIDIA RTX laptop: NVIDIA Broadcast's AI noise removal gives the clearest voice. */
export function NvidiaTip() {
  return (
    <p className="rounded-xl border border-border bg-tint px-3 py-2 text-xs text-muted">
      <span className="font-medium text-text">Have an NVIDIA RTX laptop?</span> Install the free{" "}
      <a href="https://www.nvidia.com/en-us/geforce/broadcasting/broadcast-app/" target="_blank" rel="noreferrer" className="text-accent hover:underline">
        NVIDIA Broadcast
      </a>{" "}
      app, turn on its noise removal, then choose <span className="font-medium">Microphone (NVIDIA Broadcast)</span> below
      for the clearest voice.
    </p>
  );
}
