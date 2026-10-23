"""The LLM behind the Grader and Co-Pilot, kept behind one small interface so it can be swapped
without touching the agents. Claude or Google Gemini: each instructor's own key (see
services/ai_settings.py) or, as a fallback, the server's shared key from backend/.env."""

import asyncio
import json
import logging
from typing import Protocol

from app.core.config import get_settings

log = logging.getLogger("live.llm")


class LLMError(Exception):
    pass


class LLM(Protocol):
    async def json(self, system: str, prompt: str, schema: dict, max_tokens: int = 4000) -> dict:
        """One request that must answer with JSON matching `schema`. Raises LLMError."""
        ...


SERVER_KEY = "set it in backend/.env"
ACCOUNT_KEY = "check it in Settings"

CLAUDE_MODELS = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"]
GEMINI_MODELS = ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-3.7-flash"]


class ClaudeLLM:
    def __init__(self, api_key: str | None = None, model: str | None = None, where: str = SERVER_KEY):
        import anthropic

        settings = get_settings()
        key = api_key or settings.anthropic_api_key
        self._anthropic = anthropic
        self._client = anthropic.AsyncAnthropic(**({"api_key": key} if key else {}), timeout=60.0)
        self._model = model or settings.llm_model
        self._effort = settings.llm_effort
        self._where = where

    async def json(self, system: str, prompt: str, schema: dict, max_tokens: int = 4000) -> dict:
        a = self._anthropic
        try:
            response = await self._client.beta.messages.create(
                model=self._model,
                max_tokens=max_tokens,
                # If a safety classifier declines, let the API retry on its recommended fallback model.
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                output_config={"effort": self._effort, "format": {"type": "json_schema", "schema": schema}},
                # The system prompt is the same for every call in a session: cache it.
                system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": "user", "content": prompt}],
            )
        except a.AuthenticationError as exc:
            raise LLMError(f"Claude API key missing or invalid ({self._where}).") from exc
        except a.RateLimitError as exc:
            raise LLMError("Claude API rate limit reached; try again shortly.") from exc
        except a.NotFoundError as exc:
            raise LLMError(f"Claude model {self._model} not found ({self._where}).") from exc
        except a.APIStatusError as exc:
            raise LLMError(f"Claude API error {exc.status_code}.") from exc
        except a.APIConnectionError as exc:
            raise LLMError("Can't reach the Claude API.") from exc
        except TypeError as exc:  # no credentials found at all
            raise LLMError(f"Claude API key missing ({self._where}).") from exc

        if response.stop_reason == "refusal":
            raise LLMError("Claude declined this request.")
        if response.stop_reason == "max_tokens":
            raise LLMError("Claude's answer was cut off.")
        text = next((b.text for b in response.content if b.type == "text"), "")
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            raise LLMError("Claude returned malformed JSON.") from exc


GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


# Gemini answers "busy" (503) or "over the free limit" (429) now and then, especially on its newest
# model. Free-tier limits are per model, so moving on to the next model keeps the viva going.
BUSY = {500, 502, 503, 504}
NO_ANSWER = 599  # our own code: the request timed out or the connection failed


class GeminiLLM:
    """Google Gemini over its REST API (a free tier exists; key from aistudio.google.com).
    Tries GEMINI_MODEL, then each of GEMINI_FALLBACK_MODELS; a busy model gets one retry first."""

    def __init__(
        self,
        retry_delay: float = 1.5,
        api_key: str | None = None,
        model: str | None = None,
        where: str = SERVER_KEY,
    ):
        import httpx

        settings = get_settings()
        key = api_key or settings.gemini_api_key
        self._where = where
        if not key:
            raise LLMError(f"Gemini API key missing ({where}).")
        self._httpx = httpx
        # A model that hasn't answered in 25 s is stuck (it happens): better to try the next one.
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(25.0, connect=10.0), headers={"x-goog-api-key": key}
        )
        models = [model or settings.gemini_model, *settings.gemini_fallback_models]
        self._models = list(dict.fromkeys(m for m in models if m))  # in order, no repeats
        self._retry_delay = retry_delay

    async def json(self, system: str, prompt: str, schema: dict, max_tokens: int = 4000) -> dict:
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseJsonSchema": schema,
                # Newer models think before answering, and that counts as output: leave room.
                "maxOutputTokens": max_tokens + 8000,
            },
        }
        statuses = []
        for model in self._models:
            res = await self._ask(model, body, schema)
            if res.status_code in BUSY:
                await asyncio.sleep(self._retry_delay)
                res = await self._ask(model, body, schema)
            statuses.append(res.status_code)
            if res.status_code in BUSY or res.status_code in (404, 429, NO_ANSWER):
                log.warning("Gemini %s answered %s; trying the next model", model, res.status_code)
                continue  # busy, stuck, unknown or out of free quota: try the next one
            if res.status_code in (401, 403) or (res.status_code == 400 and "API key" in res.text):
                raise LLMError(f"Gemini API key missing or invalid ({self._where}).")
            if res.status_code >= 400:
                raise LLMError(f"Gemini API error {res.status_code}.")
            return self._parse(res.json())

        if all(code == 404 for code in statuses):
            raise LLMError(f"Gemini model not found ({self._where}).")
        if all(code == NO_ANSWER for code in statuses):
            raise LLMError("Can't reach the Gemini API: check the server's internet connection.")
        if 429 in statuses and not any(code in BUSY for code in statuses):
            raise LLMError("Gemini free-tier limit reached on every model; try again in a minute.")
        raise LLMError("Gemini is busy right now (Google's servers); try Refresh in a moment.")

    async def _ask(self, model: str, body: dict, schema: dict):
        res = await self._post(GEMINI_URL.format(model=model), body)
        if res.status_code == 400 and "responseJsonSchema" in res.text:
            # A model without schema support: ask for the shape in words instead.
            config = {k: v for k, v in body["generationConfig"].items() if k != "responseJsonSchema"}
            text = body["contents"][0]["parts"][0]["text"]
            text += "\n\nAnswer with JSON only, matching this JSON schema:\n" + json.dumps(schema)
            res = await self._post(
                GEMINI_URL.format(model=model),
                body
                | {"generationConfig": config, "contents": [{"role": "user", "parts": [{"text": text}]}]},
            )
        return res

    @staticmethod
    def _parse(data: dict) -> dict:
        candidate = (data.get("candidates") or [{}])[0]
        reason = candidate.get("finishReason", "")
        if data.get("promptFeedback", {}).get("blockReason") or reason in ("SAFETY", "PROHIBITED_CONTENT"):
            raise LLMError("Gemini declined this request.")
        if reason == "MAX_TOKENS":
            raise LLMError("Gemini's answer was cut off.")
        parts = candidate.get("content", {}).get("parts", [])
        text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
        try:
            return json.loads(text.strip().removeprefix("```json").removesuffix("```"))
        except json.JSONDecodeError as exc:
            raise LLMError("Gemini returned malformed JSON.") from exc

    async def _post(self, url: str, body: dict):
        try:
            return await self._client.post(url, json=body)
        except self._httpx.HTTPError as exc:
            log.warning("Gemini request failed: %r", exc)
            return self._httpx.Response(NO_ANSWER)


_llm: LLM | None = None
_error: str | None = None
_clients: dict[tuple[str, str, str], LLM] = {}


def make_llm(provider: str, api_key: str, model: str | None = None) -> LLM:
    """An instructor's own LLM, from their provider, key and model (reused while they don't change)."""
    cache_key = (provider, api_key, model or "")
    llm = _clients.get(cache_key)
    if llm is None:
        if provider == "gemini":
            llm = GeminiLLM(api_key=api_key, model=model, where=ACCOUNT_KEY)
        elif provider == "claude":
            llm = ClaudeLLM(api_key=api_key, model=model, where=ACCOUNT_KEY)
        else:
            raise LLMError(f"Unknown AI provider: {provider}.")
        _clients[cache_key] = llm
    return llm


def get_llm() -> LLM | None:
    """The configured LLM, or None (with `llm_error()` saying why) if it can't be created."""
    global _llm, _error
    if _llm is None and _error is None:
        try:
            _llm = GeminiLLM() if get_settings().llm_provider == "gemini" else ClaudeLLM()
        except LLMError as exc:
            _error = str(exc)
            log.warning(_error)
        except Exception as exc:  # noqa: BLE001 — e.g. the `live` extra isn't installed
            _error = f"LLM unavailable: {exc}"
            log.warning(_error)
    return _llm


def llm_error() -> str | None:
    return _error
