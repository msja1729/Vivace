"""Staff-run vivas around the live session: who may connect, examiner queues, results and reports."""

from datetime import timedelta
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import storage
from app.core.db import utcnow
from app.core.errors import BadRequest, Conflict, Forbidden, NotFound
from app.live import session as live_session
from app.live.evaluation import report as ai_report
from app.live.evaluation.llm import LLMError
from app.live.integrity.rules import LABELS, integrity_summary
from app.live.session import hub
from app.models import (
    ClassRoom,
    SessionStatus,
    User,
    Viva,
    VivaAttempt,
    VivaConductor,
    VivaEvent,
    VivaFeedback,
    VivaSession,
    VivaStatus,
)
from app.schemas.classroom import PersonOut
from app.schemas.live import (
    CriterionResult,
    EventOut,
    IntegritySummaryOut,
    QAOut,
    QueueOut,
    QueueRow,
    ReleaseIn,
    ResultIn,
    SessionReportOut,
    TurnOut,
)
from app.schemas.viva import Criterion
from app.services import vivas


def _staff_viva(db: Session, viva_id: str, user: User) -> Viva:
    v = vivas.owned_viva(db, viva_id, user)
    if v.conducted_by != VivaConductor.staff:
        raise BadRequest("This viva is run by the AI examiner.")
    return v


def _is_owner(db: Session, v: Viva, user: User) -> bool:
    return db.get(ClassRoom, v.class_id).instructor_id == user.id


def _get_or_create(db: Session, v: Viva, student_id: str) -> VivaSession:
    s = db.scalar(
        select(VivaSession).where(VivaSession.viva_id == v.id, VivaSession.student_id == student_id)
    )
    if s is None:
        slot = vivas.my_slot(db, v, student_id)
        s = VivaSession(viva_id=v.id, student_id=student_id, examiner_id=slot.examiner_id if slot else None)
        db.add(s)
        db.commit()
    return s


def connect(db: Session, viva_id: str, student_id: str, user: User) -> tuple[VivaSession, str]:
    """Checks who may open the live room. Returns (session, "student" | "examiner")."""
    v = db.get(Viva, viva_id)
    if v is None or v.status != VivaStatus.scheduled or v.conducted_by != VivaConductor.staff:
        raise NotFound("Viva not found.")
    if user.id == student_id:
        attempt = db.scalar(
            select(VivaAttempt).where(VivaAttempt.viva_id == v.id, VivaAttempt.student_id == user.id)
        )
        if attempt is None or not vivas.is_assigned(db, v, user):
            raise Forbidden("Join the viva first.")
        return _get_or_create(db, v, student_id), "student"

    vivas.owned_viva(db, viva_id, user)  # 404 unless staff
    slot = vivas.my_slot(db, v, student_id)
    if slot is None:
        raise NotFound("That student has no slot in this viva.")
    if slot.examiner_id != user.id and not _is_owner(db, v, user):
        raise Forbidden(f"{slot.examiner.name} is this student's examiner.")
    s = _get_or_create(db, v, student_id)
    s.examiner_id = user.id  # whoever actually runs the interview
    db.commit()
    return s, "examiner"


def queue(db: Session, viva_id: str, user: User) -> QueueOut:
    """The examiner's students in slot order. The class owner sees every examiner's queue."""
    v = _staff_viva(db, viva_id, user)
    owner = _is_owner(db, v, user)
    sessions = {s.student_id: s for s in db.scalars(select(VivaSession).where(VivaSession.viva_id == v.id))}
    joined = {a.student_id: a.joined_at for a in v.attempts}
    window = timedelta(minutes=vivas.join_window_minutes())
    now = utcnow()
    rows = []
    slots = sorted(vivas.live_slots(db, v), key=lambda s: (s.position, s.examiner.name))
    for slot in slots:
        if not owner and slot.examiner_id != user.id:
            continue
        start = vivas.slot_starts_at(v, slot.position)
        sess = sessions.get(slot.student_id)
        live = hub.get(sess.id) if sess else None
        rows.append(
            QueueRow(
                student=PersonOut.model_validate(slot.student),
                examiner=PersonOut.model_validate(slot.examiner),
                position=slot.position,
                starts_at=start,
                join_closes_at=start + window,
                joined_at=joined.get(slot.student_id),
                missed=slot.student_id not in joined
                and v.status == VivaStatus.scheduled
                and now > start + window,
                session_id=sess.id if sess else None,
                session_status=sess.status.value if sess else None,
                student_online=bool(live and live.student is not None),
                score=sess.score if sess else None,
            )
        )
    return QueueOut(
        viva_id=v.id,
        title=v.title,
        phase=vivas.phase(v),
        duration_minutes=v.duration_minutes,
        can_conduct_all=owner,
        rows=rows,
    )


def _session(db: Session, session_id: str, user: User) -> tuple[VivaSession, Viva]:
    s = db.get(VivaSession, session_id)
    if s is None:
        raise NotFound("Session not found.")
    return s, vivas.owned_viva(db, s.viva_id, user)


def _band(risk: float) -> str:
    return "low" if risk < 30 else "medium" if risk < 60 else "high"


def report(db: Session, session_id: str, user: User) -> SessionReportOut:
    s, v = _session(db, session_id, user)
    per: dict[str, list[float]] = {}
    for t in s.turns:
        for c in (t.analysis or {}).get("criteria", []):
            if c.get("tested"):
                per.setdefault(c["name"], []).append(float(c["score"]))
    criteria = [Criterion.model_validate(c) for c in v.evaluation_criteria]
    return SessionReportOut(
        id=s.id,
        viva_id=v.id,
        viva_title=v.title,
        class_id=v.class_id,
        student=PersonOut.model_validate(s.student),
        examiner=PersonOut.model_validate(s.examiner) if s.examiner else None,
        status=s.status.value,
        created_at=s.created_at,
        started_at=s.started_at,
        ended_at=s.ended_at,
        risk_score=round(s.risk_score, 1),
        risk_band=_band(s.risk_score),
        mastery_score=s.mastery_score,
        score=s.score,
        criteria_scores=[CriterionResult.model_validate(c) for c in s.criteria_scores],
        suggested_criteria_scores=[
            CriterionResult(
                name=c.name, score=round(sum(per[c.name]) / len(per[c.name]), 1) if per.get(c.name) else None
            )
            for c in criteria
        ],
        notes=s.notes,
        evaluation_criteria=criteria,
        report_format=v.report_format,
        calibrated=bool((s.calibration or {}).get("bounds")),
        events=[
            EventOut(
                id=e.id,
                type=e.type,
                label=LABELS.get(e.type, e.type),
                start_ts=e.start_ts,
                end_ts=e.end_ts,
                confidence=e.confidence,
                detail=e.detail,
                has_snapshot=bool(e.snapshot_key),
            )
            for e in s.events
        ],
        turns=[
            TurnOut(
                id=t.id,
                speaker=t.speaker.value,
                text=t.text,
                start_ts=t.start_ts,
                end_ts=t.end_ts,
                analysis=t.analysis,
            )
            for t in s.turns
        ],
        qa=[QAOut(**p) for p in ai_report.qa_pairs(s.turns)],
        integrity=IntegritySummaryOut(
            **integrity_summary(
                [(e.type, e.start_ts, e.end_ts) for e in s.events],
                s.risk_score,
                s.proctor_frames,
                s.face_frames,
            )
        ),
        ai_report=s.ai_report,
        sent_to_student=vivas._feedback_out(fb) if (fb := _feedback(db, s)) and fb.released_at else None,
    )


def _feedback(db: Session, s: VivaSession) -> VivaFeedback | None:
    return db.scalar(
        select(VivaFeedback).where(VivaFeedback.viva_id == s.viva_id, VivaFeedback.student_id == s.student_id)
    )


async def write_ai_report(db: Session, session_id: str, user: User) -> SessionReportOut:
    """(Re)write the AI's report for a finished interview."""
    s, _ = _session(db, session_id, user)
    if s.status != SessionStatus.ended:
        raise Conflict("End the interview before writing the report.")
    llm = live_session.get_llm()
    if llm is None:
        raise BadRequest(live_session.llm_error() or "The AI isn't available.")
    try:
        await ai_report.generate(s.id, live_session.db_factory, llm)
    except (LLMError, ValueError) as exc:
        raise BadRequest(str(exc)) from exc
    db.expire_all()
    return report(db, session_id, user)


def send_to_student(db: Session, session_id: str, data: ReleaseIn, user: User) -> SessionReportOut:
    """Send the student their marks (with the per-criterion breakdown), the AI's report and / or a
    message. Copies are kept, so later edits don't change what was sent; sending again updates it."""
    s, v = _session(db, session_id, user)
    if s.status != SessionStatus.ended:
        raise Conflict("End the interview before sending anything to the student.")
    if data.include_marks and s.score is None:
        raise BadRequest("Save the marks (Result) before sending them.")
    if data.include_ai_report and not s.ai_report:
        raise BadRequest("There is no AI report yet: write it first.")
    message = data.message.strip()
    if not (data.include_marks or data.include_ai_report or message):
        raise BadRequest("Choose what to send.")
    fb = _feedback(db, s)
    if fb is None:
        fb = VivaFeedback(viva_id=v.id, student_id=s.student_id)
        db.add(fb)
    weights = {c["name"]: c.get("weight") for c in v.evaluation_criteria}
    fb.marks = (
        {
            "score": s.score,
            "outOf": 10,
            "criteria": [
                {"name": c["name"], "weight": weights.get(c["name"]), "score": c.get("score")}
                for c in s.criteria_scores
            ],
        }
        if data.include_marks
        else None
    )
    fb.ai_report = s.ai_report if data.include_ai_report else None
    fb.feedback = message
    fb.released_at = utcnow()
    db.commit()
    return report(db, session_id, user)


async def end(db: Session, session_id: str, user: User) -> SessionReportOut:
    """End the interview (the dashboard normally does this over the WebSocket)."""
    s, v = _session(db, session_id, user)
    if s.status == SessionStatus.ended:
        return report(db, session_id, user)
    live = hub.get(s.id)
    if live is not None:
        await live.end_interview()
        db.expire_all()
    else:
        s.status, s.ended_at = SessionStatus.ended, utcnow()
        db.commit()
    return report(db, session_id, user)


def save_result(db: Session, session_id: str, data: ResultIn, user: User) -> SessionReportOut:
    s, v = _session(db, session_id, user)
    if s.status != SessionStatus.ended:
        raise Conflict("End the interview before saving the result.")
    names = {c["name"] for c in v.evaluation_criteria}
    if any(c.name not in names for c in data.criteria_scores):
        raise BadRequest("Scores must be for this viva's evaluation criteria.")
    s.score = round(data.score, 1)
    s.criteria_scores = [c.model_dump() for c in data.criteria_scores]
    s.notes = data.notes.strip()
    db.commit()
    return report(db, session_id, user)


def snapshot(db: Session, session_id: str, event_id: int, user: User) -> Path:
    _session(db, session_id, user)
    e = db.get(VivaEvent, event_id)
    if e is None or e.session_id != session_id or not e.snapshot_key:
        raise NotFound("Snapshot not found.")
    path = storage.path_for(e.snapshot_key)
    if not path.exists():
        raise NotFound("Snapshot was deleted (retention period).")
    return path


def purge_old_snapshots(db: Session, days: int) -> int:
    """Delete integrity snapshots older than the retention period. Returns how many were removed."""
    if days <= 0:
        return 0
    cutoff = utcnow() - timedelta(days=days)
    rows = db.scalars(
        select(VivaEvent)
        .join(VivaSession, VivaSession.id == VivaEvent.session_id)
        .where(VivaEvent.snapshot_key.is_not(None), VivaSession.ended_at < cutoff)
    )
    n = 0
    for e in rows:
        storage.delete(e.snapshot_key)
        e.snapshot_key = None
        n += 1
    db.commit()
    return n
