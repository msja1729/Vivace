"use client";

import { useEffect, useRef, useState } from "react";
import { listDevices, micConstraints, recordMic, stopStream, wavBlob } from "@/lib/live/media";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Checkbox, FormError, inputClass } from "@/components/ui/Field";
import { MicIcon } from "@/components/ui/Icons";

const SECONDS = 8;

interface Take {
  id: number;
  label: string;
  url: string;
  settings: string;
  peak: number;
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

  async function record(processing: boolean) {
    setError(null);
    setBusy(processing ? "viva" : "raw");
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(mic || undefined, processing) });
      const s = stream.getAudioTracks()[0].getSettings();
      const settings = [
        `echo cancellation ${s.echoCancellation ? "on" : "off"}`,
        `noise suppression ${s.noiseSuppression ? "on" : "off"}`,
        `auto volume ${s.autoGainControl ? "on" : "off"}`,
      ].join(" · ");
      if (echo && voice.current) {
        voice.current.currentTime = 0;
        void voice.current.play();
      }
      const start = Date.now();
      const timer = setInterval(() => setLeft(Math.max(0, SECONDS - Math.floor((Date.now() - start) / 1000))), 200);
      let peak = 0;
      const { samples, rate } = await recordMic(stream, SECONDS, (p) => {
        peak = Math.max(peak, p);
        setLevel(p);
      });
      clearInterval(timer);
      voice.current?.pause();
      const label = `${processing ? "As in the viva" : "Raw (processing off)"}${echo ? " · with voice playing" : ""}`;
      setTakes((t) => [
        { id: ++ids.current, label, url: URL.createObjectURL(wavBlob(samples, rate)), settings: `${settings} · ${rate / 1000} kHz`, peak },
        ...t,
      ]);
    } catch {
      setError("Couldn't record. Check that the microphone is allowed and not used by another app.");
    } finally {
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
          Hear exactly what the viva records from your microphone: the same browser settings (echo cancellation,
          noise suppression, automatic volume) and the same point in the audio path. Recordings stay in this browser.
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

        <div className="flex flex-wrap gap-3">
          <Button disabled={!!busy} onClick={() => record(true)}>
            <MicIcon /> {busy === "viva" ? `Recording… ${left}s` : `Record ${SECONDS} s as in the viva`}
          </Button>
          <Button variant="outline" disabled={!!busy} onClick={() => record(false)}>
            {busy === "raw" ? `Recording… ${left}s` : "Record raw (processing off)"}
          </Button>
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
