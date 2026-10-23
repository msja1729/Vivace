// Camera / microphone access, and streaming them to the backend engines.

import { AUDIO, FRAME, type LiveRoom } from "./room";

/** The microphone settings the viva uses. `processing: false` turns the browser's clean-up off (for the
 * microphone test's comparison). Echo cancellation keeps the other person's voice (from the speakers)
 * out of this mic. */
export function micConstraints(
  audioId?: string,
  processing = true,
  browserNoiseSuppression = processing, // off when an AI denoiser does the noise removal instead
): MediaTrackConstraints {
  return {
    echoCancellation: processing,
    noiseSuppression: browserNoiseSuppression,
    autoGainControl: processing,
    deviceId: audioId ? { exact: audioId } : { ideal: "default" },
  };
}

/** Opens the camera and microphone. Without a chosen device, prefers the system's default microphone:
 * Chrome may otherwise pick a silent virtual input (e.g. SteelSeries Sonar, OBS, voice changers). */
export async function openCameraAndMic(choice: { audioId?: string; videoId?: string } = {}): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 24 },
      ...(choice.videoId ? { deviceId: { exact: choice.videoId } } : {}),
    },
    audio: micConstraints(choice.audioId),
  });
}

/** Cameras and microphones (labels are only filled in once permission is granted). */
export async function listDevices(): Promise<{ mics: MediaDeviceInfo[]; cameras: MediaDeviceInfo[] }> {
  const all = await navigator.mediaDevices.enumerateDevices();
  return {
    // "communications" duplicates a real device on Windows.
    mics: all.filter((d) => d.kind === "audioinput" && d.deviceId !== "communications"),
    cameras: all.filter((d) => d.kind === "videoinput"),
  };
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Sends JPEG frames for the vision pipeline (student only). Returns a stop function. */
export function streamFrames(stream: MediaStream, room: LiveRoom, fps = 5): () => void {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  void video.play();
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 360;
  const ctx = canvas.getContext("2d");
  let busy = false;

  const timer = setInterval(() => {
    // Skip a frame rather than queue up when the connection is slow.
    if (busy || !ctx || video.readyState < 2 || room.bufferedAmount > 1_000_000) return;
    busy = true;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      async (blob) => {
        if (blob) room.sendBinary(FRAME, await blob.arrayBuffer());
        busy = false;
      },
      "image/jpeg",
      0.7,
    );
  }, 1000 / fps);

  return () => {
    clearInterval(timer);
    video.srcObject = null;
  };
}

// Copies the microphone samples out of the audio thread.
const TAP_WORKLET = `
class PcmTap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("pcm-tap", PcmTap);
`;

const TARGET_RATE = 16000;

/** Anything the PCM can go to: the live room, or the transcription test's connection. */
export type AudioSink = Pick<LiveRoom, "sendBinary">;

/** Sends the microphone as 16 kHz 16-bit mono PCM, ~100 ms per message. Returns a stop function. */
export async function streamAudio(stream: MediaStream, room: AudioSink): Promise<() => void> {
  const ctx = new AudioContext();
  const url = URL.createObjectURL(new Blob([TAP_WORKLET], { type: "application/javascript" }));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  const source = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
  const tap = new AudioWorkletNode(ctx, "pcm-tap");
  const silent = ctx.createGain();
  silent.gain.value = 0; // keeps the graph running without playing the mic back
  source.connect(tap).connect(silent).connect(ctx.destination);

  const ratio = ctx.sampleRate / TARGET_RATE;
  let carry = new Float32Array(0);
  let out: number[] = [];

  tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
    const input = new Float32Array(carry.length + e.data.length);
    input.set(carry);
    input.set(e.data, carry.length);
    // Downsample by averaging each block of `ratio` input samples.
    let i = 0;
    for (; (i + 1) * ratio <= input.length; i++) {
      const from = Math.floor(i * ratio);
      const to = Math.floor((i + 1) * ratio);
      let sum = 0;
      for (let j = from; j < to; j++) sum += input[j];
      out.push(sum / Math.max(1, to - from));
    }
    carry = input.slice(Math.floor(i * ratio));
    if (out.length >= TARGET_RATE / 10) {
      const pcm = new Int16Array(out.length);
      out.forEach((v, k) => (pcm[k] = Math.max(-1, Math.min(1, v)) * 0x7fff));
      room.sendBinary(AUDIO, pcm.buffer);
      out = [];
    }
  };

  return () => {
    tap.port.onmessage = null;
    source.disconnect();
    void ctx.close();
  };
}

/** Records `seconds` of the microphone at the point the viva taps it (before the 16 kHz conversion),
 * for the microphone test. Resolves with the samples and their rate. */
export async function recordMic(
  stream: MediaStream,
  seconds: number,
  onLevel?: (peak: number) => void,
): Promise<{ samples: Float32Array; rate: number }> {
  const ctx = new AudioContext();
  const url = URL.createObjectURL(new Blob([TAP_WORKLET], { type: "application/javascript" }));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  const source = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
  const tap = new AudioWorkletNode(ctx, "pcm-tap");
  const silent = ctx.createGain();
  silent.gain.value = 0;
  source.connect(tap).connect(silent).connect(ctx.destination);
  const chunks: Float32Array[] = [];
  tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
    chunks.push(e.data);
    if (onLevel) onLevel(e.data.reduce((m, v) => Math.max(m, Math.abs(v)), 0));
  };
  await new Promise((r) => setTimeout(r, seconds * 1000));
  tap.port.onmessage = null;
  source.disconnect();
  const rate = ctx.sampleRate;
  await ctx.close();
  const samples = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    samples.set(c, at);
    at += c.length;
  }
  return { samples, rate };
}

/** 16-bit mono WAV file from float samples (for playback and download). */
export function wavBlob(samples: Float32Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const text = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, samples.length * 2, true);
  samples.forEach((x, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x)) * 0x7fff, true));
  return new Blob([buf], { type: "audio/wav" });
}
