"""The LLM behind the Grader and Co-Pilot, kept behind one small interface so it can be swapped
(e.g. for a local model) without touching the agents."""

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


_llm: LLM | None = None
_error: str | None = None


def get_llm() -> LLM | None:
    """The configured LLM, or None (with `llm_error()` saying why) if it can't be created."""
    global _llm, _error
    if _llm is None and _error is None:
        try:
            _llm = ClaudeLLM()
        except Exception as exc:  # noqa: BLE001 — e.g. the `live` extra isn't installed
            _error = f"LLM unavailable: {exc}"
            log.warning(_error)
    return _llm


def llm_error() -> str | None:
    return _error
