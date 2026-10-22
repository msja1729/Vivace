import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, UTCDateTime, utcnow
from app.models.file import StoredFile
from app.models.user import User


class Assignment(Base):
    """Work the instructor sets for the class: instructions and a deadline. Students turn in any files."""

    __tablename__ = "assignments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    class_id: Mapped[str] = mapped_column(ForeignKey("classes.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(160))
    instructions: Mapped[str] = mapped_column(Text, default="")
    deadline: Mapped[datetime] = mapped_column(UTCDateTime)
    # Graded assignments are marked out of `total_marks`; ungraded ones only get feedback.
    graded: Mapped[bool] = mapped_column(Boolean, default=False)
    total_marks: Mapped[int | None] = mapped_column(Integer, default=None)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    submissions: Mapped[list["Submission"]] = relationship(
        back_populates="assignment", cascade="all, delete-orphan"
    )


class Submission(Base):
    """One student's upload for an assignment. Resubmitting replaces it."""

    __tablename__ = "submissions"
    __table_args__ = (UniqueConstraint("assignment_id", "student_id", name="uq_submission_student"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    assignment_id: Mapped[str] = mapped_column(ForeignKey("assignments.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    github_links: Mapped[list[str]] = mapped_column(JSON, default=list)
    note: Mapped[str] = mapped_column(Text, default="")
    submitted_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    # Set when the instructor returns the work.
    marks: Mapped[float | None] = mapped_column(Float, default=None)
    feedback: Mapped[str] = mapped_column(Text, default="")
    returned_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)

    assignment: Mapped[Assignment] = relationship(back_populates="submissions")
    student: Mapped[User] = relationship(lazy="joined")
    files: Mapped[list[StoredFile]] = relationship(cascade="all, delete-orphan")
