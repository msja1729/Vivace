"""Checking Microsoft (Entra ID) ID tokens from the frontend's "Sign in with Microsoft".

The browser signs in with MSAL and sends us the ID token. We verify its signature against
Microsoft's published keys, that it was issued for our app (audience) by the right tenant,
and that it hasn't expired. Then we trust its name and email.
"""

from functools import lru_cache

import jwt

from app.core.config import get_settings
from app.core.errors import NotFound, Unauthorized

MULTI_TENANT = {"common", "organizations"}


def is_configured() -> bool:
    return bool(get_settings().azure_client_id)


@lru_cache(maxsize=8)
def _jwks_client(tenant_id: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(f"https://login.microsoftonline.com/{tenant_id}/discovery/v2.0/keys")


def _signing_key(token: str, tenant_id: str):
    return _jwks_client(tenant_id).get_signing_key_from_jwt(token).key


def verify_id_token(token: str) -> dict:
    """Return the token's claims if it is a valid ID token for this app, else raise Unauthorized."""
    settings = get_settings()
    if not is_configured():
        raise NotFound("Microsoft sign-in isn't configured on the server.")
    try:
        tenant = jwt.decode(token, options={"verify_signature": False}).get("tid")
        if not tenant:
            raise Unauthorized("Invalid Microsoft sign-in.")
        if settings.azure_tenant_id not in MULTI_TENANT and tenant != settings.azure_tenant_id:
            raise Unauthorized("Use your institute Microsoft account.")
        return jwt.decode(
            token,
            _signing_key(token, tenant),
            algorithms=["RS256"],
            audience=settings.azure_client_id,
            issuer=f"https://login.microsoftonline.com/{tenant}/v2.0",
            options={"require": ["exp", "iat", "aud", "iss"]},
        )
    except jwt.PyJWTError as err:
        raise Unauthorized("Microsoft sign-in failed. Please try again.") from err


def account_from_claims(claims: dict) -> tuple[str, str]:
    """(name, email) from the token."""
    email = claims.get("email") or claims.get("preferred_username") or ""
    name = claims.get("name") or email.split("@")[0]
    if "@" not in email:
        raise Unauthorized("Your Microsoft account has no email address.")
    return name, email
