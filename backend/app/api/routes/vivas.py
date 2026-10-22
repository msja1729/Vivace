from typing import Annotated

from fastapi import APIRouter, File, Form, UploadFile, status

from app.api.deps import DbSession, RegisteredUser
from app.schemas.file import FileOut
from app.schemas.viva import (
    StudentVivaOut,
    VivaCreateIn,
    VivaFeedbackOut,
    VivaJoinOut,
    VivaOut,
    VivaStatsOut,
    VivaSummaryOut,
    VivaUpdateIn,
)
from app.services import vivas

router = APIRouter(tags=["vivas"])


@router.post("/classes/{class_id}/vivas", response_model=VivaOut, status_code=status.HTTP_201_CREATED)
def create_viva(class_id: str, body: VivaCreateIn, user: RegisteredUser, db: DbSession):
    """Starts a draft for the whole class or for selected students."""
    return vivas.create(db, class_id, body, user)


@router.get("/classes/{class_id}/vivas", response_model=list[VivaSummaryOut])
def list_vivas(class_id: str, user: RegisteredUser, db: DbSession):
    return vivas.list_for_class(db, class_id, user)


@router.get("/vivas/{viva_id}", response_model=VivaOut)
def get_viva(viva_id: str, user: RegisteredUser, db: DbSession):
    return vivas.get(db, viva_id, user)


@router.put("/vivas/{viva_id}", response_model=VivaOut)
def update_viva(viva_id: str, body: VivaUpdateIn, user: RegisteredUser, db: DbSession):
    """Save the setup. Allowed until the viva starts."""
    return vivas.update(db, viva_id, body, user)


@router.post("/vivas/{viva_id}/schedule", response_model=VivaOut)
def schedule_viva(viva_id: str, user: RegisteredUser, db: DbSession):
    """Checks the setup is complete, then publishes the viva for its start time."""
    return vivas.schedule(db, viva_id, user)


@router.post("/vivas/{viva_id}/unschedule", response_model=VivaOut)
def unschedule_viva(viva_id: str, user: RegisteredUser, db: DbSession):
    return vivas.unschedule(db, viva_id, user)


@router.delete("/vivas/{viva_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_viva(viva_id: str, user: RegisteredUser, db: DbSession):
    vivas.delete(db, viva_id, user)


@router.post("/vivas/{viva_id}/files", response_model=list[FileOut], status_code=status.HTTP_201_CREATED)
def upload_viva_files(
    viva_id: str, files: Annotated[list[UploadFile], File()], user: RegisteredUser, db: DbSession
):
    """Instruction PDFs for the viva engine (how to interview, rubric, report template)."""
    return vivas.add_files(db, viva_id, files, user)


@router.get("/vivas/{viva_id}/stats", response_model=VivaStatsOut)
def viva_stats(viva_id: str, user: RegisteredUser, db: DbSession):
    return vivas.stats(db, viva_id, user)


@router.post("/vivas/{viva_id}/join", response_model=VivaJoinOut)
def join_viva(viva_id: str, user: RegisteredUser, db: DbSession):
    """Student opens the viva. Allowed only within the join window after the start time;
    reopening after joining is fine until their time is up."""
    return vivas.join(db, viva_id, user)


@router.put("/vivas/{viva_id}/students/{student_id}/feedback", response_model=VivaFeedbackOut)
def send_feedback(
    viva_id: str,
    student_id: str,
    user: RegisteredUser,
    db: DbSession,
    feedback: Annotated[str, Form()] = "",
    attachments: Annotated[list[UploadFile] | None, File()] = None,
):
    """Staff send a student's viva feedback / report, with optional files (multipart)."""
    return vivas.send_feedback(db, viva_id, student_id, feedback, attachments or [], user)


@router.get("/classes/{class_id}/my-vivas", response_model=list[StudentVivaOut])
def my_vivas(class_id: str, user: RegisteredUser, db: DbSession):
    """Student: scheduled vivas they take in this class, with their status and released feedback."""
    return vivas.list_mine(db, class_id, user)


@router.get("/vivas/{viva_id}/mine", response_model=StudentVivaOut)
def my_viva(viva_id: str, user: RegisteredUser, db: DbSession):
    return vivas.get_mine(db, viva_id, user)
