import enum
import uuid
from datetime import datetime

from sqlalchemy import Enum, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, UTCDateTime, utcnow
from app.models.user import User


class FileKind(enum.StrEnum):
    submission = "submission"  # a file a student turned in for an assignment
    resume = "resume"  # (older submissions) resume slot
    transcript = "transcript"  # (older submissions) Claude session transcript slot
    viva_instructions = "viva_instructions"  # instructor's PDF telling the viva engine how to interview
    material = "material"  # files the instructor shares with the class (the only kind students see listed)
    feedback = "feedback"  # attached by staff when returning an assignment submission
    viva_feedback = "viva_feedback"  # attached by staff to a student's viva feedback / report


class StoredFile(Base):
    """An uploaded file. The bytes live on disk under `storage_key`; this row is its metadata."""

    __tablename__ = "files"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    class_id: Mapped[str] = mapped_column(ForeignKey("classes.id", ondelete="CASCADE"), index=True)
    uploader_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[FileKind] = mapped_column(Enum(FileKind, native_enum=False))
    name: Mapped[str] = mapped_column(String(255))  # original file name
    content_type: Mapped[str] = mapped_column(String(120))
    size_bytes: Mapped[int] = mapped_column(Integer)
    storage_key: Mapped[str] = mapped_column(String(255))  # path relative to settings.upload_dir
    # At most one of these is set: the submission, viva or viva feedback the file belongs to.
    submission_id: Mapped[str | None] = mapped_column(
        ForeignKey("submissions.id", ondelete="CASCADE"), index=True, default=None
    )
    viva_id: Mapped[str | None] = mapped_column(
        ForeignKey("vivas.id", ondelete="CASCADE"), index=True, default=None
    )
    viva_feedback_id: Mapped[int | None] = mapped_column(
        ForeignKey("viva_feedback.id", ondelete="CASCADE"), index=True, default=None
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    uploader: Mapped[User] = relationship(lazy="joined")
