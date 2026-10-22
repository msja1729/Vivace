"""Delivery metrics for one answer: how quickly, how fluently. Pure functions."""

import re
from dataclasses import dataclass

FILLERS = {"um", "uh", "erm", "er", "ah", "hmm", "like", "basically", "actually", "literally"}
FILLER_PHRASES = ("you know", "i mean", "kind of", "sort of")


@dataclass
class Delivery:
    latency_s: float | None  # question end -> first word of the answer
    words: int
    wpm: float | None
    filler_rate: float  # fillers per minute
    long_pauses: int  # gaps > 2 s inside the answer
    fluency: float  # 0..1, combined


def _fillers(text: str) -> int:
    lower = text.lower()
    tokens = re.findall(r"[a-z']+", lower)
    return sum(t in FILLERS for t in tokens) + sum(lower.count(p) for p in FILLER_PHRASES)


def delivery(text: str, speech_seconds: float, latency_s: float | None, gaps: list[float]) -> Delivery:
    """`speech_seconds`: total time the student spoke; `gaps`: silences between their words."""
    words = len(text.split())
    minutes = max(speech_seconds, 1.0) / 60
    wpm = words / minutes if words else None
    filler_rate = _fillers(text) / minutes
    long_pauses = int(sum(g > 2 for g in gaps))

    scores = [max(0.0, 1 - filler_rate / 12), max(0.0, 1 - 0.15 * long_pauses)]
    if latency_s is not None:
        # Up to 2 s is a natural pause; 12 s or more scores 0.
        scores.append(min(1.0, max(0.0, 1 - (latency_s - 2) / 10)))
    if wpm is not None:
        # 100–170 words a minute is comfortable speech.
        scores.append(1.0 if 100 <= wpm <= 170 else max(0.0, 1 - min(abs(wpm - 100), abs(wpm - 170)) / 80))
    return Delivery(
        latency_s=round(latency_s, 2) if latency_s is not None else None,
        words=words,
        wpm=round(wpm, 1) if wpm is not None else None,
        filler_rate=round(filler_rate, 2),
        long_pauses=long_pauses,
        fluency=round(float(sum(scores) / len(scores)), 3),
    )


def mastery(correctness: float | None, similarity: float | None, fluency: float, weights) -> float | None:
    """0–100 for one answer. Missing parts (no AI grade, no embeddings) drop out and the rest re-weight."""
    parts = [(correctness, weights.correctness), (similarity, weights.similarity), (fluency, weights.fluency)]
    parts = [(v, w) for v, w in parts if v is not None]
    if not parts or all(v is None for v in (correctness, similarity)):
        return None  # fluency alone says nothing about understanding
    total = sum(w for _, w in parts)
    return round(100 * sum(max(0.0, min(1.0, v)) * w for v, w in parts) / total, 1)
