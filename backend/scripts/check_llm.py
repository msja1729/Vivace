"""Checks the AI key and model in backend/.env with one tiny request.

uv run python -m scripts.check_llm
"""

import asyncio

from app.core.config import get_settings
from app.live.evaluation.llm import LLMError, get_llm, llm_error

SCHEMA = {
    "type": "object",
    "properties": {"answer": {"type": "string"}},
    "required": ["answer"],
}


async def main() -> None:
    s = get_settings()
    model = s.gemini_model if s.llm_provider == "gemini" else s.llm_model
    print(f"Provider: {s.llm_provider}   model: {model}")
    llm = get_llm()
    if llm is None:
        print(f"Not ready: {llm_error()}")
        return
    try:
        data = await llm.json("You are a test.", 'Reply with {"answer": "ok"}.', SCHEMA, max_tokens=200)
    except LLMError as exc:
        print(f"Failed: {exc}")
        return
    print(f"Works. Reply: {data}")


if __name__ == "__main__":
    asyncio.run(main())
