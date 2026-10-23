// Copies the in-browser noise-removal models (RNNoise, GTCRN) from node_modules into public/noise,
// so the browser can load them. Runs before `npm run dev` and `npm run build`.
import { copyFileSync, mkdirSync } from "node:fs";

const from = "node_modules/@sapphi-red/web-noise-suppressor/dist";
const to = "public/noise";
mkdirSync(to, { recursive: true });
for (const [src, dest] of [
  ["rnnoise/workletProcessor.js", "rnnoiseWorklet.js"],
  ["rnnoise.wasm", "rnnoise.wasm"],
  ["rnnoise_simd.wasm", "rnnoise_simd.wasm"],
  ["gtcrn/workletProcessor.js", "gtcrnWorklet.js"],
  ["gtcrn.wasm", "gtcrn.wasm"],
]) {
  copyFileSync(`${from}/${src}`, `${to}/${dest}`);
}
