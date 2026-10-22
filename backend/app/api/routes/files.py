from typing import Annotated

from fastapi import APIRouter, File, UploadFile, status
from fastapi.responses import FileResponse

from app.api.deps import DbSession, RegisteredUser
from app.core import storage
from app.core.errors import NotFound
from app.schemas.file import FileOut
from app.services import files
from app.services.classes import get_managed_class

router = APIRouter(tags=["files"])


@router.get("/classes/{class_id}/files", response_model=list[FileOut])
def list_files(class_id: str, user: RegisteredUser, db: DbSession):
    """Staff: every file in the class. Students: only the material the instructor shared."""
    return files.list_class_files(db, class_id, user)


@router.post("/classes/{class_id}/files", response_model=list[FileOut], status_code=status.HTTP_201_CREATED)
def upload_material(
    class_id: str,
    uploads: Annotated[list[UploadFile], File(alias="files")],
    user: RegisteredUser,
    db: DbSession,
):
    return files.add_material(db, get_managed_class(db, class_id, user), uploads, user)


@router.get("/files/{file_id}/download")
def download(file_id: str, user: RegisteredUser, db: DbSession):
    row = files.get_for_download(db, file_id, user)
    path = storage.path_for(row.storage_key)
    if not path.exists():
        raise NotFound("The file is missing from storage.")
    return FileResponse(path, media_type=row.content_type, filename=row.name)


@router.delete("/files/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_file(file_id: str, user: RegisteredUser, db: DbSession):
    files.delete_file(db, file_id, user)
