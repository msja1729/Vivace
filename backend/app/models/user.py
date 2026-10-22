import enum
import uuid
from datetime import datetime

from sqlalchemy import Enum, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, UTCDateTime, utcnow


class Role(enum.StrEnum):
    student = "student"
    instructor = "instructor"


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)  # school Microsoft account
    role: Mapped[Role | None] = mapped_column(
        Enum(Role, native_enum=False), default=None
    )  # chosen at registration
    # scrypt hash for email + password accounts; None for Microsoft-only accounts
    password_hash: Mapped[str | None] = mapped_column(String(255), default=None)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
