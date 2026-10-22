"""App settings, read from environment variables / the .env file."""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "VIVA.AI API"
    environment: Literal["dev", "prod"] = "dev"

    # SQLite for local development; switch to PostgreSQL by changing this URL.
    database_url: str = "sqlite:///./viva.db"

    # Origins allowed to call the API from a browser (the Next.js frontend).
    # 127.0.0.1 too: a second test user can sign in there with separate browser storage.
    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]

    # JWT access tokens
    jwt_secret: str = "dev-only-secret-change-me-in-production-0123456789"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 60 * 24

    # Uploaded files (resumes, transcripts, viva instructions). Local disk for now.
    upload_dir: str = "./uploads"
    max_upload_mb: int = 15

    # Students must open a viva within this many minutes of its start time, or they miss it.
    viva_join_window_minutes: int = 5

    # ---------- Live viva: integrity + evaluation engines ----------
    # Detector thresholds and score weights live in this YAML file (defaults apply if it's missing).
    live_config_file: str = "./config.yaml"
    # The AI for the Grader and the examiner's Co-Pilot: "claude" (ANTHROPIC_API_KEY) or "gemini"
    # (GEMINI_API_KEY, free tier available). Without a key the session still runs (video, integrity,
    # transcript), just without AI grading or suggestions.
    llm_provider: Literal["claude", "gemini"] = "claude"
    anthropic_api_key: str = ""  # empty = the SDK's own lookup (env var or `ant auth login`)
    gemini_api_key: str = ""
    gemini_model: str = "gemini-flash-latest"  # or a fixed model ID from aistudio.google.com
    llm_model: str = "claude-sonnet-5-5"
    llm_effort: Literal["low", "medium", "high"] = "medium"
    whisper_model: str = "base.en"  # faster-whisper size: tiny.en, base.en, small.en, medium.en …
    ml_device: Literal["auto", "cpu", "cuda"] = "auto"
    # Integrity snapshots are deleted this many days after the session (0 = keep).
    snapshot_retention_days: int = 30
    live_warm_up: bool = True  # load the models at startup (in the background)

    # "password" = register / log in with email + password (plus Microsoft, if configured).
    # "dev" = also the password-less name + email login, for automated tests only — never on a public server.
    # "microsoft" = only "Sign in with Microsoft" (Entra ID).
    auth_mode: Literal["password", "dev", "microsoft"] = "password"

    # Microsoft Entra ID app registration (Azure portal → App registrations).
    # Sign in with Microsoft is enabled when azure_client_id is set.
    azure_client_id: str = ""
    azure_tenant_id: str = "organizations"  # your institute's tenant ID to allow only its accounts
    # If set, only these email domains may sign in, e.g. ["iisc.ac.in"].
    allowed_email_domains: list[str] = []

    # Personal email providers are rejected — only school accounts may sign in.
    blocked_email_domains: list[str] = [
        "gmail.com",
        "outlook.com",
        "hotmail.com",
        "live.com",
        "yahoo.com",
        "icloud.com",
    ]


@lru_cache
def get_settings() -> Settings:
    return Settings()
