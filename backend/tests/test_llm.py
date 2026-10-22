"""The Gemini adapter against a fake Gemini API (no network, no key needed)."""

import asyncio
import json

import httpx
import pytest

from app.core.config import get_settings
from app.live.evaluation import llm as llm_mod
from app.live.evaluation.llm import GeminiLLM, LLMError

SCHEMA = {"type": "object", "properties": {"score": {"type": "number"}}, "required": ["score"]}


def gemini(monkeypatch, handler) -> tuple[GeminiLLM, list[dict]]:
    monkeypatch.setattr(get_settings(), "gemini_api_key", "test-key")
    model = GeminiLLM()
    sent: list[dict] = []

    def record(request: httpx.Request) -> httpx.Response:
        sent.append(json.loads(request.content))
        assert request.headers["x-goog-api-key"] == "test-key"
        return handler(request, len(sent))

    model._client = httpx.AsyncClient(
        transport=httpx.MockTransport(record), headers={"x-goog-api-key": "test-key"}
    )
    return model, sent


def reply(text: str, finish: str = "STOP") -> httpx.Response:
    return httpx.Response(
        200, json={"candidates": [{"content": {"parts": [{"text": text}]}, "finishReason": finish}]}
    )


def test_gemini_returns_json_and_sends_the_schema(monkeypatch):
    model, sent = gemini(monkeypatch, lambda req, n: reply('{"score": 7}'))
    assert asyncio.run(model.json("system", "grade this", SCHEMA)) == {"score": 7}
    body = sent[0]
    assert body["systemInstruction"]["parts"][0]["text"] == "system"
    assert body["generationConfig"]["responseJsonSchema"] == SCHEMA
    assert body["generationConfig"]["responseMimeType"] == "application/json"


def test_gemini_falls_back_when_the_model_has_no_schema_support(monkeypatch):
    def handler(req, n):
        if n == 1:
            return httpx.Response(400, text="Invalid JSON payload: unknown field responseJsonSchema")
        return reply('```json\n{"score": 3}\n```')

    model, sent = gemini(monkeypatch, handler)
    assert asyncio.run(model.json("system", "grade this", SCHEMA)) == {"score": 3}
    assert "responseJsonSchema" not in sent[1]["generationConfig"]
    assert "JSON schema" in sent[1]["contents"][0]["parts"][0]["text"]


@pytest.mark.parametrize(
    ("response", "message"),
    [
        (httpx.Response(429, text="quota"), "free-tier limit"),
        (httpx.Response(403, text="denied"), "key missing or invalid"),
        (httpx.Response(404, text="no such model"), "GEMINI_MODEL"),
        (reply("", "SAFETY"), "declined"),
        (reply('{"score": ', "MAX_TOKENS"), "cut off"),
        (reply("not json"), "malformed"),
    ],
)
def test_gemini_errors_are_explained(monkeypatch, response, message):
    model, _ = gemini(monkeypatch, lambda req, n: response)
    with pytest.raises(LLMError, match=message):
        asyncio.run(model.json("system", "prompt", SCHEMA))


def test_provider_setting_picks_gemini(monkeypatch):
    monkeypatch.setattr(get_settings(), "llm_provider", "gemini")
    monkeypatch.setattr(get_settings(), "gemini_api_key", "")
    monkeypatch.setattr(llm_mod, "_llm", None)
    monkeypatch.setattr(llm_mod, "_error", None)
    assert llm_mod.get_llm() is None
    assert "GEMINI_API_KEY" in llm_mod.llm_error()
