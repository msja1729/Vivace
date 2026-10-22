import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, UTCDateTime, utcnow
from app.models.user import User


class ClassRoom(Base):
    """A class created by an instructor. Students join it with `join_code`."""

    __tablename__ = "classes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(120))
    subject: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    join_code: Mapped[str] = mapped_column(String(6), unique=True, index=True)
    instructor_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    instructor: Mapped[User] = relationship(lazy="joined")
    members: Mapped[list["ClassMember"]] = relationship(
        back_populates="classroom", cascade="all, delete-orphan"
    )


class ClassMember(Base):
    """A user who joined a class (not the instructor who owns it)."""

    __tablename__ = "class_members"
    __table_args__ = (UniqueConstraint("class_id", "user_id", name="uq_class_member"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    class_id: Mapped[str] = mapped_column(ForeignKey("classes.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    joined_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    classroom: Mapped[ClassRoom] = relationship(back_populates="members")
    user: Mapped[User] = relationship(lazy="joined")


class ClassTA(Base):
    """A teaching assistant: gets the instructor's powers in this class (except managing TAs).
    Any registered user can be one; a student of the class who becomes a TA stops counting as a student."""

    __tablename__ = "class_tas"
    __table_args__ = (UniqueConstraint("class_id", "user_id", name="uq_class_ta"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    class_id: Mapped[str] = mapped_column(ForeignKey("classes.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    added_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    user: Mapped[User] = relationship(lazy="joined")
