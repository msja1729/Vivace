"""Sign in with Microsoft: tokens are signed here with a test key standing in for Microsoft's."""

from datetime import UTC, datetime, timedelta

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.core import microsoft
from app.core.config import get_settings

CLIENT_ID = "11111111-2222-3333-4444-555555555555"
TENANT = "iisc-tenant-id"
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(autouse=True)
def configured(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "azure_client_id", CLIENT_ID)
    monkeypatch.setattr(settings, "azure_tenant_id", TENANT)
    monkeypatch.setattr(microsoft, "_signing_key", lambda token, tenant: KEY.public_key())


def token(**overrides) -> str:
    now = datetime.now(UTC)
    claims = {
        "aud": CLIENT_ID,
        "iss": f"https://login.microsoftonline.com/{TENANT}/v2.0",
        "tid": TENANT,
        "iat": now,
        "exp": now + timedelta(hours=1),
        "name": "Asha Rao",
        "preferred_username": "Asha@IISc.ac.in",
        **overrides,
    }
    return jwt.encode(claims, KEY, algorithm="RS256")


def login(client, id_token):
    return client.post("/api/auth/microsoft", json={"idToken": id_token})


def test_valid_token_signs_in(client):
    res = login(client, token())
    assert res.status_code == 200, res.text
    assert res.json()["user"]["email"] == "asha@iisc.ac.in"
    assert res.json()["user"]["name"] == "Asha Rao"
    assert client.get("/api/auth/config").json()["microsoft"] is True


@pytest.mark.parametrize(
    "bad",
    [
        {"aud": "someone-elses-app"},
        {"tid": "other-tenant", "iss": "https://login.microsoftonline.com/other-tenant/v2.0"},
        {"exp": datetime.now(UTC) - timedelta(minutes=5)},
        {"iss": "https://evil.example.com/v2.0"},
    ],
)
def test_bad_tokens_rejected(client, bad):
    assert login(client, token(**bad)).status_code == 401


def test_wrong_signature_rejected(client):
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    now = datetime.now(UTC)
    forged = jwt.encode(
        {
            "aud": CLIENT_ID,
            "iss": f"https://login.microsoftonline.com/{TENANT}/v2.0",
            "tid": TENANT,
            "iat": now,
            "exp": now + timedelta(hours=1),
            "preferred_username": "x@iisc.ac.in",
        },
        other,
        algorithm="RS256",
    )
    assert login(client, forged).status_code == 401


def test_allowed_domains(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "allowed_email_domains", ["iisc.ac.in"])
    assert login(client, token()).status_code == 200
    assert login(client, token(preferred_username="bob@other.edu")).status_code == 400


def test_not_configured(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "azure_client_id", "")
    assert login(client, token()).status_code == 404
