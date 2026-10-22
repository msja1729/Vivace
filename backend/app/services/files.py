from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import storage
from app.core.errors import Forbidden, NotFound
from app.models import Assignment, ClassRoom, FileKind, StoredFile, Submission, User, Viva, VivaFeedback
from app.schemas.file import FileOut
from app.services.classes import get_managed_class, role_in

ALLOWED_EXTENSIONS: dict[FileKind, set[str]] = {
    FileKind.submission: {
        ".pdf",
        ".doc",
        ".docx",
        ".ppt",
        ".pptx",
        ".xls",
        ".xlsx",
        ".csv",
        ".txt",
        ".md",
        ".json",
        ".html",
        ".ipynb",
        ".py",
        ".zip",
        ".png",
        ".jpg",
        ".jpeg",
    },
    FileKind.resume: {".pdf"},
    FileKind.transcript: {".txt", ".md", ".json", ".pdf", ".html"},
    FileKind.viva_instructions: {".pdf", ".txt", ".md", ".docx"},
    FileKind.material: {".pdf", ".txt", ".md", ".docx", ".pptx"},
    FileKind.feedback: {".pdf", ".docx", ".txt", ".md", ".png", ".jpg", ".jpeg"},
    FileKind.viva_feedback: {".pdf", ".docx", ".txt", ".md", ".png", ".jpg", ".jpeg"},
}
# Kinds uploaded by staff, which staff may delete. Student uploads stay as handed in.
STAFF_KINDS = {FileKind.material, FileKind.viva_instructions, FileKind.feedback, FileKind.viva_feedback}


def store(
    db: Session,
    upload: UploadFile,
    *,
    kind: FileKind,
    class_id: str,
    uploader: User,
    submission_id: str | None = None,
    viva_id: str | None = None,
    viva_feedback_id: int | None = None,
) -> StoredFile:
    """Save the upload to disk and add its row to the session (the caller commits)."""
    key, size = storage.save_upload(upload, f"{class_id}/{kind.value}", ALLOWED_EXTENSIONS[kind])
    row = StoredFile(
        class_id=class_id,
        uploader_id=uploader.id,
        kind=kind,
        name=(upload.filename or "file")[:255],
        content_type=upload.content_type or "application/octet-stream",
        size_bytes=size,
        storage_key=key,
        submission_id=submission_id,
        viva_id=viva_id,
        viva_feedback_id=viva_feedback_id,
    )
    db.add(row)
    return row


def remove(db: Session, row: StoredFile) -> None:
    """Delete the row and the bytes on disk (the caller commits)."""
    storage.delete(row.storage_key)
    db.delete(row)


def to_out(row: StoredFile, context: str | None = None) -> FileOut:
    return FileOut(
        id=row.id,
        name=row.name,
        kind=row.kind,
        content_type=row.content_type,
        size_bytes=row.size_bytes,
        created_at=row.created_at,
        uploader_name=row.uploader.name,
        context=context,
    )


def list_class_files(db: Session, class_id: str, user: User) -> list[FileOut]:
    """Staff see every file in the class. Students see only the files the instructor shared."""
    cls = db.get(ClassRoom, class_id)
    role = role_in(db, cls, user) if cls else None
    if role is None:
        raise NotFound("Class not found.")
    query = select(StoredFile).where(StoredFile.class_id == cls.id).order_by(StoredFile.created_at.desc())
    if role == "student":
        query = query.where(StoredFile.kind == FileKind.material)
    rows = list(db.scalars(query))
    # Label each file with the assignment/student or viva it belongs to.
    submissions = {
        s.id: s
        for s in db.scalars(
            select(Submission).where(Submission.id.in_({r.submission_id for r in rows if r.submission_id}))
        )
    }
    assignments = {
        a.id: a.title
        for a in db.scalars(
            select(Assignment).where(Assignment.id.in_({s.assignment_id for s in submissions.values()}))
        )
    }
    feedback = {
        f.id: f
        for f in db.scalars(
            select(VivaFeedback).where(
                VivaFeedback.id.in_({r.viva_feedback_id for r in rows if r.viva_feedback_id})
            )
        )
    }
    viva_ids = {r.viva_id for r in rows if r.viva_id} | {f.viva_id for f in feedback.values()}
    vivas = {v.id: v.title for v in db.scalars(select(Viva).where(Viva.id.in_(viva_ids)))}
    names = {
        u.id: u.name
        for u in db.scalars(select(User).where(User.id.in_({f.student_id for f in feedback.values()})))
    }

    def context(r: StoredFile) -> str | None:
        if r.submission_id and (s := submissions.get(r.submission_id)):
            return f"{assignments.get(s.assignment_id, 'Assignment')} · {s.student.name}"
        if r.viva_feedback_id and (f := feedback.get(r.viva_feedback_id)):
            return f"{vivas.get(f.viva_id, 'Viva')} · {names.get(f.student_id, '')}"
        if r.viva_id:
            return vivas.get(r.viva_id)
        return None

    return [to_out(r, context(r)) for r in rows]


def add_material(db: Session, cls: ClassRoom, uploads: list[UploadFile], user: User) -> list[FileOut]:
    rows = [store(db, u, kind=FileKind.material, class_id=cls.id, uploader=user) for u in uploads]
    db.commit()
    return [to_out(r) for r in rows]


def _student_can_open(db: Session, row: StoredFile, user: User) -> bool:
    if row.kind == FileKind.material:
        return True
    if row.kind == FileKind.feedback and row.submission_id:
        sub = db.get(Submission, row.submission_id)
        return bool(sub and sub.student_id == user.id and sub.returned_at)
    if row.kind == FileKind.viva_feedback and row.viva_feedback_id:
        fb = db.get(VivaFeedback, row.viva_feedback_id)
        return bool(fb and fb.student_id == user.id and fb.released_at)
    return False


def get_for_download(db: Session, file_id: str, user: User) -> StoredFile:
    """Staff (instructor and TAs) can open every file in the class. Students can open their own uploads,
    shared class material, and feedback files returned to them. Everyone else gets 404."""
    row = db.get(StoredFile, file_id)
    if row is None:
        raise NotFound("File not found.")
    if row.uploader_id == user.id:
        return row
    cls = db.get(ClassRoom, row.class_id)
    role = role_in(db, cls, user) if cls else None
    if role in ("owner", "ta") or (role == "student" and _student_can_open(db, row, user)):
        return row
    raise NotFound("File not found.")


def delete_file(db: Session, file_id: str, user: User) -> None:
    """Class staff may delete instructor uploads. Student submissions stay as handed in."""
    row = db.get(StoredFile, file_id)
    if row is None:
        raise NotFound("File not found.")
    get_managed_class(db, row.class_id, user)  # 404 unless staff
    if row.kind not in STAFF_KINDS:
        raise Forbidden("Student submissions can't be deleted.")
    if row.viva_id:
        from app.services.vivas import ensure_editable  # avoid an import cycle

        ensure_editable(db.get(Viva, row.viva_id))
    remove(db, row)
    db.commit()
