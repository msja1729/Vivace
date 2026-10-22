"""Set up a staff-run live viva to try out, starting a few minutes from now.

    uv run python -m scripts.seed_live_demo <JOIN_CODE> [minutes_from_now=3]

Uses the class with that join code (run scripts.seed_demo on it first for the demo students), adds a demo TA
(demo-ta@demo-school.edu), and schedules a new viva split evenly between the instructor and the TA.
The first student of each examiner starts at the start time. Run it again for a fresh viva.
"""

import sys
from datetime import timedelta

from sqlalchemy import select

from app.core.db import SessionLocal, utcnow
from app.core.errors import AppError
from app.models import ClassRoom, Role, VivaAudience
from app.schemas.viva import SlotIn, VivaCreateIn, VivaUpdateIn
from app.services import classes, users, vivas
from app.services.classes import list_members
from scripts.seed_demo import STUDENTS


def main(code: str, minutes: int) -> None:
    db = SessionLocal()
    try:
        cls = db.scalar(select(ClassRoom).where(ClassRoom.join_code == code.strip().upper()))
        if cls is None:
            sys.exit(f"No class with join code {code!r}.")
        owner = cls.instructor

        ta = users.get_or_create_user(db, "Demo TA", "demo-ta@demo-school.edu")
        if ta.role is None:
            users.set_role(db, ta, Role.instructor)
        try:
            classes.add_ta(db, cls.id, ta.id, owner)
        except AppError:
            pass  # already a TA

        students = sorted(list_members(db, cls.id), key=lambda m: m.user.name)
        if not students:
            sys.exit("The class has no students. Run scripts.seed_demo first.")

        start = (utcnow() + timedelta(minutes=minutes)).replace(second=0, microsecond=0)
        v = vivas.create(db, cls.id, VivaCreateIn(audience=VivaAudience.whole_class, title="Live viva demo"), owner)
        # Alternate: instructor, TA, instructor … so both queues start at the start time.
        examiners = [owner.id, ta.id]
        allocation = [SlotIn(student_id=m.user_id, examiner_id=examiners[i % 2]) for i, m in enumerate(students)]
        projects = "; ".join(f"{n}: {p} ({s})" for n, p, s in STUDENTS)
        vivas.update(
            db,
            v.id,
            VivaUpdateIn(
                title=f"Live viva demo {start.astimezone().strftime('%H:%M')}",
                assignment_id=v.assignment_id,
                starts_at=start,
                duration_minutes=10,
                break_minutes=2,
                examiner_ids=examiners,
                allocation=allocation,
                interview_instructions=(
                    "Start with the student's main project from their resume. Ask why they made key design "
                    "choices and what would break if one changed. Check one claimed skill with a concrete "
                    f"question. At most 2 follow-ups per topic. Projects: {projects}"
                ),
                evaluation_criteria=v.evaluation_criteria,
                report_format=v.report_format or "Score out of 10, strengths, gaps, next steps.",
                summary_stats=v.summary_stats,
            ),
            owner,
        )
        out = vivas.schedule(db, v.id, owner)
        print(f"Scheduled '{out.title}' in {cls.name} (starts {start.astimezone():%H:%M}, local time).")
        for s in sorted(out.slots, key=lambda s: (s.starts_at, s.examiner_id)):
            who = owner.name if s.examiner_id == owner.id else ta.name
            print(f"  {s.starts_at.astimezone():%H:%M}  {s.student.name:<12} {s.student.email:<26} with {who}")
    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3):
        sys.exit(__doc__)
    main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) == 3 else 3)
