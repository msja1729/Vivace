"""Shared FastAPI dependencies: database session and the logged-in user."""

from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import Forbidden, Unauthorized
from app.core.security import decode_access_token
from app.models import User

DbSession = Annotated[Session, Depends(get_db)]

_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    db: DbSession,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
    """Any signed-in user (role may still be unset during registration)."""
    if creds is None:
        raise Unauthorized("Not signed in.")
    user_id = decode_access_token(creds.credentials)
    user = db.get(User, user_id) if user_id else None
    if user is None:
        raise Unauthorized("Session expired. Please sign in again.")
    return user


def get_registered_user(user: Annotated[User, Depends(get_current_user)]) -> User:
    """A signed-in user who has finished registration (picked a role)."""
    if user.role is None:
        raise Forbidden("Finish registration by choosing your role.")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
RegisteredUser = Annotated[User, Depends(get_registered_user)]
