from datetime import datetime

from app.models.file import FileKind
from app.schemas.base import ApiModel


class FileOut(ApiModel):
    id: str
    name: str
    kind: FileKind
    content_type: str
    size_bytes: int
    created_at: datetime
    uploader_name: str
    # Where the file came from, e.g. "Resume collection · Asha Rao" or a viva title.
    context: str | None = None
