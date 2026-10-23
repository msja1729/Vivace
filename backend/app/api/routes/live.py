"""Staff-run live vivas: the live room WebSocket, examiner queues, results and per-student reports."""

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse

from app.api.deps import DbSession, RegisteredUser
from app.core.errors import AppError
from app.core.security import decode_access_token
from app.live import session as live_session
from app.live.engines import status as engine_status
from app.live.integrity import audio, deepgram
from app.live.session import hub
from app.models import User
from app.schemas.live import QueueOut, ReleaseIn, ResultIn, SessionReportOut
from app.services import live

router = APIRouter(tags=["live vivas"])
log = logging.getLogger("live.ws")


@router.get("/vivas/{viva_id}/queue", response_model=QueueOut)
def examiner_queue(viva_id: str, user: RegisteredUser, db: DbSession):
    """Staff: my students in slot order (the class owner sees every examiner's queue)."""
    return live.queue(db, viva_id, user)


@router.get("/viva-sessions/{session_id}", response_model=SessionReportOut)
def session_report(session_id: str, user: RegisteredUser, db: DbSession):
    """Staff: one student's session: scores, integrity flags, graded answers and transcript."""
    return live.report(db, session_id, user)


@router.post("/viva-sessions/{session_id}/end", response_model=SessionReportOut)
async def end_session(session_id: str, user: RegisteredUser, db: DbSession):
    return await live.end(db, session_id, user)


@router.put("/viva-sessions/{session_id}/result", response_model=SessionReportOut)
def save_result(session_id: str, body: ResultIn, user: RegisteredUser, db: DbSession):
    """The examiner's final score (out of 10), per-criterion scores and notes."""
    return live.save_result(db, session_id, body, user)


@router.post("/viva-sessions/{session_id}/ai-report", response_model=SessionReportOut)
async def write_ai_report(session_id: str, user: RegisteredUser, db: DbSession):
    """(Re)write the AI's report for a finished interview."""
    return await live.write_ai_report(db, session_id, user)


@router.post("/viva-sessions/{session_id}/send", response_model=SessionReportOut)
def send_to_student(session_id: str, body: ReleaseIn, user: RegisteredUser, db: DbSession):
    """Send the student their marks, the AI's report and / or a message."""
    return live.send_to_student(db, session_id, body, user)


@router.get("/viva-sessions/{session_id}/events/{event_id}/snapshot")
def event_snapshot(session_id: str, event_id: int, user: RegisteredUser, db: DbSession):
    return FileResponse(live.snapshot(db, session_id, event_id, user), media_type="image/jpeg")


@router.get("/live/engines")
def engines(user: RegisteredUser):
    """Which detectors and models are loaded on this server."""
    return engine_status()


TEST_SECONDS = 600  # one transcription test may run at most 10 minutes


@router.websocket("/ws/stt-test")
async def stt_test(ws: WebSocket, token: str = ""):
    """Live transcription test (mic test page): exactly the viva's speech-to-text path. The browser sends
    16 kHz PCM like in a viva (byte 0x02 + PCM); each speech segment the viva's pause detector cuts out
    is transcribed by the viva's transcriber, with any key terms from a {"type": "keyterms"} message.
    Signed-in users only, as it uses the Deepgram account."""
    user_id = decode_access_token(token)
    db = live_session.db_factory()
    try:
        user = db.get(User, user_id) if user_id else None
    finally:
        db.close()
    # Accept first, then close: a close before accepting reaches the browser only as "couldn't connect".
    await ws.accept()
    if user is None or user.role is None:
        await ws.close(code=4401, reason="Your login has expired. Log in again.")
        return
    segmenter = audio.Segmenter()
    keyterms: tuple[str, ...] = ()
    loop = asyncio.get_running_loop()
    t0 = loop.time()
    speaking = None

    async def transcribe(seg: audio.Segment) -> None:
        started = loop.time()
        result = await loop.run_in_executor(live_session.STT_POOL, audio.transcribe, seg.pcm, keyterms)
        await ws.send_json(
            {
                "type": "text",
                "text": result.text if result else "",
                "engine": result.engine if result else "none",
                "start": round(seg.start, 2),
                "end": round(seg.end, 2),
                "ms": round((loop.time() - started) * 1000),
            }
        )

    try:
        while loop.time() - t0 < TEST_SECONDS:
            message = await ws.receive()
            if message["type"] == "websocket.disconnect":
                return
            if message.get("text") is not None:
                try:
                    msg = json.loads(message["text"])
                except json.JSONDecodeError:
                    continue
                if msg.get("type") == "keyterms":
                    raw = msg.get("terms") or []
                    keyterms = tuple(str(t).strip()[:60] for t in raw if str(t).strip())[
                        : deepgram.MAX_KEYTERMS
                    ]
                continue
            data = message.get("bytes")
            if not data or data[0] != live_session.AUDIO:
                continue
            segments, _ = segmenter.feed(data[1:], loop.time() - t0)
            if segmenter.speaking != speaking:
                speaking = segmenter.speaking
                await ws.send_json({"type": "speaking", "speaking": speaking})
            for seg in segments:
                asyncio.create_task(transcribe(seg))
        await ws.close(code=4408, reason="Test time is up (10 minutes). Start again to continue.")
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        log.exception("Transcription test error")


@router.websocket("/ws/vivas/{viva_id}/students/{student_id}")
async def live_room(ws: WebSocket, viva_id: str, student_id: str, token: str = ""):
    """The live room. The student and their examiner both connect here (`?token=` = login token).
    Text frames are JSON messages; binary frames are media (see app/live/session.py)."""
    # Browsers can't set headers on WebSockets, so the token comes in the query string.
    db = live_session.db_factory()
    try:
        user_id = decode_access_token(token)
        user = db.get(User, user_id) if user_id else None
        if user is None or user.role is None:
            await ws.close(code=4401, reason="Not signed in.")
            return
        try:
            row, role = live.connect(db, viva_id, student_id, user)
        except AppError as exc:
            await ws.close(code=4403, reason=exc.message[:120])
            return
        session_id = row.id
    finally:
        db.close()

    await ws.accept()
    room = hub.open(session_id)
    other = "examiner" if role == "student" else "student"
    previous = getattr(room, role)
    if previous is not None:  # opened in a second tab: the newest connection wins
        await previous.close(code=4409, reason="Opened somewhere else.")
    setattr(room, role, ws)
    await room.send(role, room.snapshot_state(role))
    await room.send(other, {"type": "presence", role: True})
    if role == "examiner":
        asyncio.create_task(room.ensure_topics())

    try:
        while True:
            message = await ws.receive()
            if message["type"] == "websocket.disconnect":
                break
            if message.get("bytes") is not None:
                await room.on_binary(role, message["bytes"])
            elif message.get("text") is not None:
                try:
                    await room.on_text(role, json.loads(message["text"]))
                except json.JSONDecodeError:
                    continue
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        log.exception("Live room error")
    finally:
        if getattr(room, role) is ws:
            setattr(room, role, None)
            await room.send(other, {"type": "presence", role: False})
        hub.release(room)
