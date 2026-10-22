"""A live viva session: one student interviewed by one examiner, with what the integrity and
evaluation engines recorded along the way."""

import enum
import uuid
from datetime import datetime

from sqlalchemy import JSON, Enum, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, UTCDateTime, utcnow
from app.models.user import User


class SessionStatus(enum.StrEnum):
    waiting = "waiting"  # student is in the waiting room (consent, device check, calibration)
    live = "live"  # examiner started the interview
    ended = "ended"  # examiner finished and saved the result


class Speaker(enum.StrEnum):
    examiner = "examiner"
    student = "student"


class VivaSession(Base):
    __tablename__ = "viva_sessions"
    __table_args__ = (UniqueConstraint("viva_id", "student_id", name="uq_viva_session"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    viva_id: Mapped[str] = mapped_column(ForeignKey("vivas.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    examiner_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), default=None)
    status: Mapped[SessionStatus] = mapped_column(
        Enum(SessionStatus, native_enum=False), default=SessionStatus.waiting
    )
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    ended_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)

    # Calibration: gaze bounds from the 4-corner step, and whether a voice print was enrolled.
    calibration: Mapped[dict] = mapped_column(JSON, default=dict)

    # Engine scores (0–100), kept up to date while the session runs.
    risk_score: Mapped[float] = mapped_column(Float, default=0.0)
    # Video frames the proctoring checked during the interview, and how many showed a face:
    # the report only says "attended genuinely" if the proctoring actually saw the student.
    proctor_frames: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    face_frames: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    mastery_score: Mapped[float | None] = mapped_column(Float, default=None)

    # The examiner's result. The AI's numbers are advice; this is the decision.
    score: Mapped[float | None] = mapped_column(Float, default=None)  # out of 10
    criteria_scores: Mapped[list[dict]] = mapped_column(JSON, default=list)  # [{name, score}] out of 10
    notes: Mapped[str] = mapped_column(Text, default="")
    # The AI's written assessment, made when the interview ends (see evaluation/report.py).
    ai_report: Mapped[dict | None] = mapped_column(JSON, default=None)

    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    student: Mapped[User] = relationship(lazy="joined", foreign_keys=[student_id])
    examiner: Mapped[User | None] = relationship(lazy="joined", foreign_keys=[examiner_id])
    events: Mapped[list["VivaEvent"]] = relationship(
        cascade="all, delete-orphan", order_by="VivaEvent.start_ts"
    )
    turns: Mapped[list["VivaTurn"]] = relationship(cascade="all, delete-orphan", order_by="VivaTurn.start_ts")


class VivaEvent(Base):
    """An integrity flag, e.g. looking away for 5 s or a phone in view. Advisory only."""

    __tablename__ = "viva_events"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("viva_sessions.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(40))
    # Seconds since the session started (so the timeline and transcript line up).
    start_ts: Mapped[float] = mapped_column(Float)
    end_ts: Mapped[float] = mapped_column(Float)
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    detail: Mapped[str] = mapped_column(String(255), default="")
    snapshot_key: Mapped[str | None] = mapped_column(String(255), default=None)  # under settings.upload_dir


class VivaTurn(Base):
    """One utterance in the transcript. Student turns carry the evaluation engine's analysis."""

    __tablename__ = "viva_turns"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("viva_sessions.id", ondelete="CASCADE"), index=True)
    speaker: Mapped[Speaker] = mapped_column(Enum(Speaker, native_enum=False))
    text: Mapped[str] = mapped_column(Text)
    start_ts: Mapped[float] = mapped_column(Float)
    end_ts: Mapped[float] = mapped_column(Float)
    words: Mapped[int] = mapped_column(Integer, default=0)
    # Student answers: {correctness, depth, similarity, latency_s, filler_rate, wpm, long_pauses,
    # memorization_flag, weak_points, mastery}
    analysis: Mapped[dict | None] = mapped_column(JSON, default=None)
