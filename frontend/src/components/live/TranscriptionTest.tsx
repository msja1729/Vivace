"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { API_URL } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/AuthProvider";
import { readSession } from "@/lib/auth/session";
import { micConstraints, stopStream, streamAudio } from "@/lib/live/media";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Display";
import { FormError, TextField } from "@/components/ui/Field";
import { MicIcon } from "@/components/ui/Icons";

interface Line {
  id: number;
  text: string;
  engine: string;
  start: number;
  end: number;
  ms: number;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * Speak and watch the text appear, through exactly the viva's speech-to-text path: the viva's mic
 * settings, 16 kHz audio to the server, its pause detector, Deepgram with key terms (Whisper as backup).
 * Each line appears about a second after you pause, as in a real viva.
 */
export function TranscriptionTest({ mic }: { mic: string }) {
  const { user } = useAuth();
  const [terms, setTerms] = useState("");
  const [running, setRunning] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const ids = useRef(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => () => stop.current?.(), []);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines]);

  async function start() {
    setError(null);
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(mic || undefined) });
    } catch {
      setError("Allow microphone access to run the test.");
      return;
    }
    const token = readSession()?.token ?? "";
    const ws = new WebSocket(`${API_URL.replace(/^http/, "ws")}/ws/stt-test?token=${encodeURIComponent(token)}`);
    ws.binaryType = "arraybuffer";
    let stopAudio: (() => void) | null = null;
    const finish = () => {
      stopAudio?.();
      stopStream(stream);
      if (ws.readyState === WebSocket.OPEN) ws.close();
      setRunning(false);
      setSpeaking(false);
      stop.current = null;
    };
    stop.current = finish;
    ws.onopen = async () => {
      const list = terms.split(/[,\n]/).map((t) => t.trim()).filter(Boolean);
      ws.send(JSON.stringify({ type: "keyterms", terms: list }));
      const sink = {
        sendBinary: (tag: number, payload: ArrayBuffer) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const out = new Uint8Array(payload.byteLength + 1);
          out[0] = tag;
          out.set(new Uint8Array(payload), 1);
          ws.send(out);
        },
      };
      stopAudio = await streamAudio(stream!, sink);
      setRunning(true);
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data as string);
      if (m.type === "speaking") setSpeaking(Boolean(m.speaking));
      else if (m.type === "text" && m.text) setLines((l) => [...l, { id: ++ids.current, ...m }]);
    };
    ws.onclose = (e) => {
      if (e.code === 4401 || e.code === 4408) setError(e.reason || "The test stopped.");
      finish();
    };
    ws.onerror = () => setError("Couldn't connect to the server.");
  }

  if (!user) {
    return (
      <Card className="rounded-3xl p-6">
        <h2 className="font-semibold">Live transcription test</h2>
        <p className="mt-1 text-sm text-muted">
          <Link href="/login" className="text-accent hover:underline">
            Log in
          </Link>{" "}
          to try it: it uses the speech-to-text service of a real viva.
        </p>
      </Card>
    );
  }

  return (
    <Card className="space-y-4 rounded-3xl p-6">
      <div>
        <p className="text-[11px] font-semibold tracking-[0.18em] text-subtle uppercase">Speech to text · step 2</p>
        <h2 className="mt-1 font-semibold">Live transcription test</h2>
        <p className="mt-1 text-sm text-muted">
          Speak, and see what the viva would write. It uses the viva&apos;s exact path (same microphone settings, same
          pause detection, Deepgram with Whisper as backup): each sentence appears about a second after you pause.
        </p>
      </div>
      <TextField
        label="Words to spell right (optional): names, project terms, comma-separated"
        name="keyterms"
        value={terms}
        onChange={(e) => setTerms(e.target.value)}
        placeholder="Jyothiradithya, Karthikeshwar, PostgreSQL, YOLOv8, Lean 4"
        disabled={running}
      />
      <div className="flex flex-wrap items-center gap-3">
        {running ? (
          <Button variant="danger" onClick={() => stop.current?.()}>
            Stop
          </Button>
        ) : (
          <Button onClick={start}>
            <MicIcon /> Start speaking
          </Button>
        )}
        {lines.length > 0 && !running && (
          <Button variant="ghost" onClick={() => setLines([])}>
            Clear
          </Button>
        )}
        {running && (
          <span className="inline-flex items-center gap-2 text-sm text-muted">
            <span className={`h-2.5 w-2.5 rounded-full ${speaking ? "animate-pulse bg-success" : "bg-subtle"}`} />
            {speaking ? "Hearing you…" : "Listening (pause to see the text)"}
          </span>
        )}
      </div>
      <FormError message={error} />
      <div ref={box} className="h-72 space-y-3 overflow-y-auto overscroll-contain rounded-2xl border border-border bg-tint p-4">
        {lines.length === 0 ? (
          <p className="text-sm text-subtle">{running ? "Say something…" : "The text appears here."}</p>
        ) : (
          lines.map((l) => (
            <div key={l.id}>
              <p className="flex flex-wrap items-center gap-2 text-xs text-subtle">
                <span className="tabular-nums">{clock(l.start)}</span>
                <Badge tone={l.engine === "deepgram" ? "accent" : "warning"}>
                  {l.engine === "deepgram" ? "Deepgram" : "Whisper (backup)"}
                </Badge>
                <span>ready {(l.ms / 1000).toFixed(1)} s after you paused</span>
              </p>
              <p className="mt-1 text-sm">{l.text}</p>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
