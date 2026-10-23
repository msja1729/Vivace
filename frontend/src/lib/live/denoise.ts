// AI noise removal in the browser (no install, any laptop): RNNoise or GTCRN, small neural networks
// that keep speech and remove background noise. Models are served from /noise (see
// scripts/copy-noise-models.mjs). Both run at 48 kHz.

// The library is loaded on first use, in the browser only: it extends AudioWorkletNode at import time,
// which doesn't exist when Next.js pre-renders pages on the server.
const library = () => import("@sapphi-red/web-noise-suppressor");

export type Denoiser = "rnnoise" | "gtcrn";

export const DENOISERS: Record<Denoiser, { label: string; about: string }> = {
  rnnoise: { label: "RNNoise", about: "Small, proven model (used by Jitsi Meet)." },
  gtcrn: { label: "GTCRN", about: "Newer deep-learning model; usually cleaner speech." },
};

const binaries = new Map<Denoiser, Promise<ArrayBuffer>>();

function binary(kind: Denoiser): Promise<ArrayBuffer> {
  let b = binaries.get(kind);
  if (!b) {
    b = library().then((lib) =>
      kind === "rnnoise"
        ? lib.loadRnnoise({ url: "/noise/rnnoise.wasm", simdUrl: "/noise/rnnoise_simd.wasm" })
        : lib.loadGtcrn({ url: "/noise/gtcrn.wasm" }),
    );
    binaries.set(kind, b);
  }
  return b;
}

/** The microphone stream with AI noise removal applied. Call `stop()` when done. */
export async function denoiseStream(input: MediaStream, kind: Denoiser): Promise<{ stream: MediaStream; stop: () => void }> {
  const lib = await library();
  const ctx = new AudioContext({ sampleRate: 48000 });
  const wasmBinary = await binary(kind);
  await ctx.audioWorklet.addModule(kind === "rnnoise" ? "/noise/rnnoiseWorklet.js" : "/noise/gtcrnWorklet.js");
  const source = ctx.createMediaStreamSource(new MediaStream(input.getAudioTracks()));
  const node =
    kind === "rnnoise"
      ? new lib.RnnoiseWorkletNode(ctx, { wasmBinary, maxChannels: 1 })
      : new lib.GtcrnWorkletNode(ctx, { wasmBinary, maxChannels: 1 });
  const out = ctx.createMediaStreamDestination();
  source.connect(node).connect(out);
  await ctx.resume();
  return {
    stream: out.stream,
    stop: () => {
      source.disconnect();
      node.destroy();
      void ctx.close();
    },
  };
}
