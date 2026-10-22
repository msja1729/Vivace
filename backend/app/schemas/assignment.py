from datetime import datetime
from typing import Literal

from pydantic import AwareDatetime, Field, field_validator, model_validator

from app.schemas.base import ApiModel
from app.schemas.classroom import PersonOut
from app.schemas.file import FileOut


class AssignmentIn(ApiModel):
    """Used to create and to edit an assignment."""

    title: str = Field(min_length=1, max_length=160)
    instructions: str = Field(default="", max_length=5000)
    deadline: AwareDatetime
    graded: bool = False
    total_marks: int | None = Field(default=None, ge=1, le=1000)

    @field_validator("title", "instructions")
    @classmethod
    def strip(cls, v: str) -> str:
        return v.strip()

    @model_validator(mode="after")
    def marks_need_total(self):
        if self.graded and self.total_marks is None:
            raise ValueError("Set the total marks for a graded assignment.")
        if not self.graded:
            self.total_marks = None
        return self


class AssignmentOut(ApiModel):
    id: str
    class_id: str
    title: str
    instructions: str
    deadline: datetime
    graded: bool
    total_marks: int | None
    created_at: datetime
    is_open: bool  # deadline not yet passed
    total_students: int
    submitted_count: int  # includes late submissions
    late_count: int
    missing_count: int
    returned_count: int  # submissions the instructor has returned with marks / feedback
    average_marks: float | None  # graded assignments only


class SubmissionOut(ApiModel):
    id: str
    submitted_at: datetime
    is_late: bool
    github_links: list[str]
    note: str
    files: list[FileOut]  # the student's uploads
    marks: float | None
    feedback: str
    returned_at: datetime | None
    feedback_files: list[FileOut]  # attached by staff when returning


SubmissionStatus = Literal["submitted", "late", "missing"]


class RosterRow(ApiModel):
    student: PersonOut
    status: SubmissionStatus
    submission: SubmissionOut | None


class AssignmentDetailOut(AssignmentOut):
    students: list[RosterRow]


class GradeIn(ApiModel):
    """Return a submission: marks (graded assignments only) and feedback."""

    marks: float | None = Field(default=None, ge=0)
    feedback: str = Field(default="", max_length=5000)

    @field_validator("feedback")
    @classmethod
    def strip(cls, v: str) -> str:
        return v.strip()


class StudentAssignmentOut(ApiModel):
    """What a student sees of an assignment: no class statistics, only their own submission."""

    id: str
    class_id: str
    title: str
    instructions: str
    deadline: datetime
    is_open: bool  # can still submit (deadline not passed)
    graded: bool
    total_marks: int | None
    # assigned: nothing turned in yet · turned_in · returned (marks / feedback back) · missed: deadline passed
    my_status: Literal["assigned", "turned_in", "returned", "missed"]
    submission: SubmissionOut | None
