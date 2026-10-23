"""Audio from the browsers arrives as 16 kHz mono 16-bit PCM. This module cuts it into speech
segments (webrtcvad), and wraps the voice print (SpeechBrain ECAPA) and speech-to-text (Deepgram,
with local faster-whisper as the default / backup)."""

import logging
from collections import deque
from dataclasses import dataclass

from app.core.config import get_settings
from app.live import engines
from app.live.integrity import deepgram

log = logging.getLogger("live.audio")

RATE = 16000
FRAME_MS = 30
FRAME_BYTES = RATE * FRAME_MS // 1000 * 2  # 960
START_VOICED = 4  # voiced frames out of the last 6 to start a segment
END_SILENCE = 25  # 750 ms of silence ends it
PRE_ROLL = 5  # keep 150 ms before the start so the first word isn't clipped
MAX_FRAMES = 20_000 // FRAME_MS  # cut very long monologues every 20 s


@dataclass
class Segment:
    start: float  # session seconds
    end: float
    pcm: bytes


class Segmenter:
    """Feed PCM chunks; get finished speech segments back. Also reports per-chunk voice activity."""

    def __init__(self, aggressiveness: int = 2):
        mod = engines.vad()
        self._vad = mod.Vad(aggressiveness) if mod else None
        self._buf = b""
        self._t: float | None = None  # session time of the next unprocessed frame
        self._recent: deque[bool] = deque(maxlen=6)
        self._pre: deque[bytes] = deque(maxlen=PRE_ROLL)
        self._frames: list[bytes] = []
        self._start = 0.0
        self._silence = 0
        self.speaking = False

    @property
    def available(self) -> bool:
        return self._vad is not None

    def feed(self, pcm: bytes, t_arrival: float) -> tuple[list[Segment], float]:
        """Returns (finished segments, share of this chunk that was speech)."""
        if self._vad is None:
            return [], 0.0
        if self._t is None or t_arrival - self._t > 2:  # first chunk, or a gap (reconnect)
            self._t = t_arrival - len(pcm) / 2 / RATE
        self._buf += pcm
        done: list[Segment] = []
        voiced_count = total = 0
        while len(self._buf) >= FRAME_BYTES:
            frame, self._buf = self._buf[:FRAME_BYTES], self._buf[FRAME_BYTES:]
            t = self._t
            self._t += FRAME_MS / 1000
            voiced = self._vad.is_speech(frame, RATE)
            voiced_count += voiced
            total += 1
            self._recent.append(voiced)
            if not self.speaking:
                self._pre.append(frame)
                if sum(self._recent) >= START_VOICED:
                    self.speaking = True
                    self._frames = list(self._pre)
                    self._start = t - (len(self._frames) - 1) * FRAME_MS / 1000
                    self._silence = 0
                continue
            self._frames.append(frame)
            self._silence = 0 if voiced else self._silence + 1
            if self._silence >= END_SILENCE or len(self._frames) >= MAX_FRAMES:
                done.append(self._finish(self._t))
        return done, (voiced_count / total if total else 0.0)

    def flush(self) -> Segment | None:
        return self._finish(self._t or 0.0) if self.speaking else None

    def _finish(self, t_end: float) -> Segment:
        # Drop the trailing silence.
        keep = len(self._frames) - min(self._silence, len(self._frames) - 1)
        pcm = b"".join(self._frames[:keep])
        seg = Segment(self._start, self._start + len(pcm) / 2 / RATE, pcm)
        self.speaking, self._frames, self._silence = False, [], 0
        self._recent.clear()
        self._pre.clear()
        return seg


def _float_audio(pcm: bytes):
    import numpy as np

    return np.frombuffer(pcm, np.int16).astype(np.float32) / 32768.0


def voice_embedding(pcm: bytes):
    """192-d ECAPA embedding, or None if the model isn't available or the clip is too short."""
    encoder = engines.speaker_encoder()
    if encoder is None or len(pcm) < RATE * 2 * 1:  # at least 1 s
        return None
    import torch

    wav = torch.from_numpy(_float_audio(pcm)).unsqueeze(0)
    with torch.no_grad():
        emb = encoder.encode_batch(wav).squeeze()
    return emb.cpu().numpy()


def cosine(a, b) -> float:
    import numpy as np

    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))


@dataclass
class Transcript:
    text: str
    words: list[tuple[float, float, str]]  # (start, end, word), seconds from the segment start


def transcribe(pcm: bytes, keyterms: tuple[str, ...] = ()) -> Transcript | None:
    """Deepgram if configured (names / project terms as key terms), else local Whisper. If Deepgram
    fails for a segment, Whisper transcribes it instead, so the transcript never stops."""
    if get_settings().stt_provider == "deepgram":
        try:
            text, words = deepgram.transcribe(pcm, keyterms)
            return Transcript(text, words)
        except deepgram.DeepgramError as exc:
            log.warning("Deepgram failed (%s); using local Whisper for this segment", exc)
    return _whisper(pcm)


def _whisper(pcm: bytes) -> Transcript | None:
    model = engines.whisper()
    if model is None:
        return None
    segments, _ = model.transcribe(
        _float_audio(pcm), language="en", beam_size=1, word_timestamps=True, condition_on_previous_text=False
    )
    words: list[tuple[float, float, str]] = []
    parts: list[str] = []
    for s in segments:
        parts.append(s.text.strip())
        words += [(float(w.start), float(w.end), w.word.strip()) for w in s.words or []]
    return Transcript(" ".join(p for p in parts if p).strip(), words)
