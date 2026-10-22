"""Saving uploaded files to local disk. Swap for S3-compatible storage in production."""

import uuid
from pathlib import Path

from fastapi import UploadFile

from app.core.config import get_settings
from app.core.errors import BadRequest

CHUNK = 1024 * 1024


def _root() -> Path:
    return Path(get_settings().upload_dir).resolve()


def path_for(key: str) -> Path:
    return _root() / key


def save_upload(upload: UploadFile, folder: str, allowed: set[str]) -> tuple[str, int]:
    """Check the extension and size, write the file, and return (storage key, size in bytes)."""
    name = upload.filename or "file"
    ext = Path(name).suffix.lower()
    if ext not in allowed:
        raise BadRequest(f"{name}: only {', '.join(sorted(allowed))} files are accepted.")

    limit = get_settings().max_upload_mb * 1024 * 1024
    key = f"{folder}/{uuid.uuid4().hex}{ext}"
    dest = path_for(key)
    dest.parent.mkdir(parents=True, exist_ok=True)

    size = 0
    with dest.open("wb") as out:
        while chunk := upload.file.read(CHUNK):
            size += len(chunk)
            if size > limit:
                out.close()
                dest.unlink(missing_ok=True)
                raise BadRequest(f"{name} is larger than {get_settings().max_upload_mb} MB.")
            out.write(chunk)
    if size == 0:
        dest.unlink(missing_ok=True)
        raise BadRequest(f"{name} is empty.")
    return key, size


def delete(key: str) -> None:
    path_for(key).unlink(missing_ok=True)
