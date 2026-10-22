"""The LLM behind the Grader and Co-Pilot, kept behind one small interface so it can be swapped
without touching the agents. LLM_PROVIDER picks Claude (default) or Google Gemini."""

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


class ClaudeLLM:
    def __init__(self):
        import anthropic

        settings = get_settings()
        self._anthropic = anthropic
        self._client = anthropic.AsyncAnthropic(
            **({"api_key": settings.anthropic_api_key} if settings.anthropic_api_key else {}),
            timeout=60.0,
        )
        self._model = settings.llm_model
        self._effort = settings.llm_effort

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
            raise LLMError(
                "Claude API key missing or invalid (set ANTHROPIC_API_KEY in backend/.env)."
            ) from exc
        except a.RateLimitError as exc:
            raise LLMError("Claude API rate limit reached; try again shortly.") from exc
        except a.APIStatusError as exc:
            raise LLMError(f"Claude API error {exc.status_code}.") from exc
        except a.APIConnectionError as exc:
            raise LLMError("Can't reach the Claude API.") from exc
        except TypeError as exc:  # no credentials found at all
            raise LLMError("Claude API key missing (set ANTHROPIC_API_KEY in backend/.env).") from exc

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


class GeminiLLM:
    """Google Gemini over its REST API (a free tier exists; key from aistudio.google.com)."""

    def __init__(self):
        import httpx

        settings = get_settings()
        if not settings.gemini_api_key:
            raise LLMError("Gemini API key missing (set GEMINI_API_KEY in backend/.env).")
        self._httpx = httpx
        self._client = httpx.AsyncClient(timeout=90.0, headers={"x-goog-api-key": settings.gemini_api_key})
        self._url = GEMINI_URL.format(model=settings.gemini_model)

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
        res = await self._post(body)
        if res.status_code == 400 and "responseJsonSchema" in res.text:
            # A model without schema support: ask for the shape in words instead.
            del body["generationConfig"]["responseJsonSchema"]
            body["contents"][0]["parts"][0]["text"] += (
                "\n\nAnswer with JSON only, matching this JSON schema:\n" + json.dumps(schema)
            )
            res = await self._post(body)
        if res.status_code in (401, 403) or (res.status_code == 400 and "API key" in res.text):
            raise LLMError("Gemini API key missing or invalid (set GEMINI_API_KEY in backend/.env).")
        if res.status_code == 404:
            raise LLMError(
                "Gemini model not found: check GEMINI_MODEL in backend/.env (see aistudio.google.com)."
            )
        if res.status_code == 429:
            raise LLMError("Gemini free-tier limit reached; try again in a minute.")
        if res.status_code >= 400:
            raise LLMError(f"Gemini API error {res.status_code}.")

        data = res.json()
        candidate = (data.get("candidates") or [{}])[0]
        reason = candidate.get("finishReason", "")
        if data.get("promptFeedback", {}).get("blockReason") or reason in ("SAFETY", "PROHIBITED_CONTENT"):
            raise LLMError("Gemini declined this request.")
        if reason == "MAX_TOKENS":
            raise LLMError("Gemini's answer was cut off.")
        text = "".join(
            p.get("text", "") for p in candidate.get("content", {}).get("parts", []) if not p.get("thought")
        )
        try:
            return json.loads(text.strip().removeprefix("```json").removesuffix("```"))
        except json.JSONDecodeError as exc:
            raise LLMError("Gemini returned malformed JSON.") from exc

    async def _post(self, body: dict):
        try:
            return await self._client.post(self._url, json=body)
        except self._httpx.HTTPError as exc:
            raise LLMError("Can't reach the Gemini API.") from exc


_llm: LLM | None = None
_error: str | None = None


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
