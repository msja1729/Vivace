"""All database models. Importing this package registers every table on `Base.metadata`."""

from app.models.assignment import Assignment, Submission
from app.models.classroom import ClassMember, ClassRoom, ClassTA
from app.models.file import FileKind, StoredFile
from app.models.live import SessionStatus, Speaker, VivaEvent, VivaSession, VivaTurn
from app.models.user import Role, User
from app.models.viva import (
    Viva,
    VivaAttempt,
    VivaAudience,
    VivaConductor,
    VivaExaminer,
    VivaFeedback,
    VivaSlot,
    VivaStatus,
    VivaStudent,
)

__all__ = [
    "Assignment",
    "ClassMember",
    "ClassRoom",
    "ClassTA",
    "FileKind",
    "Role",
    "SessionStatus",
    "Speaker",
    "StoredFile",
    "Submission",
    "User",
    "Viva",
    "VivaAttempt",
    "VivaAudience",
    "VivaConductor",
    "VivaEvent",
    "VivaExaminer",
    "VivaFeedback",
    "VivaSession",
    "VivaSlot",
    "VivaStatus",
    "VivaStudent",
    "VivaTurn",
]
