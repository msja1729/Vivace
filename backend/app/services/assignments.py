from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import storage
from app.core.db import utcnow
from app.core.errors import BadRequest, Forbidden, NotFound
from app.models import Assignment, ClassRoom, FileKind, Submission, User
from app.schemas.assignment import (
    AssignmentDetailOut,
    AssignmentIn,
    AssignmentOut,
    GradeIn,
    RosterRow,
    StudentAssignmentOut,
    SubmissionOut,
    SubmissionStatus,
)
from app.schemas.classroom import PersonOut
from app.services import files
from app.services.classes import get_managed_class, is_member, list_members

MAX_LINKS = 10


def submission_status(sub: Submission | None, deadline) -> SubmissionStatus:
    if sub is None:
        return "missing"
    return "late" if sub.submitted_at > deadline else "submitted"


def submissions_by_student(db: Session, assignment_id: str) -> dict[str, Submission]:
    return {
        s.student_id: s
        for s in db.scalars(select(Submission).where(Submission.assignment_id == assignment_id))
    }


STUDENT_KINDS = (FileKind.submission, FileKind.resume, FileKind.transcript)
MAX_FILES = 20


def _submission_out(sub: Submission, deadline) -> SubmissionOut:
    own = [f for f in sub.files if f.kind in STUDENT_KINDS]
    return SubmissionOut(
        id=sub.id,
        submitted_at=sub.submitted_at,
        is_late=sub.submitted_at > deadline,
        github_links=sub.github_links,
        note=sub.note,
        files=[files.to_out(f) for f in sorted(own, key=lambda f: f.created_at)],
        marks=sub.marks,
        feedback=sub.feedback,
        returned_at=sub.returned_at,
        feedback_files=[files.to_out(f) for f in sub.files if f.kind == FileKind.feedback],
    )


def _roster(db: Session, a: Assignment) -> list[RosterRow]:
    subs = submissions_by_student(db, a.id)
    rows = []
    for m in list_members(db, a.class_id):
        sub = subs.get(m.user_id)
        rows.append(
            RosterRow(
                student=PersonOut.model_validate(m.user),
                status=submission_status(sub, a.deadline),
                submission=_submission_out(sub, a.deadline) if sub else None,
            )
        )
    return rows


def _to_out(a: Assignment, roster: list[RosterRow]) -> AssignmentOut:
    submitted = sum(r.status != "missing" for r in roster)
    marks = [r.submission.marks for r in roster if r.submission and r.submission.marks is not None]
    return AssignmentOut(
        id=a.id,
        class_id=a.class_id,
        title=a.title,
        instructions=a.instructions,
        deadline=a.deadline,
        graded=a.graded,
        total_marks=a.total_marks,
        created_at=a.created_at,
        is_open=utcnow() < a.deadline,
        total_students=len(roster),
        submitted_count=submitted,
        late_count=sum(r.status == "late" for r in roster),
        missing_count=len(roster) - submitted,
        returned_count=sum(bool(r.submission and r.submission.returned_at) for r in roster),
        average_marks=round(sum(marks) / len(marks), 1) if a.graded and marks else None,
    )


def _owned_assignment(db: Session, assignment_id: str, user: User) -> Assignment:
    a = db.get(Assignment, assignment_id)
    if a is None:
        raise NotFound("Assignment not found.")
    get_managed_class(db, a.class_id, user)
    return a


def create(db: Session, class_id: str, data: AssignmentIn, user: User) -> AssignmentOut:
    cls: ClassRoom = get_managed_class(db, class_id, user)
    a = Assignment(class_id=cls.id, **data.model_dump())
    db.add(a)
    db.commit()
    return _to_out(a, _roster(db, a))


def list_for_class(db: Session, class_id: str, user: User) -> list[AssignmentOut]:
    get_managed_class(db, class_id, user)
    rows = db.scalars(
        select(Assignment).where(Assignment.class_id == class_id).order_by(Assignment.created_at.desc())
    )
    return [_to_out(a, _roster(db, a)) for a in rows]


def get_detail(db: Session, assignment_id: str, user: User) -> AssignmentDetailOut:
    a = _owned_assignment(db, assignment_id, user)
    roster = _roster(db, a)
    return AssignmentDetailOut(**_to_out(a, roster).model_dump(), students=roster)


def update(db: Session, assignment_id: str, data: AssignmentIn, user: User) -> AssignmentDetailOut:
    a = _owned_assignment(db, assignment_id, user)
    given = [s.marks for s in a.submissions if s.marks is not None]
    if given and not data.graded:
        raise BadRequest("Marks have already been given, so this assignment must stay graded.")
    if given and data.total_marks is not None and data.total_marks < max(given):
        raise BadRequest(f"Total marks can't be lower than a mark already given ({max(given):g}).")
    for key, value in data.model_dump().items():
        setattr(a, key, value)
    db.commit()
    return get_detail(db, assignment_id, user)


def delete(db: Session, assignment_id: str, user: User) -> None:
    a = _owned_assignment(db, assignment_id, user)
    for sub in a.submissions:
        for f in list(sub.files):
            files.remove(db, f)
    db.delete(a)
    db.commit()


def _parse_links(raw: str) -> list[str]:
    links = [line.strip() for line in raw.replace(",", "\n").splitlines() if line.strip()]
    if len(links) > MAX_LINKS:
        raise BadRequest(f"Add at most {MAX_LINKS} links.")
    for link in links:
        if not link.startswith(("https://", "http://")) or len(link) > 300:
            raise BadRequest(f"Not a valid link: {link[:80]}")
    return links


def submit(
    db: Session,
    assignment_id: str,
    user: User,
    *,
    uploads: list[UploadFile],
    keep_file_ids: list[str],
    github_links: str,
    note: str,
) -> SubmissionOut:
    """A student turns in their work: new files plus any earlier files they chose to keep.
    Allowed any number of times until the deadline."""
    a = db.get(Assignment, assignment_id)
    if a is None or not is_member(db, a.class_id, user.id):
        raise NotFound("Assignment not found.")
    if utcnow() > a.deadline:
        raise Forbidden("The deadline has passed. Submissions are closed.")

    sub = db.scalar(
        select(Submission).where(Submission.assignment_id == a.id, Submission.student_id == user.id)
    )
    previous = [f for f in sub.files if f.kind in STUDENT_KINDS] if sub else []
    keep = set(keep_file_ids)
    kept = [f for f in previous if f.id in keep]
    if len(kept) + len(uploads) == 0:
        raise BadRequest("Add at least one file to turn in.")
    if len(kept) + len(uploads) > MAX_FILES:
        raise BadRequest(f"Turn in at most {MAX_FILES} files.")
    links = _parse_links(github_links)

    if sub is None:
        sub = Submission(assignment_id=a.id, student_id=user.id)
        db.add(sub)
        db.flush()

    # Files not kept are removed; their bytes are deleted only after the commit.
    new = [files.store(db, u, kind=FileKind.submission, class_id=a.class_id, uploader=user) for u in uploads]
    stale: list[str] = []
    for old in previous:
        if old.id not in keep:
            sub.files.remove(old)
            stale.append(old.storage_key)
    sub.files.extend(new)

    sub.github_links = links
    sub.note = note.strip()[:2000]
    sub.submitted_at = utcnow()
    db.commit()
    for key in stale:
        storage.delete(key)
    db.refresh(sub)
    return _submission_out(sub, a.deadline)


def grade(
    db: Session, submission_id: str, data: GradeIn, attachments: list[UploadFile], user: User
) -> SubmissionOut:
    """Staff return a submission with marks (graded assignments), feedback and optional files.
    Can be returned again; new attachments are added to the earlier ones."""
    sub = db.get(Submission, submission_id)
    if sub is None:
        raise NotFound("Submission not found.")
    a = _owned_assignment(db, sub.assignment_id, user)
    if a.graded:
        if data.marks is None:
            raise BadRequest(f"Enter marks out of {a.total_marks}.")
        if data.marks > a.total_marks:
            raise BadRequest(f"Marks can't be more than the total ({a.total_marks}).")
    elif data.marks is not None:
        raise BadRequest("This assignment isn't graded. Give feedback only.")
    elif not data.feedback and not attachments and not any(f.kind == FileKind.feedback for f in sub.files):
        raise BadRequest("Write some feedback or attach a file before returning.")

    for upload in attachments:
        sub.files.append(files.store(db, upload, kind=FileKind.feedback, class_id=a.class_id, uploader=user))
    sub.marks = data.marks
    sub.feedback = data.feedback
    sub.returned_at = utcnow()
    db.commit()
    db.refresh(sub)
    return _submission_out(sub, a.deadline)


# ---------- Student view ----------


def _student_out(a: Assignment, sub: Submission | None) -> StudentAssignmentOut:
    is_open = utcnow() < a.deadline
    if sub is None:
        status = "assigned" if is_open else "missed"
    else:
        status = "returned" if sub.returned_at else "turned_in"
    return StudentAssignmentOut(
        id=a.id,
        class_id=a.class_id,
        title=a.title,
        instructions=a.instructions,
        deadline=a.deadline,
        is_open=is_open,
        graded=a.graded,
        total_marks=a.total_marks,
        my_status=status,
        submission=_submission_out(sub, a.deadline) if sub else None,
    )


def _my_submission(db: Session, assignment_id: str, user: User) -> Submission | None:
    return db.scalar(
        select(Submission).where(Submission.assignment_id == assignment_id, Submission.student_id == user.id)
    )


def list_mine(db: Session, class_id: str, user: User) -> list[StudentAssignmentOut]:
    """A student's assignments in a class, newest first."""
    if not is_member(db, class_id, user.id):
        raise NotFound("Class not found.")
    rows = db.scalars(
        select(Assignment).where(Assignment.class_id == class_id).order_by(Assignment.created_at.desc())
    )
    return [_student_out(a, _my_submission(db, a.id, user)) for a in rows]


def get_mine(db: Session, assignment_id: str, user: User) -> StudentAssignmentOut:
    a = db.get(Assignment, assignment_id)
    if a is None or not is_member(db, a.class_id, user.id):
        raise NotFound("Assignment not found.")
    return _student_out(a, _my_submission(db, a.id, user))
