import enum
import uuid
from datetime import datetime

from sqlalchemy import JSON, Enum, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, UTCDateTime, utcnow
from app.models.assignment import Assignment
from app.models.file import StoredFile
from app.models.user import User


class VivaAudience(enum.StrEnum):
    whole_class = "whole_class"
    selected = "selected"  # only the students listed in viva_students


class VivaStatus(enum.StrEnum):
    draft = "draft"
    scheduled = "scheduled"


class VivaConductor(enum.StrEnum):
    staff = "staff"  # the instructor and TAs interview students one-to-one, in time slots
    ai = "ai"  # the AI examiner interviews every student at once (not built yet)


class Viva(Base):
    """An AI viva the instructor sets up for a class: who takes it, when, and how the AI should run it."""

    __tablename__ = "vivas"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    class_id: Mapped[str] = mapped_column(ForeignKey("classes.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(160))
    audience: Mapped[VivaAudience] = mapped_column(Enum(VivaAudience, native_enum=False))
    status: Mapped[VivaStatus] = mapped_column(Enum(VivaStatus, native_enum=False), default=VivaStatus.draft)
    conducted_by: Mapped[VivaConductor] = mapped_column(
        Enum(VivaConductor, native_enum=False), default=VivaConductor.staff, server_default="staff"
    )
    # The resume assignment whose submissions the AI uses to ask about each student's projects.
    assignment_id: Mapped[str | None] = mapped_column(
        ForeignKey("assignments.id", ondelete="SET NULL"), default=None
    )
    starts_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    # starts_at + join window + duration; computed by the service, stored for listing and phase checks.
    ends_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=20)
    # Staff vivas: gap between one student's slot and the next for the same examiner.
    break_minutes: Mapped[int] = mapped_column(Integer, default=5, server_default="5")

    # Instructions for the viva engine (plus optional PDFs in `files`).
    interview_instructions: Mapped[str] = mapped_column(Text, default="")
    evaluation_criteria: Mapped[list[dict]] = mapped_column(
        JSON, default=list
    )  # [{name, description, weight}]
    report_format: Mapped[str] = mapped_column(Text, default="")
    summary_stats: Mapped[list[str]] = mapped_column(JSON, default=list)

    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)

    assignment: Mapped[Assignment | None] = relationship()
    students: Mapped[list["VivaStudent"]] = relationship(cascade="all, delete-orphan")
    files: Mapped[list[StoredFile]] = relationship(cascade="all, delete-orphan")
    attempts: Mapped[list["VivaAttempt"]] = relationship(cascade="all, delete-orphan")
    feedback: Mapped[list["VivaFeedback"]] = relationship(cascade="all, delete-orphan")
    examiners: Mapped[list["VivaExaminer"]] = relationship(cascade="all, delete-orphan")
    slots: Mapped[list["VivaSlot"]] = relationship(cascade="all, delete-orphan")


class VivaStudent(Base):
    """A student picked for a viva whose audience is `selected`."""

    __tablename__ = "viva_students"
    __table_args__ = (UniqueConstraint("viva_id", "student_id", name="uq_viva_student"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    viva_id: Mapped[str] = mapped_column(ForeignKey("vivas.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    student: Mapped[User] = relationship(lazy="joined")


class VivaAttempt(Base):
    """A student opening the viva. Only allowed within the join window after `starts_at`."""

    __tablename__ = "viva_attempts"
    __table_args__ = (UniqueConstraint("viva_id", "student_id", name="uq_viva_attempt"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    viva_id: Mapped[str] = mapped_column(ForeignKey("vivas.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    joined_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class VivaFeedback(Base):
    """Staff's feedback / report for one student's viva, with optional attached files. Visible once released."""

    __tablename__ = "viva_feedback"
    __table_args__ = (UniqueConstraint("viva_id", "student_id", name="uq_viva_feedback"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    viva_id: Mapped[str] = mapped_column(ForeignKey("vivas.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    feedback: Mapped[str] = mapped_column(Text, default="")
    released_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    # Copies taken when sent, so later edits don't change what the student was given.
    marks: Mapped[dict | None] = mapped_column(
        JSON, default=None
    )  # {score, outOf, criteria: [{name, score}]}
    ai_report: Mapped[dict | None] = mapped_column(JSON, default=None)

    files: Mapped[list[StoredFile]] = relationship(cascade="all, delete-orphan")


class VivaExaminer(Base):
    """A staff member (the instructor or a TA) who interviews students in a staff-conducted viva."""

    __tablename__ = "viva_examiners"
    __table_args__ = (UniqueConstraint("viva_id", "user_id", name="uq_viva_examiner"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    viva_id: Mapped[str] = mapped_column(ForeignKey("vivas.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    user: Mapped[User] = relationship(lazy="joined")


class VivaSlot(Base):
    """Which examiner interviews a student, and in which turn. The slot starts at
    viva.starts_at + position * (duration + break), so examiners run their queues in parallel."""

    __tablename__ = "viva_slots"
    __table_args__ = (UniqueConstraint("viva_id", "student_id", name="uq_viva_slot"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    viva_id: Mapped[str] = mapped_column(ForeignKey("vivas.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    examiner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)  # 0 = examiner's first student

    student: Mapped[User] = relationship(lazy="joined", foreign_keys=[student_id])
    examiner: Mapped[User] = relationship(lazy="joined", foreign_keys=[examiner_id])
