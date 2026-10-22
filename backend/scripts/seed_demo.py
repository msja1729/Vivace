"""Fill a class with demo students and resume submissions, for trying out the instructor pages.

    uv run python -m scripts.seed_demo <JOIN_CODE>

Creates 8 demo students (demo1@demo-school.edu …), joins them to the class, makes sure the class has
a resume assignment, and uploads a resume, GitHub links and a Claude transcript for 6 of them.
Safe to run again: existing demo students are reused and their submissions replaced.
"""

import io
import sys
from datetime import timedelta

from fastapi import UploadFile
from sqlalchemy import select
from starlette.datastructures import Headers

from app.core.db import SessionLocal, utcnow
from app.core.errors import AppError
from app.models import Assignment, ClassRoom, Role
from app.schemas.assignment import AssignmentIn
from app.services import assignments, classes, users

STUDENTS = [
    ("Asha Rao", "Smart attendance system", "Flask, OpenCV, SQLite"),
    ("Ravi Kumar", "Stock price predictor", "PyTorch LSTM, FastAPI"),
    ("Meera Iyer", "Campus chatbot", "LangChain, ChromaDB, Next.js"),
    ("Kabir Shah", "Plant disease classifier", "TensorFlow, MobileNetV2"),
    ("Diya Menon", "Expense tracker app", "React Native, Firebase"),
    ("Arjun Nair", "Traffic sign detector", "YOLOv8, OpenCV"),
    ("Sara Thomas", "Movie recommender", "scikit-learn, Pandas"),
    ("Vikram Das", "Resume parser", "spaCy, pdfplumber"),
]
SUBMITTING = 6


def make_pdf(lines: list[str]) -> bytes:
    """A minimal one-page PDF with the given lines of text."""
    text = "BT /F1 12 Tf 60 760 Td 16 TL " + " ".join(
        f"({line.replace('(', '[').replace(')', ']')}) Tj T*" for line in lines
    )
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        "/Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(text) + 3} >>\nstream\n{text} ET\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(f"{i} 0 obj\n{body}\nendobj\n".encode())
    xref = out.tell()
    out.write(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for off in offsets:
        out.write(f"{off:010d} 00000 n \n".encode())
    out.write(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return out.getvalue()


def upload(name: str, data: bytes, content_type: str) -> UploadFile:
    return UploadFile(io.BytesIO(data), filename=name, headers=Headers({"content-type": content_type}))


def main(code: str) -> None:
    db = SessionLocal()
    try:
        cls = db.scalar(select(ClassRoom).where(ClassRoom.join_code == code.strip().upper()))
        if cls is None:
            sys.exit(f"No class with join code {code!r}.")

        assignment = db.scalar(
            select(Assignment).where(Assignment.class_id == cls.id).order_by(Assignment.created_at.desc())
        )
        if assignment is None:
            data = AssignmentIn(
                title="Resume & project submission",
                instructions="Upload your resume (PDF) with GitHub links, plus any Claude session transcripts.",
                deadline=utcnow() + timedelta(days=7),
            )
            assignments.create(db, cls.id, data, cls.instructor)
            assignment = db.scalar(select(Assignment).where(Assignment.class_id == cls.id))
            print(f"Created assignment: {assignment.title}")

        for i, (name, project, stack) in enumerate(STUDENTS, start=1):
            user = users.get_or_create_user(db, name, f"demo{i}@demo-school.edu")
            if user.role is None:
                users.set_role(db, user, Role.student)
            try:
                classes.join_class(db, cls.join_code, user)
            except AppError:
                pass  # already a member

            if i > SUBMITTING:
                continue
            slug = project.lower().replace(" ", "-")
            handle = name.split()[0].lower()
            resume = make_pdf(
                [
                    name,
                    f"demo{i}@demo-school.edu",
                    "",
                    "PROJECTS",
                    f"{project} - {stack}",
                    f"  github.com/{handle}/{slug}",
                    "College mini-project - REST API and dashboard",
                    "",
                    "SKILLS",
                    stack,
                ]
            )
            transcript = (
                f"# Claude session - {project}\n\n**User:** How should I structure the {stack.split(',')[0]} part?\n\n"
                "**Claude:** Start with a small module for data loading, then ...\n"
            ).encode()
            assignments.submit(
                db,
                assignment.id,
                user,
                uploads=[
                    upload(f"{handle}_resume.pdf", resume, "application/pdf"),
                    upload(f"{handle}_claude_session.md", transcript, "text/markdown"),
                ],
                keep_file_ids=[],
                github_links=f"https://github.com/{handle}/{slug}",
                note="",
            )
        print(
            f"Class {cls.name}: {len(STUDENTS)} demo students, {SUBMITTING} submissions for '{assignment.title}'."
        )
    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
