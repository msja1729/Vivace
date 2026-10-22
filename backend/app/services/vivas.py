from datetime import datetime, timedelta

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import utcnow
from app.core.errors import BadRequest, Conflict, Forbidden, NotFound
from app.models import (
    Assignment,
    ClassRoom,
    ClassTA,
    FileKind,
    SessionStatus,
    User,
    Viva,
    VivaAttempt,
    VivaAudience,
    VivaConductor,
    VivaExaminer,
    VivaFeedback,
    VivaSession,
    VivaSlot,
    VivaStatus,
    VivaStudent,
)
from app.schemas.classroom import PersonOut
from app.schemas.file import FileOut
from app.schemas.viva import (
    Criterion,
    CriterionAverage,
    ExaminerOut,
    SlotOut,
    StudentVivaOut,
    VivaCreateIn,
    VivaFeedbackOut,
    VivaJoinOut,
    VivaOut,
    VivaPhase,
    VivaStatsOut,
    VivaStudentRow,
    VivaSummaryOut,
    VivaUpdateIn,
)
from app.services import files
from app.services.assignments import submission_status, submissions_by_student
from app.services.classes import get_managed_class, is_member, list_members

# Sensible starting point for a new viva; the instructor edits it in Setup.
DEFAULT_CRITERIA = [
    Criterion(name="Conceptual understanding", description="Explains the why, not just the what.", weight=40),
    Criterion(
        name="Ownership of projects", description="Can explain their own code and design choices.", weight=40
    ),
    Criterion(name="Communication", description="Clear, structured answers.", weight=20),
]
DEFAULT_STATS = [
    "average_score",
    "score_distribution",
    "criteria_breakdown",
    "completion_rate",
    "common_gaps",
]


def join_window_minutes() -> int:
    return get_settings().viva_join_window_minutes


def join_closes_at(v: Viva) -> datetime | None:
    """Students must open the viva by this time; after it, entry is closed."""
    return v.starts_at + timedelta(minutes=join_window_minutes()) if v.starts_at else None


def slot_starts_at(v: Viva, position: int) -> datetime | None:
    """Staff vivas: each examiner sees their students one after another, with a break in between."""
    if v.starts_at is None:
        return None
    return v.starts_at + timedelta(minutes=position * (v.duration_minutes + v.break_minutes))


def _set_end(v: Viva) -> None:
    # The last student to get in (at the end of the join window) still gets the full duration.
    last = max((s.position for s in v.slots), default=0) if v.conducted_by == VivaConductor.staff else 0
    start = slot_starts_at(v, last)
    v.ends_at = start + timedelta(minutes=join_window_minutes() + v.duration_minutes) if start else None


def phase(v: Viva) -> VivaPhase:
    if v.status == VivaStatus.draft or v.starts_at is None or v.ends_at is None:
        return "draft"
    now = utcnow()
    if now < v.starts_at:
        return "upcoming"
    return "live" if now < v.ends_at else "closed"


def ensure_editable(v: Viva | None) -> None:
    if v is not None and phase(v) in ("live", "closed"):
        raise Conflict("This viva has already started and can no longer be changed.")


def _students(db: Session, v: Viva) -> list[PersonOut]:
    """Who takes the viva: every current class member, or the picked students."""
    if v.audience == VivaAudience.whole_class:
        return [PersonOut.model_validate(m.user) for m in list_members(db, v.class_id)]
    return [PersonOut.model_validate(s.student) for s in sorted(v.students, key=lambda s: s.student.name)]


def staff_of(db: Session, class_id: str) -> list[ExaminerOut]:
    """Everyone who can examine in this class: the instructor first, then the TAs."""
    cls = db.get(ClassRoom, class_id)
    tas = db.scalars(select(ClassTA).where(ClassTA.class_id == class_id).order_by(ClassTA.added_at))
    owner = ExaminerOut(
        id=cls.instructor.id, name=cls.instructor.name, email=cls.instructor.email, is_owner=True
    )
    return [owner] + [
        ExaminerOut(id=t.user.id, name=t.user.name, email=t.user.email, is_owner=False) for t in tas
    ]


def live_slots(db: Session, v: Viva, students: list[PersonOut] | None = None) -> list[VivaSlot]:
    """Slots of students who still take the viva, with examiners who are still staff of the class."""
    if v.conducted_by != VivaConductor.staff:
        return []
    ids = {p.id for p in (students if students is not None else _students(db, v))}
    staff = {e.id for e in staff_of(db, v.class_id)}
    return [s for s in v.slots if s.student_id in ids and s.examiner_id in staff]


def _slot_out(v: Viva, s: VivaSlot) -> SlotOut:
    start = slot_starts_at(v, s.position)
    return SlotOut(
        student=PersonOut.model_validate(s.student),
        examiner_id=s.examiner_id,
        position=s.position,
        starts_at=start,
        join_closes_at=start + timedelta(minutes=join_window_minutes()) if start else None,
        ends_at=start + timedelta(minutes=v.duration_minutes) if start else None,
    )


def _summary(db: Session, v: Viva) -> VivaSummaryOut:
    return VivaSummaryOut(
        id=v.id,
        title=v.title,
        audience=v.audience,
        conducted_by=v.conducted_by,
        status=v.status,
        phase=phase(v),
        starts_at=v.starts_at,
        join_closes_at=join_closes_at(v),
        ends_at=v.ends_at,
        student_count=len(_students(db, v)),
        created_at=v.created_at,
    )


def _to_out(db: Session, v: Viva) -> VivaOut:
    students = _students(db, v)
    staff = staff_of(db, v.class_id)
    staff_ids = {e.id for e in staff}
    slots = sorted(live_slots(db, v, students), key=lambda s: (s.examiner_id, s.position))
    allocated = {s.student_id for s in slots}
    return VivaOut(
        **_summary(db, v).model_dump(),
        class_id=v.class_id,
        assignment_id=v.assignment_id,
        assignment_title=v.assignment.title if v.assignment else None,
        duration_minutes=v.duration_minutes,
        break_minutes=v.break_minutes,
        join_window_minutes=join_window_minutes(),
        students=students if v.audience == VivaAudience.selected else [],
        staff=staff,
        examiner_ids=[e.user_id for e in v.examiners if e.user_id in staff_ids],
        slots=[_slot_out(v, s) for s in slots],
        unallocated=[p for p in students if p.id not in allocated]
        if v.conducted_by == VivaConductor.staff
        else [],
        interview_instructions=v.interview_instructions,
        evaluation_criteria=[Criterion.model_validate(c) for c in v.evaluation_criteria],
        report_format=v.report_format,
        summary_stats=v.summary_stats,
        files=[files.to_out(f) for f in sorted(v.files, key=lambda f: f.created_at)],
        updated_at=v.updated_at,
    )


def owned_viva(db: Session, viva_id: str, user: User) -> Viva:
    """The viva, if `user` is staff (instructor or TA) of its class."""
    v = db.get(Viva, viva_id)
    if v is None:
        raise NotFound("Viva not found.")
    get_managed_class(db, v.class_id, user)
    return v


def create(db: Session, class_id: str, data: VivaCreateIn, user: User) -> VivaOut:
    cls = get_managed_class(db, class_id, user)
    # Use the class's latest resume assignment by default.
    latest = db.scalar(
        select(Assignment)
        .where(Assignment.class_id == cls.id)
        .order_by(Assignment.created_at.desc())
        .limit(1)
    )
    v = Viva(
        class_id=cls.id,
        title=data.title.strip() or "Untitled viva",
        audience=data.audience,
        assignment_id=latest.id if latest else None,
        evaluation_criteria=[c.model_dump() for c in DEFAULT_CRITERIA],
        summary_stats=list(DEFAULT_STATS),
    )
    # Every staff member examines by default; the instructor narrows it down in Setup.
    v.examiners = [VivaExaminer(user_id=e.id) for e in staff_of(db, cls.id)]
    db.add(v)
    db.commit()
    return _to_out(db, v)


def list_for_class(db: Session, class_id: str, user: User) -> list[VivaSummaryOut]:
    get_managed_class(db, class_id, user)
    rows = db.scalars(select(Viva).where(Viva.class_id == class_id).order_by(Viva.created_at.desc()))
    return [_summary(db, v) for v in rows]


def get(db: Session, viva_id: str, user: User) -> VivaOut:
    return _to_out(db, owned_viva(db, viva_id, user))


def update(db: Session, viva_id: str, data: VivaUpdateIn, user: User) -> VivaOut:
    v = owned_viva(db, viva_id, user)
    ensure_editable(v)

    if data.assignment_id is not None:
        a = db.get(Assignment, data.assignment_id)
        if a is None or a.class_id != v.class_id:
            raise BadRequest("That assignment isn't part of this class.")

    if v.audience == VivaAudience.selected:
        member_ids = {m.user_id for m in list_members(db, v.class_id)}
        picked = list(dict.fromkeys(data.student_ids))
        if not set(picked) <= member_ids:
            raise BadRequest("Some selected students aren't in this class.")
        # Update by difference: re-inserting a kept student would clash with the unique constraint.
        v.students = [s for s in v.students if s.student_id in picked]
        kept = {s.student_id for s in v.students}
        v.students.extend(VivaStudent(student_id=sid) for sid in picked if sid not in kept)

    v.title = data.title
    v.assignment_id = data.assignment_id
    v.starts_at = data.starts_at
    v.duration_minutes = data.duration_minutes
    v.conducted_by = data.conducted_by
    v.break_minutes = data.break_minutes
    if v.conducted_by == VivaConductor.staff:
        _set_allocation(db, v, data)
    _set_end(v)
    v.interview_instructions = data.interview_instructions
    v.evaluation_criteria = [c.model_dump() for c in data.evaluation_criteria]
    v.report_format = data.report_format
    v.summary_stats = list(dict.fromkeys(data.summary_stats))

    # A scheduled viva must stay complete; otherwise go back to draft first.
    if v.status == VivaStatus.scheduled:
        _check_ready(db, v)
    db.commit()
    db.refresh(v)
    return _to_out(db, v)


def _set_allocation(db: Session, v: Viva, data: VivaUpdateIn) -> None:
    """Examiners and who they interview. Positions follow the order of `allocation` per examiner."""
    staff_ids = {e.id for e in staff_of(db, v.class_id)}
    examiner_ids = list(dict.fromkeys(data.examiner_ids))
    if not set(examiner_ids) <= staff_ids:
        raise BadRequest("Examiners must be the instructor or a TA of this class.")
    v.examiners = [e for e in v.examiners if e.user_id in examiner_ids]
    kept = {e.user_id for e in v.examiners}
    v.examiners.extend(VivaExaminer(user_id=uid) for uid in examiner_ids if uid not in kept)

    db.flush()  # the picked students may have just changed
    student_ids = {p.id for p in _students(db, v)}
    positions: dict[str, int] = {}
    wanted: dict[str, tuple[str, int]] = {}
    for a in data.allocation:
        if a.student_id not in student_ids:
            raise BadRequest("Some allocated students aren't taking this viva.")
        if a.examiner_id not in examiner_ids:
            raise BadRequest("Students can only be allocated to the chosen examiners.")
        if a.student_id in wanted:
            raise BadRequest("Each student can be allocated to only one examiner.")
        pos = positions.get(a.examiner_id, 0)
        positions[a.examiner_id] = pos + 1
        wanted[a.student_id] = (a.examiner_id, pos)

    # Update in place: re-inserting a kept student would clash with the unique constraint.
    v.slots = [s for s in v.slots if s.student_id in wanted]
    for s in v.slots:
        s.examiner_id, s.position = wanted.pop(s.student_id)
    v.slots.extend(VivaSlot(student_id=sid, examiner_id=e, position=p) for sid, (e, p) in wanted.items())
    db.flush()


def _check_ready(db: Session, v: Viva) -> None:
    problems = []
    if not v.interview_instructions and not v.files:
        problems.append("write interview instructions or upload an instructions file")
    if not v.evaluation_criteria:
        problems.append("add at least one evaluation criterion")
    if not v.report_format:
        problems.append("describe the report format")
    if v.starts_at is None:
        problems.append("set the start time")
    if v.audience == VivaAudience.selected and not v.students:
        problems.append("pick at least one student")
    if v.conducted_by == VivaConductor.ai:
        problems.append("the AI examiner isn't available yet, so choose instructor & TAs")
    elif not v.examiners:
        problems.append("choose at least one examiner")
    else:
        students = _students(db, v)
        if len(live_slots(db, v, students)) < len(students):
            problems.append("allocate every student to an examiner")
    if problems:
        raise BadRequest("Before scheduling: " + "; ".join(problems) + ".")


def schedule(db: Session, viva_id: str, user: User) -> VivaOut:
    v = owned_viva(db, viva_id, user)
    if v.status == VivaStatus.scheduled:
        return _to_out(db, v)
    _check_ready(db, v)
    if v.starts_at <= utcnow():
        raise BadRequest("Before scheduling: pick a start time in the future.")
    v.status = VivaStatus.scheduled
    db.commit()
    return _to_out(db, v)


def unschedule(db: Session, viva_id: str, user: User) -> VivaOut:
    v = owned_viva(db, viva_id, user)
    ensure_editable(v)
    v.status = VivaStatus.draft
    db.commit()
    return _to_out(db, v)


def delete(db: Session, viva_id: str, user: User) -> None:
    v = owned_viva(db, viva_id, user)
    if phase(v) == "live":
        raise Conflict("This viva is running right now and can't be deleted.")
    for f in list(v.files) + [f for fb in v.feedback for f in fb.files]:
        files.remove(db, f)
    db.delete(v)
    db.commit()


def add_files(db: Session, viva_id: str, uploads: list[UploadFile], user: User) -> list[FileOut]:
    v = owned_viva(db, viva_id, user)
    ensure_editable(v)
    rows = [
        files.store(db, u, kind=FileKind.viva_instructions, class_id=v.class_id, uploader=user, viva_id=v.id)
        for u in uploads
    ]
    db.commit()
    return [files.to_out(r) for r in rows]


def stats(db: Session, viva_id: str, user: User) -> VivaStatsOut:
    """Class overview for the viva: readiness before it, and results from each finished session."""
    v = owned_viva(db, viva_id, user)
    students = _students(db, v)
    subs = submissions_by_student(db, v.assignment_id) if v.assignment else {}
    joined = {a.student_id: a.joined_at for a in v.attempts}
    feedback = {fb.student_id: _feedback_out(fb) for fb in v.feedback}
    slots = {s.student_id: s for s in live_slots(db, v, students)}
    sessions = {s.student_id: s for s in db.scalars(select(VivaSession).where(VivaSession.viva_id == v.id))}
    now = utcnow()

    def entry_closed(student_id: str) -> bool:
        if v.status != VivaStatus.scheduled:
            return False
        slot = slots.get(student_id)
        start = slot_starts_at(v, slot.position) if slot else v.starts_at
        return start is not None and now > start + timedelta(minutes=join_window_minutes())

    rows = []
    for s in students:
        sess = sessions.get(s.id)
        slot = slots.get(s.id)
        ended = sess is not None and sess.status == SessionStatus.ended
        rows.append(
            VivaStudentRow(
                student=s,
                resume_status=submission_status(subs.get(s.id), v.assignment.deadline)
                if v.assignment
                else "not_linked",
                viva_status="completed"
                if ended
                else "joined"
                if s.id in joined
                else "missed"
                if entry_closed(s.id)
                else "not_started",
                joined_at=joined.get(s.id),
                examiner=PersonOut.model_validate(slot.examiner) if slot else None,
                slot_starts_at=slot_starts_at(v, slot.position) if slot else None,
                session_id=sess.id if sess else None,
                session_status=sess.status.value if sess else None,
                score=sess.score if ended else None,
                risk_score=round(sess.risk_score, 1) if sess else None,
                mastery_score=round(sess.mastery_score, 1)
                if sess and sess.mastery_score is not None
                else None,
                flags=len(sess.events) if sess else 0,
                feedback=feedback.get(s.id),
            )
        )

    scores = [r.score for r in rows if r.score is not None]
    done = [
        s
        for s in sessions.values()
        if s.status == SessionStatus.ended and s.student_id in {p.id for p in students}
    ]
    per_criterion: dict[str, list[float]] = {}
    flag_counts: dict[str, int] = {}
    for sess in done:
        for c in sess.criteria_scores:
            if c.get("score") is not None:
                per_criterion.setdefault(c["name"], []).append(float(c["score"]))
    for sess in sessions.values():
        for e in sess.events:
            flag_counts[e.type] = flag_counts.get(e.type, 0) + 1

    return VivaStatsOut(
        viva_id=v.id,
        phase=phase(v),
        summary_stats=v.summary_stats,
        assigned_count=len(rows),
        resumes_ready=sum(r.resume_status in ("submitted", "late") for r in rows),
        joined_count=sum(r.viva_status in ("joined", "completed") for r in rows),
        missed_count=sum(r.viva_status == "missed" for r in rows),
        completed_count=sum(r.viva_status == "completed" for r in rows),
        join_window_minutes=join_window_minutes(),
        average_score=round(sum(scores) / len(scores), 1) if scores else None,
        criteria_averages=[
            CriterionAverage(name=name, average=round(sum(xs) / len(xs), 1))
            for name, xs in per_criterion.items()
        ],
        flag_counts=flag_counts,
        students=rows,
    )


def is_assigned(db: Session, v: Viva, user: User) -> bool:
    if v.audience == VivaAudience.whole_class:
        return is_member(db, v.class_id, user.id)
    return any(s.student_id == user.id for s in v.students)


def my_slot(db: Session, v: Viva, student_id: str) -> VivaSlot | None:
    return next((s for s in live_slots(db, v) if s.student_id == student_id), None)


def _entry_window(db: Session, v: Viva, user: User) -> tuple[datetime, datetime]:
    """When this student may open the viva: from their start (their slot, in staff vivas) for the join window."""
    start = v.starts_at
    if v.conducted_by == VivaConductor.staff:
        slot = my_slot(db, v, user.id)
        if slot is None:
            raise BadRequest("You haven't been given a time slot yet. Please contact your instructor.")
        start = slot_starts_at(v, slot.position)
    return start, start + timedelta(minutes=join_window_minutes())


def join(db: Session, viva_id: str, user: User) -> VivaJoinOut:
    """A student opens the viva. Strict: only from the start time until the join window closes."""
    v = db.get(Viva, viva_id)
    if v is None or v.status != VivaStatus.scheduled or not is_assigned(db, v, user):
        raise NotFound("Viva not found.")

    now = utcnow()
    attempt = db.scalar(
        select(VivaAttempt).where(VivaAttempt.viva_id == v.id, VivaAttempt.student_id == user.id)
    )
    if attempt is None:
        opens, closes = _entry_window(db, v, user)
        if now < opens:
            raise BadRequest("This viva hasn't started yet. Open it at your scheduled start time.")
        if now > closes:
            raise Forbidden(
                f"Entry closed: the viva had to be opened within {join_window_minutes()} minutes "
                "of the start time. You have been marked as not on time."
            )
        attempt = VivaAttempt(viva_id=v.id, student_id=user.id, joined_at=now)
        db.add(attempt)
        db.commit()

    ends = attempt.joined_at + timedelta(minutes=v.duration_minutes)
    if v.conducted_by == VivaConductor.staff:
        # The examiner decides when the interview is over.
        sess = db.scalar(
            select(VivaSession).where(VivaSession.viva_id == v.id, VivaSession.student_id == user.id)
        )
        if sess is not None and sess.status == SessionStatus.ended:
            raise Conflict("Your viva is over.")
    elif now >= ends:
        raise Conflict("Your viva time is over.")
    return VivaJoinOut(viva_id=v.id, joined_at=attempt.joined_at, ends_at=ends)


# ---------- Feedback / report per student ----------


def _feedback_out(fb: VivaFeedback) -> VivaFeedbackOut:
    return VivaFeedbackOut(
        feedback=fb.feedback, files=[files.to_out(f) for f in fb.files], released_at=fb.released_at
    )


def send_feedback(
    db: Session, viva_id: str, student_id: str, text: str, attachments: list[UploadFile], user: User
) -> VivaFeedbackOut:
    """Staff send (or update) a student's viva feedback / report. The student sees it right away.
    New attachments are added to the earlier ones."""
    v = owned_viva(db, viva_id, user)
    if v.status != VivaStatus.scheduled:
        raise BadRequest("Schedule the viva before sending feedback.")
    if student_id not in {s.id for s in _students(db, v)}:
        raise NotFound("That student isn't taking this viva.")
    fb = db.scalar(
        select(VivaFeedback).where(VivaFeedback.viva_id == v.id, VivaFeedback.student_id == student_id)
    )
    if fb is None:
        fb = VivaFeedback(viva_id=v.id, student_id=student_id)
        db.add(fb)
        db.flush()
    text = text.strip()[:20000]
    if not text and not attachments and not fb.files:
        raise BadRequest("Write feedback or attach a report before sending.")
    for upload in attachments:
        fb.files.append(
            files.store(
                db,
                upload,
                kind=FileKind.viva_feedback,
                class_id=v.class_id,
                uploader=user,
                viva_feedback_id=fb.id,
            )
        )
    fb.feedback = text
    fb.released_at = utcnow()
    db.commit()
    db.refresh(fb)
    return _feedback_out(fb)


# ---------- Student view ----------


def _student_status(
    v: Viva, attempt: VivaAttempt | None, start: datetime, sess: VivaSession | None
) -> tuple[str, datetime | None]:
    now = utcnow()
    if attempt:
        ends = attempt.joined_at + timedelta(minutes=v.duration_minutes)
        if v.conducted_by == VivaConductor.staff:
            # In progress until the examiner ends it (or the whole viva is long over).
            over = (sess is not None and sess.status == SessionStatus.ended) or (
                v.ends_at is not None and now > v.ends_at + timedelta(hours=1)
            )
            return ("attended" if over else "in_progress"), ends
        return ("in_progress" if now < ends else "attended"), ends
    if now < start:
        return "upcoming", None
    return ("open" if now <= start + timedelta(minutes=join_window_minutes()) else "missed"), None


def _student_viva_out(db: Session, v: Viva, user: User) -> StudentVivaOut:
    attempt = next((a for a in v.attempts if a.student_id == user.id), None)
    slot = my_slot(db, v, user.id) if v.conducted_by == VivaConductor.staff else None
    start = slot_starts_at(v, slot.position) if slot else v.starts_at
    sess = db.scalar(
        select(VivaSession).where(VivaSession.viva_id == v.id, VivaSession.student_id == user.id)
    )
    status, my_ends = _student_status(v, attempt, start, sess)
    fb = next((f for f in v.feedback if f.student_id == user.id and f.released_at), None)
    return StudentVivaOut(
        id=v.id,
        class_id=v.class_id,
        title=v.title,
        conducted_by=v.conducted_by,
        starts_at=start,
        join_closes_at=start + timedelta(minutes=join_window_minutes()),
        ends_at=v.ends_at,
        duration_minutes=v.duration_minutes,
        join_window_minutes=join_window_minutes(),
        my_status=status,
        joined_at=attempt.joined_at if attempt else None,
        my_ends_at=my_ends,
        examiner=PersonOut.model_validate(slot.examiner) if slot else None,
        session_id=sess.id if sess else None,
        feedback=_feedback_out(fb) if fb else None,
    )


def list_mine(db: Session, class_id: str, user: User) -> list[StudentVivaOut]:
    """Scheduled vivas this student takes in the class, soonest first. Drafts are hidden."""
    if not is_member(db, class_id, user.id):
        raise NotFound("Class not found.")
    rows = db.scalars(
        select(Viva)
        .where(Viva.class_id == class_id, Viva.status == VivaStatus.scheduled)
        .order_by(Viva.starts_at.desc())
    )
    return [_student_viva_out(db, v, user) for v in rows if is_assigned(db, v, user)]


def get_mine(db: Session, viva_id: str, user: User) -> StudentVivaOut:
    v = db.get(Viva, viva_id)
    if v is None or v.status != VivaStatus.scheduled or not is_assigned(db, v, user):
        raise NotFound("Viva not found.")
    return _student_viva_out(db, v, user)
