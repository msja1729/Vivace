"""Deepgram speech to text against a fake Deepgram API (no network, no key needed)."""

import httpx
import pytest

from app.core.config import get_settings
from app.live.integrity import audio, deepgram

REPLY = {
    "results": {
        "channels": [
            {
                "alternatives": [
                    {
                        "transcript": "I used PostgreSQL.",
                        "words": [
                            {"word": "i", "punctuated_word": "I", "start": 0.1, "end": 0.2},
                            {"word": "used", "punctuated_word": "used", "start": 0.2, "end": 0.5},
                            {
                                "word": "postgresql",
                                "punctuated_word": "PostgreSQL.",
                                "start": 0.5,
                                "end": 1.2,
                            },
                        ],
                    }
                ]
            }
        ]
    }
}


@pytest.fixture
def fake_deepgram(monkeypatch):
    """Routes Deepgram requests to `handler`; returns the list of requests sent."""
    monkeypatch.setattr(get_settings(), "deepgram_api_key", "test-key")
    monkeypatch.setattr(get_settings(), "stt_provider", "deepgram")
    sent: list[httpx.Request] = []
    state = {"handler": lambda req: httpx.Response(200, json=REPLY)}

    def route(req: httpx.Request) -> httpx.Response:
        sent.append(req)
        return state["handler"](req)

    monkeypatch.setattr(deepgram, "_client", httpx.Client(transport=httpx.MockTransport(route)))
    return sent, state


def test_deepgram_returns_text_and_word_timings(fake_deepgram):
    sent, _ = fake_deepgram
    text, words = deepgram.transcribe(b"\0\0" * 16000, ("Jyothiradithya", "PostgreSQL"))
    assert text == "I used PostgreSQL."
    assert words[-1] == (0.5, 1.2, "PostgreSQL.")
    req = sent[0]
    assert req.headers["Authorization"] == "Token test-key"
    assert req.content[:4] == b"RIFF"  # sent as WAV
    assert req.url.params["model"] == "nova-3"
    assert req.url.params.get_list("keyterm") == ["Jyothiradithya", "PostgreSQL"]


@pytest.mark.parametrize(
    ("status", "message"), [(401, "invalid"), (402, "credit"), (429, "rate limit"), (500, "500")]
)
def test_deepgram_errors_are_explained(fake_deepgram, status, message):
    _, state = fake_deepgram
    state["handler"] = lambda req: httpx.Response(status, text="nope")
    with pytest.raises(deepgram.DeepgramError, match=message):
        deepgram.transcribe(b"\0\0" * 1600)


def test_whisper_takes_over_when_deepgram_fails(fake_deepgram, monkeypatch):
    _, state = fake_deepgram
    state["handler"] = lambda req: httpx.Response(503, text="down")
    monkeypatch.setattr(audio, "_whisper", lambda pcm: audio.Transcript("from whisper", []))
    assert audio.transcribe(b"\0\0" * 1600).text == "from whisper"


def test_whisper_is_used_when_deepgram_is_off(monkeypatch):
    monkeypatch.setattr(get_settings(), "stt_provider", "whisper")
    monkeypatch.setattr(audio, "_whisper", lambda pcm: audio.Transcript("local", []))
    assert audio.transcribe(b"\0\0" * 1600).text == "local"


def test_keyterms_are_names_then_technical_terms():
    work = "Backend in FastAPI with PostgreSQL. The PostgreSQL schema has 3 tables. Detection uses YOLOv8."
    terms = deepgram.keyterms_for(["Chimirela Karthikeshwar"], work)
    assert terms[:3] == ("Chimirela Karthikeshwar", "Chimirela", "Karthikeshwar")
    assert terms[3] == "PostgreSQL"  # the most frequent term comes first
    assert {"FastAPI", "YOLOv8"} <= set(terms)
    assert "Backend" not in terms and "Detection" not in terms  # ordinary sentence-start words
