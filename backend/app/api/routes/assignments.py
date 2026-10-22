from typing import Annotated

from fastapi import APIRouter, File, Form, UploadFile, status
from pydantic import ValidationError

from app.api.deps import DbSession, RegisteredUser
from app.core.errors import BadRequest
from app.schemas.assignment import (
    AssignmentDetailOut,
    AssignmentIn,
    AssignmentOut,
    GradeIn,
    StudentAssignmentOut,
    SubmissionOut,
)
from app.services import assignments

router = APIRouter(tags=["assignments"])


@router.post(
    "/classes/{class_id}/assignments", response_model=AssignmentOut, status_code=status.HTTP_201_CREATED
)
def create_assignment(class_id: str, body: AssignmentIn, user: RegisteredUser, db: DbSession):
    """Staff set work for the class: title, instructions, deadline, optional marks."""
    return assignments.create(db, class_id, body, user)


@router.get("/classes/{class_id}/assignments", response_model=list[AssignmentOut])
def list_assignments(class_id: str, user: RegisteredUser, db: DbSession):
    return assignments.list_for_class(db, class_id, user)


@router.get("/assignments/{assignment_id}", response_model=AssignmentDetailOut)
def get_assignment(assignment_id: str, user: RegisteredUser, db: DbSession):
    """Instructor view: every student with submitted / late / missing and their files."""
    return assignments.get_detail(db, assignment_id, user)


@router.put("/assignments/{assignment_id}", response_model=AssignmentDetailOut)
def update_assignment(assignment_id: str, body: AssignmentIn, user: RegisteredUser, db: DbSession):
    return assignments.update(db, assignment_id, body, user)


@router.delete("/assignments/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_assignment(assignment_id: str, user: RegisteredUser, db: DbSession):
    assignments.delete(db, assignment_id, user)


@router.post("/assignments/{assignment_id}/submission", response_model=SubmissionOut)
def submit(
    assignment_id: str,
    user: RegisteredUser,
    db: DbSession,
    files: Annotated[list[UploadFile] | None, File()] = None,
    keep_file_ids: Annotated[list[str] | None, Form(alias="keepFileIds")] = None,
    github_links: Annotated[str, Form(alias="githubLinks")] = "",
    note: Annotated[str, Form()] = "",
):
    """Student turns in any files (plus earlier ones listed in keepFileIds), GitHub links and a note."""
    return assignments.submit(
        db,
        assignment_id,
        user,
        uploads=files or [],
        keep_file_ids=keep_file_ids or [],
        github_links=github_links,
        note=note,
    )


@router.put("/submissions/{submission_id}/grade", response_model=SubmissionOut)
def grade_submission(
    submission_id: str,
    user: RegisteredUser,
    db: DbSession,
    marks: Annotated[str, Form()] = "",
    feedback: Annotated[str, Form()] = "",
    attachments: Annotated[list[UploadFile] | None, File()] = None,
):
    """Staff return the work with marks (graded assignments), feedback and optional files (multipart)."""
    try:
        data = GradeIn(marks=marks.strip() or None, feedback=feedback)
    except ValidationError as err:
        raise BadRequest("Marks must be a number of 0 or more.") from err
    return assignments.grade(db, submission_id, data, attachments or [], user)


@router.get("/classes/{class_id}/my-assignments", response_model=list[StudentAssignmentOut])
def my_assignments(class_id: str, user: RegisteredUser, db: DbSession):
    """Student: the class's assignments with their own submission and returned feedback."""
    return assignments.list_mine(db, class_id, user)


@router.get("/assignments/{assignment_id}/mine", response_model=StudentAssignmentOut)
def my_assignment(assignment_id: str, user: RegisteredUser, db: DbSession):
    return assignments.get_mine(db, assignment_id, user)
