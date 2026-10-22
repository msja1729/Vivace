from fastapi import APIRouter

from app.api.deps import CurrentUser, DbSession
from app.core import microsoft
from app.core.config import get_settings
from app.core.errors import NotFound
from app.core.security import create_access_token
from app.schemas.user import AuthOut, DevLoginIn, MicrosoftLoginIn, SetRoleIn, UserOut
from app.services import users

router = APIRouter(tags=["auth"])


@router.post("/auth/dev-login", response_model=AuthOut)
def dev_login(body: DevLoginIn, db: DbSession):
    """Development sign-in with name + school email. Replaced by Microsoft Entra ID later."""
    if get_settings().auth_mode != "dev":
        raise NotFound("Not found.")
    user = users.get_or_create_user(db, body.name, body.email)
    return AuthOut(access_token=create_access_token(user.id), user=UserOut.model_validate(user))


@router.post("/auth/microsoft", response_model=AuthOut)
def microsoft_login(body: MicrosoftLoginIn, db: DbSession):
    """Sign in with the ID token from Microsoft (MSAL in the browser). Name and email come from the token."""
    name, email = microsoft.account_from_claims(microsoft.verify_id_token(body.id_token))
    user = users.get_or_create_user(db, name, email)
    return AuthOut(access_token=create_access_token(user.id), user=UserOut.model_validate(user))


@router.get("/auth/config")
def auth_config() -> dict[str, bool]:
    """Which sign-in methods the server accepts."""
    return {"microsoft": microsoft.is_configured(), "dev": get_settings().auth_mode == "dev"}


@router.get("/users/me", response_model=UserOut)
def me(user: CurrentUser):
    return user


@router.put("/users/me/role", response_model=UserOut)
def set_my_role(body: SetRoleIn, user: CurrentUser, db: DbSession):
    return users.set_role(db, user, body.role)
