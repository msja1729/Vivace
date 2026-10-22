"""Test setup: a fresh in-memory database per test and helpers to sign users in."""

from collections.abc import Callable, Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.core.config import get_settings
from app.core.db import Base, get_db, make_engine
from app.live import session as live_session
from app.main import app


@pytest.fixture(autouse=True)
def upload_dir(tmp_path, monkeypatch):
    """Uploaded files go to a temporary folder per test."""
    monkeypatch.setattr(get_settings(), "upload_dir", str(tmp_path / "uploads"))
    monkeypatch.setattr(get_settings(), "live_warm_up", False)
    monkeypatch.setattr(get_settings(), "snapshot_retention_days", 0)
    monkeypatch.setattr(get_settings(), "auth_mode", "dev")  # the login() helper uses dev-login
    return tmp_path / "uploads"


@pytest.fixture
def client(monkeypatch) -> Iterator[TestClient]:
    engine = make_engine("sqlite://", poolclass=StaticPool)
    Base.metadata.create_all(engine)
    TestSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr(live_session, "db_factory", TestSession)
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
    engine.dispose()


@pytest.fixture
def login(client: TestClient) -> Callable[..., dict[str, str]]:
    """login("Name", "a@school.edu", role="student") -> auth headers."""

    def _login(name: str, email: str, role: str | None = None) -> dict[str, str]:
        res = client.post("/api/auth/dev-login", json={"name": name, "email": email})
        assert res.status_code == 200, res.text
        headers = {"Authorization": f"Bearer {res.json()['accessToken']}"}
        if role:
            assert client.put("/api/users/me/role", json={"role": role}, headers=headers).status_code == 200
        return headers

    return _login
