from datetime import datetime
from typing import Literal

from pydantic import AwareDatetime, Field, field_validator

from app.models.viva import VivaAudience, VivaConductor, VivaStatus
from app.schemas.base import ApiModel
from app.schemas.classroom import PersonOut
from app.schemas.file import FileOut

# draft → upcoming → live → closed. Only `status` is stored; the rest follows from the schedule.
VivaPhase = Literal["draft", "upcoming", "live", "closed"]

# Class-level numbers the instructor can ask for in the summary report.
SummaryStat = Literal[
    "average_score",
    "score_distribution",
    "criteria_breakdown",
    "completion_rate",
    "common_strengths",
    "common_gaps",
    "proctoring_flags",
    "top_and_bottom",
]


class Criterion(ApiModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=500)
    weight: int = Field(default=1, ge=1, le=100)  # relative weight


class SlotIn(ApiModel):
    student_id: str
    examiner_id: str


class VivaCreateIn(ApiModel):
    audience: VivaAudience
    title: str = Field(default="Untitled viva", min_length=1, max_length=160)


class VivaUpdateIn(ApiModel):
    """The whole setup form. Saved as a draft; checked in full only when scheduling."""

    title: str = Field(min_length=1, max_length=160)
    assignment_id: str | None = None
    student_ids: list[str] = Field(default_factory=list, max_length=500)
    starts_at: AwareDatetime | None = None  # the end time follows from the join window + duration
    duration_minutes: int = Field(default=20, ge=5, le=180)
    conducted_by: VivaConductor = VivaConductor.staff
    break_minutes: int = Field(default=5, ge=0, le=60)
    examiner_ids: list[str] = Field(default_factory=list, max_length=50)
    # Staff vivas: who interviews whom. Each examiner sees their students in this order.
    allocation: list[SlotIn] = Field(default_factory=list, max_length=500)
    interview_instructions: str = Field(default="", max_length=20000)
    evaluation_criteria: list[Criterion] = Field(default_factory=list, max_length=20)
    report_format: str = Field(default="", max_length=20000)
    summary_stats: list[SummaryStat] = Field(default_factory=list)

    @field_validator("title", "interview_instructions", "report_format")
    @classmethod
    def strip(cls, v: str) -> str:
        return v.strip()


class ExaminerOut(PersonOut):
    is_owner: bool


class SlotOut(ApiModel):
    """A student's interview slot with an examiner."""

    student: PersonOut
    examiner_id: str
    position: int
    starts_at: datetime | None
    join_closes_at: datetime | None
    ends_at: datetime | None


class VivaSummaryOut(ApiModel):
    id: str
    title: str
    audience: VivaAudience
    conducted_by: VivaConductor
    status: VivaStatus
    phase: VivaPhase
    starts_at: datetime | None
    join_closes_at: datetime | None  # students who haven't opened the viva by now miss it
    ends_at: datetime | None
    student_count: int
    created_at: datetime


class VivaOut(VivaSummaryOut):
    class_id: str
    assignment_id: str | None
    assignment_title: str | None
    duration_minutes: int
    break_minutes: int
    join_window_minutes: int
    students: list[PersonOut]  # selected students (empty for whole-class vivas)
    staff: list[ExaminerOut]  # who could examine: the instructor and the TAs
    examiner_ids: list[str]
    slots: list[SlotOut]  # sorted by examiner, then position
    unallocated: list[PersonOut]  # students without a slot (staff vivas)
    interview_instructions: str
    evaluation_criteria: list[Criterion]
    report_format: str
    summary_stats: list[SummaryStat]
    files: list[FileOut]
    updated_at: datetime


class VivaFeedbackOut(ApiModel):
    feedback: str
    files: list[FileOut]
    released_at: datetime | None


class VivaStudentRow(ApiModel):
    student: PersonOut
    resume_status: Literal["submitted", "late", "missing", "not_linked"]
    # not_started: can still join (or the viva hasn't opened). missed: didn't open it within the join window.
    # completed / score / flags are filled in by the viva engine.
    viva_status: Literal["not_started", "joined", "missed", "completed"]
    joined_at: datetime | None = None
    examiner: PersonOut | None = None
    slot_starts_at: datetime | None = None
    session_id: str | None = None
    session_status: Literal["waiting", "live", "ended"] | None = None
    score: float | None = None
    risk_score: float | None = None
    mastery_score: float | None = None
    flags: int = 0
    feedback: VivaFeedbackOut | None = None


class CriterionAverage(ApiModel):
    name: str
    average: float


class VivaStatsOut(ApiModel):
    viva_id: str
    phase: VivaPhase
    summary_stats: list[SummaryStat]
    assigned_count: int
    resumes_ready: int
    joined_count: int
    missed_count: int
    completed_count: int
    join_window_minutes: int
    average_score: float | None
    criteria_averages: list[CriterionAverage]
    flag_counts: dict[str, int]  # integrity event type -> count, over every session
    students: list[VivaStudentRow]


class VivaJoinOut(ApiModel):
    """A student's entry into the viva."""

    viva_id: str
    joined_at: datetime
    ends_at: datetime  # joined_at + duration


class StudentVivaOut(ApiModel):
    """What a student sees of a viva: timing and their own status / feedback, not the setup."""

    id: str
    class_id: str
    title: str
    conducted_by: VivaConductor
    # Staff vivas: the student's own slot (not the viva's first start time).
    starts_at: datetime
    join_closes_at: datetime
    ends_at: datetime
    duration_minutes: int
    join_window_minutes: int
    # upcoming: not open yet · open: join now · in_progress: joined, time left · attended: joined, time up
    # missed: didn't open it within the join window
    my_status: Literal["upcoming", "open", "in_progress", "attended", "missed"]
    joined_at: datetime | None
    my_ends_at: datetime | None  # joined_at + duration
    examiner: PersonOut | None  # staff vivas: who interviews this student
    session_id: str | None
    feedback: VivaFeedbackOut | None  # only once released by staff
