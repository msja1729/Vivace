"""Speech to text with Deepgram (pre-recorded API, one speech segment per request).

Each segment the voice-activity detector cuts out is sent as a 16 kHz mono WAV; Deepgram returns the
text with word timings. `keyterms` (names, project terms) help it spell those words right."""

import io
import logging
import re
import wave
from collections import Counter

import httpx

from app.core.config import get_settings

log = logging.getLogger("live.deepgram")

URL = "https://api.deepgram.com/v1/listen"
RATE = 16000
MAX_KEYTERMS = 40

_client: httpx.Client | None = None


class DeepgramError(Exception):
    pass


def _wav(pcm: bytes) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm)
    return buf.getvalue()


def _http() -> httpx.Client:
    global _client
    if _client is None:
        _client = httpx.Client(timeout=httpx.Timeout(15.0, connect=5.0))
    return _client


def transcribe(pcm: bytes, keyterms: tuple[str, ...] = ()) -> tuple[str, list[tuple[float, float, str]]]:
    """(text, [(start, end, word)]) for one segment of 16 kHz mono 16-bit PCM. Raises DeepgramError."""
    s = get_settings()
    if not s.deepgram_api_key:
        raise DeepgramError("Deepgram API key missing (set DEEPGRAM_API_KEY in backend/.env).")
    params: list[tuple[str, str]] = [
        ("model", s.deepgram_model),
        ("language", "en"),
        ("smart_format", "true"),
        ("punctuate", "true"),
    ]
    params += [("keyterm", t) for t in keyterms[:MAX_KEYTERMS]]
    try:
        res = _http().post(
            URL,
            params=params,
            content=_wav(pcm),
            headers={"Authorization": f"Token {s.deepgram_api_key}", "Content-Type": "audio/wav"},
        )
    except httpx.HTTPError as exc:
        raise DeepgramError(f"Can't reach Deepgram: {exc!r}") from exc
    if res.status_code in (401, 403):
        raise DeepgramError("Deepgram API key missing or invalid.")
    if res.status_code == 402:
        raise DeepgramError("Deepgram account is out of credit.")
    if res.status_code == 429:
        raise DeepgramError("Deepgram rate limit reached.")
    if res.status_code >= 400:
        raise DeepgramError(f"Deepgram error {res.status_code}: {res.text[:200]}")
    try:
        alt = res.json()["results"]["channels"][0]["alternatives"][0]
    except (KeyError, IndexError, ValueError) as exc:
        raise DeepgramError("Deepgram returned an unexpected reply.") from exc
    words = [
        (float(w["start"]), float(w["end"]), str(w.get("punctuated_word") or w["word"]))
        for w in alt.get("words", [])
    ]
    return str(alt.get("transcript", "")).strip(), words


_COMMON = {
    "the",
    "and",
    "for",
    "with",
    "this",
    "that",
    "from",
    "using",
    "used",
    "project",
    "projects",
    "resume",
    "student",
    "github",
    "https",
    "http",
    "www",
    "com",
    "experience",
    "education",
    "skills",
    "university",
    "india",
    "institute",
    "science",
    "technology",
    "bachelor",
    "master",
    "page",
    "email",
    "phone",
}


def keyterms_for(names: list[str], work: str = "", limit: int = MAX_KEYTERMS) -> tuple[str, ...]:
    """Words worth spelling right: the people's names, then the technical terms that appear most in the
    student's submitted work (CamelCase, ALL-CAPS, with digits, or capitalised mid-sentence)."""
    terms: list[str] = []
    for name in names:
        name = name.strip()
        if name:
            terms.append(name)
            terms += [p for p in name.split() if len(p) >= 3]
    counts: Counter[str] = Counter()
    for sentence in re.split(r"[.!?\n]+", work):
        tokens = re.findall(r"[A-Za-z][A-Za-z0-9+#.\-]*[A-Za-z0-9+#]", sentence)
        for i, tok in enumerate(tokens):
            if tok.lower() in _COMMON or len(tok) < 3:
                continue
            camel = any(c.isupper() for c in tok[1:])
            has_digit = any(c.isdigit() for c in tok)
            capital_mid = i > 0 and tok[0].isupper()
            if camel or has_digit or capital_mid:
                counts[tok] += 1
    terms += [t for t, _ in counts.most_common(limit)]
    seen: set[str] = set()
    out = []
    for t in terms:
        if t.lower() not in seen:
            seen.add(t.lower())
            out.append(t)
    return tuple(out[:limit])
