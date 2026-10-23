from pydantic import EmailStr, Field

from app.models.user import Role
from app.schemas.base import ApiModel


class UserOut(ApiModel):
    id: str
    name: str
    email: str
    role: Role | None


class DevLoginIn(ApiModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr


class RegisterIn(ApiModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    role: Role


class LoginIn(ApiModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class MicrosoftLoginIn(ApiModel):
    id_token: str = Field(min_length=20, max_length=20000)


class SetRoleIn(ApiModel):
    role: Role


class AiSettingsIn(ApiModel):
    provider: str = Field(max_length=20)  # "gemini" | "claude"
    model: str = Field(default="", max_length=80)
    api_key: str = Field(default="", max_length=400)  # empty = keep the saved key


class AiSettingsOut(ApiModel):
    provider: str | None
    model: str | None
    key_hint: str | None  # "…abcd": the saved key itself is never sent back
    server_default: bool  # the server has a shared key to fall back on
    models: dict[str, list[str]]  # suggested models per provider


class AiCheckOut(ApiModel):
    ok: bool
    message: str


class AuthOut(ApiModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
