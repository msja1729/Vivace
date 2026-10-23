"""Each instructor's own AI (provider, model, API key) for the vivas they run.

The key is encrypted at rest with a key derived from the server's JWT_SECRET, and never sent back to
the browser: only its last 4 characters. Without one, the server's shared key (backend/.env) is used."""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import BadRequest, Forbidden
from app.live.evaluation import llm as llm_mod
from app.models import Role, User
from app.schemas.user import AiCheckOut, AiSettingsIn, AiSettingsOut

PROVIDERS = {"gemini": llm_mod.GEMINI_MODELS, "claude": llm_mod.CLAUDE_MODELS}


def _fernet() -> Fernet:
    digest = hashlib.sha256(f"ai-keys:{get_settings().jwt_secret}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt(key: str) -> str:
    return _fernet().encrypt(key.encode()).decode()


def decrypt(token: str) -> str | None:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:  # e.g. JWT_SECRET was changed: the key must be entered again
        return None


def _server_default() -> bool:
    s = get_settings()
    return bool(s.gemini_api_key if s.llm_provider == "gemini" else s.anthropic_api_key)


def _ensure_instructor(user: User) -> None:
    if user.role != Role.instructor:
        raise Forbidden("Only instructors set an AI key.")


def get(user: User) -> AiSettingsOut:
    _ensure_instructor(user)
    key = decrypt(user.ai_key_enc) if user.ai_key_enc else None
    return AiSettingsOut(
        provider=user.ai_provider,
        model=user.ai_model,
        key_hint=f"…{key[-4:]}" if key else None,
        server_default=_server_default(),
        models={p: list(m) for p, m in PROVIDERS.items()},
    )


def save(db: Session, user: User, data: AiSettingsIn) -> AiSettingsOut:
    """Set the provider and model; a new key replaces the stored one (leave it empty to keep it)."""
    _ensure_instructor(user)
    if data.provider not in PROVIDERS:
        raise BadRequest("Choose Gemini or Claude.")
    key = data.api_key.strip()
    if not key and (not user.ai_key_enc or user.ai_provider != data.provider):
        raise BadRequest("Paste your API key.")
    user.ai_provider = data.provider
    user.ai_model = data.model.strip() or PROVIDERS[data.provider][0]
    if key:
        user.ai_key_enc = encrypt(key)
    db.commit()
    return get(user)


def remove(db: Session, user: User) -> AiSettingsOut:
    _ensure_instructor(user)
    user.ai_provider = user.ai_model = user.ai_key_enc = None
    db.commit()
    return get(user)


def llm_for(user: User | None) -> llm_mod.LLM | None:
    """The user's own LLM, or None if they haven't set one (or it can't be read)."""
    if user is None or not user.ai_provider or not user.ai_key_enc:
        return None
    key = decrypt(user.ai_key_enc)
    return llm_mod.make_llm(user.ai_provider, key, user.ai_model) if key else None


async def check(user: User) -> AiCheckOut:
    """One tiny request with the saved key, to confirm it works."""
    _ensure_instructor(user)
    llm = llm_for(user)
    if llm is None:
        return AiCheckOut(ok=False, message="No key saved yet.")
    schema = {"type": "object", "properties": {"answer": {"type": "string"}}, "required": ["answer"]}
    try:
        await llm.json("You are a test.", 'Reply with {"answer": "ok"}.', schema, max_tokens=200)
    except llm_mod.LLMError as exc:
        return AiCheckOut(ok=False, message=str(exc))
    return AiCheckOut(ok=True, message=f"Works: {user.ai_provider} · {user.ai_model}.")
