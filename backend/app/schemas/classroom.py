from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator

from app.schemas.base import ApiModel


class ClassCreateIn(ApiModel):
    name: str = Field(min_length=1, max_length=120)
    subject: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)

    @field_validator("name", "subject", "description")
    @classmethod
    def strip(cls, v: str) -> str:
        return v.strip()


class JoinClassIn(ApiModel):
    code: str = Field(min_length=6, max_length=6)

    @field_validator("code")
    @classmethod
    def normalise(cls, v: str) -> str:
        return v.strip().upper()


class ClassOut(ApiModel):
    id: str
    name: str
    subject: str
    description: str
    instructor_id: str
    instructor_name: str
    member_count: int
    created_at: datetime
    # owner = created the class; ta = teaching assistant (instructor powers); student = joined with the code
    my_role: Literal["owner", "ta", "student"]
    # Only the teaching staff (owner and TAs) see the join code.
    join_code: str | None = None


class MyClassesOut(ApiModel):
    teaching: list[ClassOut]
    assisting: list[ClassOut]  # classes where the user is a TA
    joined: list[ClassOut]


class PersonOut(ApiModel):
    id: str
    name: str
    email: str


class MemberOut(PersonOut):
    joined_at: datetime


class TAOut(PersonOut):
    added_at: datetime


class AddTAIn(ApiModel):
    user_id: str
