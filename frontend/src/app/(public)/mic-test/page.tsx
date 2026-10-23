"use client";

import { useEffect, useRef, useState } from "react";
import { DENOISERS, denoiseStream, type Denoiser } from "@/lib/live/denoise";
import { listDevices, micConstraints, recordMic, stopStream, wavBlob } from "@/lib/live/media";
import { Card } from "@/components/ui/Card";
import { Checkbox, FormError, inputClass } from "@/components/ui/Field";
import { MicIcon } from "@/components/ui/Icons";
import { TranscriptionTest } from "@/components/live/TranscriptionTest";

const SECONDS = 8;

/** viva: the browser's own clean-up (what the viva uses now) · raw: everything off · rnnoise / gtcrn:
 * AI noise removal in the browser (with the browser's echo cancellation and volume, without its
 * noise suppression, so the two don't stack). */
type Mode = "viva" | "raw" | Denoiser;

const MODE_LABEL: Record<Mode, string> = {
  viva: "As in the viva (browser clean-up)",
  raw: "Raw (processing off)",
  rnnoise: `AI noise removal: ${DENOISERS.rnnoise.label}`,
  gtcrn: `AI noise removal: ${DENOISERS.gtcrn.label}`,
};

interface Take {
  id: number;
  label: string;
  url: string;
  settings: string;
  peak: number;
}

/** Calls `onTick` with the seconds left, several times a second, until stopped. */
function countdown(seconds: number, onTick: (left: number) => void): () => void {
  const start = Date.now();
  onTick(seconds);
  const timer = setInterval(() => onTick(Math.max(0, seconds - Math.floor((Date.now() - start) / 1000))), 200);
  return () => clearInterval(timer);
}

/**
 * Hear exactly what the viva captures from the microphone (step 1 of the speech-to-text pipeline):
 * the same browser settings and the same tap point, recorded for a few seconds and played back.
 * Nothing leaves the browser.
 */
export default function MicTestPage() {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [mic, setMic] = useState("");
  const [echo, setEcho] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [left, setLeft] = useState(0);
  const [takes, setTakes] = useState<Take[]>([]);
  const [error, setError] = useState<string | null>(null);
  const voice = useRef<HTMLAudioElement>(null);
  const ids = useRef(0);

  useEffect(() => {
    // Ask once so the device names are filled in.
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((s) => {
        stopStream(s);
        return listDevices();
      })
      .then((d) => setMics(d.mics), () => setError("Allow microphone access to run the test."));
  }, []);

  useEffect(() => () => takes.forEach((t) => URL.revokeObjectURL(t.url)), [takes]);

  async function record(mode: Mode) {
    setError(null);
    setBusy(mode);
    let stream: MediaStream | null = null;
    let ai: { stream: MediaStream; stop: () => void } | null = null;
    try {
      const ml = mode === "rnnoise" || mode === "gtcrn";
      stream = await navigator.mediaDevices.getUserMedia({
        audio: micConstraints(mic || undefined, mode !== "raw", mode === "viva"),
      });
      const s = stream.getAudioTracks()[0].getSettings();
      const settings = [
        `echo cancellation ${s.echoCancellation ? "on" : "off"}`,
        ml ? `AI noise removal (${DENOISERS[mode].label})` : `noise suppression ${s.noiseSuppression ? "on" : "off"}`,
        `auto volume ${s.autoGainControl ? "on" : "off"}`,
      ].join(" · ");
      if (ml) ai = await denoiseStream(stream, mode);
      if (echo && voice.current) {
        voice.current.currentTime = 0;
        void voice.current.play();
      }
      const stopCountdown = countdown(SECONDS, setLeft);
      let peak = 0;
      const { samples, rate } = await recordMic(ai?.stream ?? stream, SECONDS, (p) => {
        peak = Math.max(peak, p);
        setLevel(p);
      });
      stopCountdown();
      voice.current?.pause();
      const label = `${MODE_LABEL[mode]}${echo ? " · with voice playing" : ""}`;
      setTakes((t) => [
        { id: ++ids.current, label, url: URL.createObjectURL(wavBlob(samples, rate)), settings: `${settings} · ${rate / 1000} kHz`, peak },
        ...t,
      ]);
    } catch {
      setError("Couldn't record. Check that the microphone is allowed and not used by another app.");
    } finally {
      ai?.stop();
      stopStream(stream);
      setBusy(null);
      setLevel(0);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 py-10">
      <div>
        <p className="text-[11px] font-semibold tracking-[0.18em] text-subtle uppercase">Speech to text · step 1</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Microphone test</h1>
        <p className="mt-2 text-sm text-muted">
          Hear exactly what the viva records from your microphone (same settings, same point in the audio path), and
          compare it with AI noise removal that runs right in the browser. Recordings stay in this browser.
        </p>
      </div>

      <Card className="space-y-5 rounded-3xl p-6">
        <label className="block text-xs text-muted">
          Microphone
          <select value={mic} onChange={(e) => setMic(e.target.value)} className={`${inputClass} mt-1 text-sm`}>
            <option value="">System default</option>
            {mics.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || "Microphone"}
              </option>
            ))}
          </select>
        </label>

        <Checkbox
          label="Echo test: play a voice through the speakers while recording"
          description="Like the other person talking during the viva. Use speakers, not headphones. With processing on, the played voice should be (mostly) removed."
          checked={echo}
          onChange={(e) => setEcho(e.target.checked)}
        />
        <audio ref={voice} src="/echo-test-voice.wav" preload="auto" />

        <div className="space-y-3">
          <p className="text-xs font-medium text-muted">Record {SECONDS} seconds with:</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["viva", "raw", "rnnoise", "gtcrn"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                disabled={!!busy}
                onClick={() => record(m)}
                className={`rounded-2xl border p-4 text-left transition disabled:opacity-60 ${
                  busy === m ? "border-accent bg-accent-soft" : "border-border-strong bg-tint hover:bg-raised"
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <MicIcon className="h-4 w-4 text-accent" />
                  {busy === m ? `Recording… ${left}s` : MODE_LABEL[m]}
                </span>
                <span className="mt-1 block text-xs text-muted">
                  {m === "viva"
                    ? "What the viva uses now: Chrome's built-in noise suppression."
                    : m === "raw"
                      ? "No clean-up at all, to compare."
                      : DENOISERS[m].about}
                </span>
              </button>
            ))}
          </div>
        </div>
        {busy && (
          <div className="flex items-center gap-3 text-sm">
            <MicIcon className="h-4 w-4 text-muted" />
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-raised">
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.min(100, level * 250)}%` }} />
            </div>
            <span className="text-xs text-muted">Speak normally, as in a viva</span>
          </div>
        )}
        <FormError message={error} />
      </Card>

      <TranscriptionTest mic={mic} />

      {takes.length > 0 && (
        <Card className="space-y-4 rounded-3xl p-6">
          <h2 className="font-semibold">Recordings</h2>
          <ul className="space-y-4">
            {takes.map((t) => (
              <li key={t.id} className="rounded-2xl border border-border bg-tint p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">{t.label}</p>
                  <a href={t.url} download={`mic-test-${t.id}.wav`} className="text-xs text-accent hover:underline">
                    Download
                  </a>
                </div>
                <p className="mt-0.5 text-xs text-subtle">
                  {t.settings} · loudest {Math.round(t.peak * 100)}%{t.peak < 0.05 ? " (very quiet: check the microphone)" : ""}
                </p>
                <audio controls src={t.url} className="mt-3 w-full" />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
