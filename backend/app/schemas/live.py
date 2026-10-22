from datetime import datetime
from typing import Literal

from pydantic import Field

from app.schemas.base import ApiModel
from app.schemas.classroom import PersonOut
from app.schemas.viva import Criterion, VivaFeedbackOut

SessionState = Literal["waiting", "live", "ended"]


class QueueRow(ApiModel):
    """One student in an examiner's queue for a staff-run viva."""

    student: PersonOut
    examiner: PersonOut
    position: int
    starts_at: datetime
    join_closes_at: datetime
    joined_at: datetime | None
    missed: bool  # didn't open the viva within the join window
    session_id: str | None
    session_status: SessionState | None
    student_online: bool
    score: float | None


class QueueOut(ApiModel):
    viva_id: str
    title: str
    phase: str
    duration_minutes: int
    can_conduct_all: bool  # the class owner may step in for any examiner
    rows: list[QueueRow]


class CriterionResult(ApiModel):
    name: str = Field(min_length=1, max_length=80)
    score: float | None = Field(default=None, ge=0, le=10)


class ResultIn(ApiModel):
    """The examiner's decision once the interview is over."""

    score: float = Field(ge=0, le=10)
    criteria_scores: list[CriterionResult] = Field(default_factory=list, max_length=20)
    notes: str = Field(default="", max_length=20000)


class ReleaseIn(ApiModel):
    """What to send the student: the marks, the AI's report and / or a message."""

    include_marks: bool = True
    include_ai_report: bool = True
    message: str = Field(default="", max_length=20000)


class IntegritySummaryOut(ApiModel):
    level: Literal["clear", "minor", "concerns", "unverified"]
    text: str


class QAOut(ApiModel):
    question: str
    answer: str


class EventOut(ApiModel):
    id: int
    type: str
    label: str
    start_ts: float
    end_ts: float
    confidence: float
    detail: str
    has_snapshot: bool


class TurnOut(ApiModel):
    id: int
    speaker: Literal["examiner", "student"]
    text: str
    start_ts: float
    end_ts: float
    analysis: dict | None


class SessionReportOut(ApiModel):
    """Everything the per-student report shows: summary, integrity timeline, answers, transcript."""

    id: str
    viva_id: str
    viva_title: str
    class_id: str
    student: PersonOut
    examiner: PersonOut | None
    status: SessionState
    created_at: datetime
    started_at: datetime | None
    ended_at: datetime | None
    risk_score: float
    risk_band: Literal["low", "medium", "high"]
    mastery_score: float | None
    score: float | None
    criteria_scores: list[CriterionResult]
    suggested_criteria_scores: list[CriterionResult]  # averages of the Grader's per-answer scores
    notes: str
    evaluation_criteria: list[Criterion]
    report_format: str
    calibrated: bool
    events: list[EventOut]
    turns: list[TurnOut]
    qa: list[QAOut]  # each question with the student's answer, straight from the transcript
    integrity: IntegritySummaryOut  # one or two lines: did the student genuinely attend?
    ai_report: dict | None  # the AI's written assessment (see live/evaluation/report.py)
    sent_to_student: VivaFeedbackOut | None  # what the student has been sent, if anything
