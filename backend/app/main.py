"""FastAPI entry point. Run with:  uv run uvicorn app.main:app --reload"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import assignments, auth, classes, files, health, live, vivas
from app.core.config import get_settings
from app.core.errors import AppError

settings = get_settings()
logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_: FastAPI):
    from app.core.db import SessionLocal
    from app.services.live import purge_old_snapshots

    with SessionLocal() as db:
        purge_old_snapshots(db, settings.snapshot_retention_days)
    if settings.live_warm_up:
        # Load the vision / speech models in the background so the first live viva doesn't wait.
        from app.live.session import warm_up

        warm_up()
    yield


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(AppError)
async def app_error_handler(_: Request, exc: AppError) -> JSONResponse:
    # Same shape as FastAPI's own errors: {"detail": "..."}
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})


for module in (health, auth, classes, assignments, vivas, live, files):
    app.include_router(module.router, prefix="/api")
