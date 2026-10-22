from fastapi import APIRouter

from app.api.deps import CurrentUser, DbSession
from app.core import microsoft
from app.core.config import get_settings
from app.core.errors import NotFound
from app.core.security import create_access_token
from app.schemas.user import AuthOut, DevLoginIn, LoginIn, MicrosoftLoginIn, RegisterIn, SetRoleIn, UserOut
from app.services import users

router = APIRouter(tags=["auth"])


def _session(user) -> AuthOut:
    return AuthOut(access_token=create_access_token(user.id), user=UserOut.model_validate(user))


def _require_password_auth() -> None:
    if get_settings().auth_mode == "microsoft":
        raise NotFound("Not found.")


@router.post("/auth/register", response_model=UserOut, status_code=201)
def register(body: RegisterIn, db: DbSession):
    """Create an email + password account. The user then logs in with it."""
    _require_password_auth()
    return users.register(db, body.name, body.email, body.password, body.role)


@router.post("/auth/login", response_model=AuthOut)
def login(body: LoginIn, db: DbSession):
    _require_password_auth()
    return _session(users.authenticate(db, body.email, body.password))


@router.post("/auth/dev-login", response_model=AuthOut)
def dev_login(body: DevLoginIn, db: DbSession):
    """Password-less sign-in with name + school email, for automated tests (AUTH_MODE=dev) only."""
    if get_settings().auth_mode != "dev":
        raise NotFound("Not found.")
    return _session(users.get_or_create_user(db, body.name, body.email))


@router.post("/auth/microsoft", response_model=AuthOut)
def microsoft_login(body: MicrosoftLoginIn, db: DbSession):
    """Sign in with the ID token from Microsoft (MSAL in the browser). Name and email come from the token."""
    name, email = microsoft.account_from_claims(microsoft.verify_id_token(body.id_token))
    return _session(users.get_or_create_user(db, name, email))


@router.get("/auth/config")
def auth_config() -> dict[str, bool]:
    """Which sign-in methods the server accepts."""
    mode = get_settings().auth_mode
    return {"microsoft": microsoft.is_configured(), "password": mode != "microsoft", "dev": mode == "dev"}


@router.get("/users/me", response_model=UserOut)
def me(user: CurrentUser):
    return user


@router.put("/users/me/role", response_model=UserOut)
def set_my_role(body: SetRoleIn, user: CurrentUser, db: DbSession):
    return users.set_role(db, user, body.role)
