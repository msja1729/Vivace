"""One live viva session at run time: the student's and examiner's connections, and both pipelines.

Video/audio for the conversation itself go browser-to-browser (WebRTC); this server only relays the
WebRTC handshake. In parallel the student's browser sends 5 fps JPEG frames and 16 kHz audio here, and
the examiner's browser sends its audio, for analysis:

  frames ─► vision (face mesh, YOLO) ─► IntegrityMonitor ─► flags + snapshots ─┐
  audio  ─► VAD segments ─► speech-to-text ─► transcript turns ─► Grader ───────┼─► examiner dashboard
                         └► voice print check ─► flags ─────────────────────────┘     (every second)

Binary messages start with one byte: 0x01 = JPEG frame (student only), 0x02 = PCM audio chunk."""

import asyncio
import json
import logging
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from fastapi import WebSocket
from sqlalchemy.orm import Session

from app.core import storage
from app.core.db import SessionLocal, utcnow
from app.live.config import live_config
from app.live.engines import status as engine_status
from app.live.evaluation import agents, metrics
from app.live.evaluation import context as ctx
from app.live.evaluation.llm import LLMError, get_llm, llm_error
from app.live.integrity import audio
from app.live.integrity.rules import LABELS, Change, Flag, IntegrityMonitor
from app.live.integrity.vision import FrameObs, analyze
from app.models import SessionStatus, Speaker, Viva, VivaEvent, VivaSession, VivaTurn

log = logging.getLogger("live.session")

# Shared worker threads. Vision models are per thread; speech-to-text runs in order on one thread.
VISION_POOL = ThreadPoolExecutor(max_workers=3, thread_name_prefix="vision")
STT_POOL = ThreadPoolExecutor(max_workers=1, thread_name_prefix="stt")
MISC_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="live-misc")

FRAME, AUDIO = 0x01, 0x02

# Tests swap this for their in-memory database.
db_factory = SessionLocal


def warm_up() -> None:
    """Load the models on the worker threads that will use them, so the first session doesn't stall."""
    from app.live import engines

    for _ in range(VISION_POOL._max_workers):
        VISION_POOL.submit(engines.warm_vision)
    STT_POOL.submit(engines.whisper)
    MISC_POOL.submit(engines.embedder)
    MISC_POOL.submit(engines.speaker_encoder)
    engines.vad()


@dataclass
class _Answer:
    """Student speech since the examiner's last question."""

    question: str = ""
    question_end: float | None = None
    turn_ids: list[int] = field(default_factory=list)
    texts: list[str] = field(default_factory=list)
    start: float | None = None
    speech_seconds: float = 0.0
    gaps: list[float] = field(default_factory=list)
    last_word_end: float | None = None


class LiveSession:
    def __init__(self, session_id: str):
        self.id = session_id
        self.cfg = live_config()
        self.student: WebSocket | None = None
        self.examiner: WebSocket | None = None
        self.monitor: IntegrityMonitor
        self.segmenters = {Speaker.student: audio.Segmenter(), Speaker.examiner: audio.Segmenter()}
        self.voiceprint = None
        self._enroll_pcm: list[bytes] = []
        self._voice_step = False
        self.state: agents.ExamState | None = None
        self.suggestions: list[dict] = []
        self.suggestions_error: str | None = None
        self.last_grade: agents.Grade | None = None
        self.answer = _Answer()
        self.risk = 0.0
        self.mastery: float | None = None
        self.last_obs: FrameObs | None = None
        self._frame: tuple[float, bytes] | None = None
        self._frame_ready = asyncio.Event()
        self._stt_queue: asyncio.Queue = asyncio.Queue()
        self._tasks: list[asyncio.Task] = []
        self._frames_done: list[float] = []
        self._examiner_speaking_until = 0.0
        self._suggesting = False
        self._load()

    # ---------- setup ----------

    def _load(self) -> None:
        with db_factory() as db:
            s = self._row(db)
            viva = db.get(Viva, s.viva_id)
            self.viva_id, self.student_id, self.class_id = s.viva_id, s.student_id, viva.class_id
            self.t0 = s.created_at.timestamp()
            self.status = s.status
            cal = s.calibration or {}
            self.monitor = IntegrityMonitor(self.cfg, cal.get("bounds"))
            if cal.get("voiceprint"):
                import numpy as np

                self.voiceprint = np.asarray(cal["voiceprint"], dtype="float32")
            # After a server restart: earlier flags still count towards the risk score.
            for e in s.events:
                self.monitor.flags.append(
                    Flag(e.type, e.start_ts, e.end_ts, e.confidence, e.detail, closed=True, id=e.id)
                )
            self.risk = s.risk_score
            self.mastery = s.mastery_score
            self.monitor.peak_risk = s.risk_score
            self._brief = {
                "title": viva.title,
                "instructions": viva.interview_instructions,
                "criteria": viva.evaluation_criteria,
                "transcript": [(t.speaker.value, t.text) for t in s.turns],
            }

    def _row(self, db: Session) -> VivaSession:
        return db.get(VivaSession, self.id)

    def t(self) -> float:
        return round(time.time() - self.t0, 2)

    def start_tasks(self) -> None:
        if self._tasks:
            return
        loop = asyncio.get_running_loop()
        self._tasks = [
            loop.create_task(self._frame_worker()),
            loop.create_task(self._stt_worker()),
            loop.create_task(self._ticker()),
            loop.create_task(self._build_context()),
        ]

    def stop_tasks(self) -> None:
        for task in self._tasks:
            task.cancel()
        self._tasks = []

    async def _build_context(self) -> None:
        def build():
            with db_factory() as db:
                return ctx.build(db, db.get(Viva, self.viva_id), self.student_id)

        try:
            context = await asyncio.get_running_loop().run_in_executor(MISC_POOL, build)
        except Exception:  # noqa: BLE001
            log.exception("Building the viva context failed")
            context = ctx.Context("(Couldn't read the student's submission.)", [])
        self.state = agents.ExamState(context=context, **self._brief)
        if self.examiner is not None and not self.suggestions:
            asyncio.create_task(self.refresh_suggestions())

    # ---------- messaging ----------

    async def send(self, who: str, message: dict) -> None:
        ws = self.student if who == "student" else self.examiner
        if ws is None:
            return
        try:
            await ws.send_text(json.dumps(message, default=str))
        except Exception:  # noqa: BLE001 — a dropped socket is cleaned up by its own handler
            pass

    async def to_examiner(self, message: dict) -> None:
        await self.send("examiner", message)

    def snapshot_state(self, who: str) -> dict:
        with db_factory() as db:
            s = self._row(db)
            base = {
                "type": "state",
                "sessionId": self.id,
                "status": s.status.value,
                "startedAt": s.started_at,
                "calibrated": bool((s.calibration or {}).get("bounds")),
                "voiceEnrolled": self.voiceprint is not None,
            }
            if who == "student":
                return base | {"examinerOnline": self.examiner is not None}
            return base | {
                "studentOnline": self.student is not None,
                "t": self.t(),
                "risk": self.risk,
                "mastery": self.mastery,
                "engines": engine_status(),
                "llm": llm_error() or ("ready" if get_llm() else "unavailable"),
                "events": [_event_out(e) for e in s.events],
                "turns": [_turn_out(t) for t in s.turns],
                "suggestions": self.suggestions,
                "suggestionsError": self.suggestions_error,
            }

    async def on_text(self, who: str, msg: dict) -> None:
        kind = msg.get("type")
        if kind == "signal":
            # WebRTC offer/answer/ICE candidates: pass to the other side unchanged.
            await self.send(
                "examiner" if who == "student" else "student", {"type": "signal", "data": msg.get("data")}
            )
        elif who == "student" and kind == "calibration":
            await self._calibration(msg.get("step"))
        elif who == "examiner":
            if kind == "start":
                await self.start_interview()
            elif kind == "end":
                await self.end_interview()
            elif kind == "show_question":
                await self._show_question(str(msg.get("text", ""))[:1000])
            elif kind == "suggest":
                asyncio.create_task(self.refresh_suggestions())
            elif kind == "grade_now":
                asyncio.create_task(self._grade(self._take_answer()))

    async def on_binary(self, who: str, data: bytes) -> None:
        if not data:
            return
        tag, payload = data[0], data[1:]
        if tag == FRAME and who == "student":
            self._frame = (self.t(), payload)
            self._frame_ready.set()
        elif tag == AUDIO:
            await self._audio(Speaker.student if who == "student" else Speaker.examiner, payload)

    # ---------- interview lifecycle ----------

    async def start_interview(self) -> None:
        if self.status != SessionStatus.waiting:
            return
        with db_factory() as db:
            s = self._row(db)
            s.status, s.started_at = SessionStatus.live, utcnow()
            db.commit()
        self.status = SessionStatus.live
        for who in ("student", "examiner"):
            await self.send(who, self.snapshot_state(who))

    async def end_interview(self) -> None:
        if self.status == SessionStatus.ended:
            return
        # Whatever happens to the last flag or answer, the interview must still end.
        try:
            await self._apply(self.monitor.close_all(self.t()))
            await self._grade(self._take_answer())
        except Exception:  # noqa: BLE001
            log.exception("Wrapping up the session failed")
        with db_factory() as db:
            s = self._row(db)
            s.status, s.ended_at = SessionStatus.ended, utcnow()
            s.risk_score = self.monitor.peak_risk
            s.mastery_score = self.mastery
            db.commit()
        self.status = SessionStatus.ended
        await self.send("student", {"type": "ended"})
        await self.to_examiner(self.snapshot_state("examiner"))

    async def _show_question(self, text: str) -> None:
        if not text.strip():
            return
        await self.send("student", {"type": "question", "text": text})
        # Reading the question on screen looks like reading notes: give them time (~3 words a second).
        self.monitor.pause_reading(self.t() + 4 + len(text.split()) / 3)
        # Typed questions go in the transcript too (spoken ones arrive through speech-to-text).
        await self._add_turn(Speaker.examiner, text, self.t(), self.t(), typed=True)

    # ---------- calibration ----------

    async def _calibration(self, step: str | None) -> None:
        if step == "corners_start":
            self.monitor.start_calibration()
        elif step == "corners_done":
            bounds = self.monitor.finish_calibration()
            self._save_calibration(bounds=bounds)
            await self.send("student", {"type": "calibration", "step": "corners_done", "bounds": bounds})
        elif step == "voice_start":
            self._voice_step, self._enroll_pcm = True, []
        elif step == "voice_done":
            self._voice_step = False
            ok = await self._enroll(b"".join(self._enroll_pcm))
            await self.send("student", {"type": "calibration", "step": "voice_done", "ok": ok})
        await self.to_examiner({"type": "calibration", "step": step})

    async def _enroll(self, pcm: bytes) -> bool:
        emb = await asyncio.get_running_loop().run_in_executor(MISC_POOL, audio.voice_embedding, pcm)
        if emb is None:
            return False
        self.voiceprint = emb
        self._save_calibration(voiceprint=[round(float(x), 5) for x in emb])
        return True

    def _save_calibration(self, **values) -> None:
        with db_factory() as db:
            s = self._row(db)
            s.calibration = {**(s.calibration or {}), **values}
            db.commit()

    # ---------- vision ----------

    async def _frame_worker(self) -> None:
        loop = asyncio.get_running_loop()
        while True:
            await self._frame_ready.wait()
            self._frame_ready.clear()
            if self._frame is None:
                continue
            t, jpeg = self._frame
            try:
                obs = await loop.run_in_executor(VISION_POOL, analyze, jpeg, True)
            except Exception:  # noqa: BLE001
                log.exception("Frame analysis failed")
                continue
            self.last_obs = obs
            now = time.time()
            self._frames_done = [x for x in self._frames_done if x > now - 2] + [now]
            if self.status == SessionStatus.live or self.monitor.calibration is not None:
                try:
                    await self._apply(self.monitor.on_frame(t, obs), jpeg)
                except Exception:  # noqa: BLE001 — keep analysing the next frames
                    log.exception("Recording a flag failed")

    # ---------- flags ----------

    async def _apply(self, changes: list[Change], jpeg: bytes | None = None) -> None:
        for change in changes:
            f = change.flag
            with db_factory() as db:
                if f.id is None:
                    if jpeg is None and self._frame is not None:
                        jpeg = self._frame[1]
                    if jpeg:
                        f.snapshot_key = self._save_snapshot(jpeg)
                    row = VivaEvent(
                        session_id=self.id,
                        type=f.type,
                        start_ts=f.start,
                        end_ts=f.end,
                        confidence=f.confidence,
                        detail=f.detail[:255],
                        snapshot_key=f.snapshot_key,
                    )
                    db.add(row)
                    db.commit()
                    f.id = row.id
                else:
                    row = db.get(VivaEvent, f.id)
                    if row is None:
                        continue
                    row.end_ts, row.confidence = f.end, f.confidence
                    db.commit()
                out = _event_out(row)
            await self.to_examiner({"type": "event", "event": out | {"open": not f.closed}})

    def _save_snapshot(self, jpeg: bytes) -> str | None:
        key = f"{self.class_id}/snapshots/{self.id}/{uuid.uuid4().hex[:12]}.jpg"
        try:
            path = storage.path_for(key)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(jpeg)
        except OSError:
            log.exception("Couldn't save a snapshot")  # the flag is still recorded, without the image
            return None
        return key

    # ---------- audio ----------

    async def _audio(self, speaker: Speaker, pcm: bytes) -> None:
        t = self.t()
        if speaker == Speaker.student and self._voice_step:
            self._enroll_pcm.append(pcm)
            return
        segments, voiced = self.segmenters[speaker].feed(pcm, t)
        if speaker == Speaker.examiner and voiced > 0.3:
            self._examiner_speaking_until = t + 0.5
        if speaker == Speaker.student and self.status == SessionStatus.live:
            # Only count the student's voice when the examiner isn't talking (their voice can leak through).
            self.monitor.on_voice(t, voiced > 0.5 and t > self._examiner_speaking_until)
        if self.status != SessionStatus.live:
            return
        for seg in segments:
            await self._stt_queue.put((speaker, seg))

    async def _stt_worker(self) -> None:
        loop = asyncio.get_running_loop()
        while True:
            speaker, seg = await self._stt_queue.get()
            try:
                result = await loop.run_in_executor(STT_POOL, audio.transcribe, seg.pcm)
                if result is None or not result.text:
                    continue
                await self._add_turn(speaker, result.text, seg.start, seg.end, words=result.words)
            except Exception:  # noqa: BLE001 — keep transcribing the next segments
                log.exception("Speech-to-text failed")
                continue
            if speaker == Speaker.student:
                asyncio.create_task(self._check_voice(seg))

    async def _check_voice(self, seg: audio.Segment) -> None:
        if seg.end - seg.start < 2:
            return  # too short for a reliable voice print comparison
        if seg.start < self._examiner_speaking_until:
            return  # overlapping the examiner
        emb = await asyncio.get_running_loop().run_in_executor(MISC_POOL, audio.voice_embedding, seg.pcm)
        if emb is None:
            return
        if self.voiceprint is None:
            # Not enrolled at calibration: use the student's first long answer as the voice print.
            if seg.end - seg.start >= 3:
                self.voiceprint = emb
                self._save_calibration(voiceprint=[round(float(x), 5) for x in emb])
            return
        change = self.monitor.on_speaker_check(seg.start, seg.end, audio.cosine(emb, self.voiceprint))
        if change:
            await self._apply([change])

    # ---------- transcript and answers ----------

    async def _add_turn(self, speaker: Speaker, text: str, start: float, end: float, words=None, typed=False):
        with db_factory() as db:
            row = VivaTurn(
                session_id=self.id,
                speaker=speaker,
                text=text,
                start_ts=start,
                end_ts=end,
                words=len(text.split()),
                analysis={"typed": True} if typed else None,
            )
            db.add(row)
            db.commit()
            out = _turn_out(row)
        if self.state is not None:
            self.state.transcript.append((speaker.value, text))
        else:
            self._brief["transcript"].append((speaker.value, text))
        await self.to_examiner({"type": "turn", "turn": out})

        if speaker == Speaker.examiner:
            # The examiner speaking again closes the previous answer: grade it, then start a new question.
            if self.answer.turn_ids:
                asyncio.create_task(self._grade(self._take_answer(keep_question=False)))
            self.answer.question = f"{self.answer.question} {text}".strip()
            self.answer.question_end = end
        else:
            a = self.answer
            if a.start is None:
                a.start = start
            a.turn_ids.append(out["id"])
            a.texts.append(text)
            a.speech_seconds += end - start
            if words:
                times = [(start + w0, start + w1) for w0, w1, _ in words]
                if a.last_word_end is not None:
                    a.gaps.append(times[0][0] - a.last_word_end)
                a.gaps += [b[0] - prev[1] for prev, b in zip(times, times[1:], strict=False)]
                a.last_word_end = times[-1][1]

    def _take_answer(self, keep_question: bool = True) -> _Answer | None:
        """Hand the current answer over for grading and start collecting the next one."""
        a = self.answer
        if not a.turn_ids:
            return None
        self.answer = (
            _Answer(question=a.question, question_end=a.question_end) if keep_question else _Answer()
        )
        return a

    async def _grade(self, a: _Answer | None) -> None:
        if a is None:
            return
        text = " ".join(a.texts)
        latency = (
            max(0.0, a.start - a.question_end) if a.question_end is not None and a.start is not None else None
        )
        d = metrics.delivery(text, a.speech_seconds, latency, a.gaps)
        analysis = {
            "question": a.question,
            "turnIds": a.turn_ids,
            "latencyS": d.latency_s,
            "wpm": d.wpm,
            "fillerRate": d.filler_rate,
            "longPauses": d.long_pauses,
            "fluency": d.fluency,
        }
        grade = None
        llm = get_llm()
        if len(text.split()) < 4:
            analysis["note"] = "Too short to grade."
        elif llm is None or self.state is None:
            analysis["note"] = llm_error() or "AI grading is still loading."
        else:
            try:
                grade = await agents.grade(llm, self.state, a.question, text)
            except (LLMError, ValueError) as exc:
                analysis["note"] = str(exc)
        if grade is not None:
            sim = await asyncio.get_running_loop().run_in_executor(
                MISC_POOL, ctx.similarity, text, grade.reference_answer
            )
            analysis |= {
                "correctness": round(grade.correctness, 2),
                "depth": round(grade.depth, 2),
                "similarity": round(sim, 2) if sim is not None else None,
                "memorizationFlag": grade.memorization_flag,
                "reasoning": grade.reasoning,
                "strengths": grade.strengths,
                "weakPoints": grade.weak_points,
                "referenceAnswer": grade.reference_answer,
                "criteria": [c.model_dump() for c in grade.criteria],
            }
            analysis["mastery"] = metrics.mastery(grade.correctness, sim, d.fluency, self.cfg.mastery_weights)
            self.last_grade = grade
            if self.state is not None:
                self.state.weak_points += grade.weak_points

        with db_factory() as db:
            row = db.get(VivaTurn, a.turn_ids[0])
            row.analysis = analysis
            scored = [
                t.analysis["mastery"]
                for t in self._row(db).turns
                if t.analysis and t.analysis.get("mastery") is not None
            ]
            self.mastery = round(sum(scored) / len(scored), 1) if scored else None
            s = self._row(db)
            s.mastery_score = self.mastery
            db.commit()
        await self.to_examiner(
            {"type": "grade", "turnId": a.turn_ids[0], "analysis": analysis, "mastery": self.mastery}
        )
        if grade is not None:
            await self.refresh_suggestions()

    async def refresh_suggestions(self) -> None:
        llm = get_llm()
        if self._suggesting:
            return
        if llm is None or self.state is None:
            self.suggestions_error = llm_error() or "Reading the student's work…"
            await self.to_examiner(
                {"type": "suggestions", "items": self.suggestions, "error": self.suggestions_error}
            )
            return
        self._suggesting = True
        await self.to_examiner({"type": "suggestions", "items": self.suggestions, "loading": True})
        try:
            items = await agents.suggest(llm, self.state, self.last_grade)
            self.suggestions = [s.model_dump() for s in items]
            self.suggestions_error = None
        except (LLMError, ValueError) as exc:
            self.suggestions_error = str(exc)
        finally:
            self._suggesting = False
        await self.to_examiner(
            {"type": "suggestions", "items": self.suggestions, "error": self.suggestions_error}
        )

    # ---------- aggregator ----------

    async def _ticker(self) -> None:
        """Every second: scores and health to the examiner; the peak risk to the database every 5 s."""
        n = 0
        while True:
            await asyncio.sleep(1)
            n += 1
            t = self.t()
            if self.status == SessionStatus.live:
                self.risk = self.monitor.risk(t)
                if n % 5 == 0:
                    with db_factory() as db:
                        s = self._row(db)
                        s.risk_score = self.monitor.peak_risk
                        db.commit()
            await self.to_examiner(
                {
                    "type": "scores",
                    "t": t,
                    "risk": self.risk,
                    "mastery": self.mastery,
                    "fps": round(len(self._frames_done) / 2, 1),
                    "studentSpeaking": self.segmenters[Speaker.student].speaking,
                    "examinerSpeaking": self.segmenters[Speaker.examiner].speaking,
                    "status": self.status.value,
                }
            )


def _event_out(e: VivaEvent) -> dict:
    return {
        "id": e.id,
        "type": e.type,
        "label": LABELS.get(e.type, e.type),
        "startTs": e.start_ts,
        "endTs": e.end_ts,
        "confidence": e.confidence,
        "detail": e.detail,
        "hasSnapshot": bool(e.snapshot_key),
    }


def _turn_out(t: VivaTurn) -> dict:
    return {
        "id": t.id,
        "speaker": t.speaker.value,
        "text": t.text,
        "startTs": t.start_ts,
        "endTs": t.end_ts,
        "analysis": t.analysis,
    }


class Hub:
    """Live sessions in this process, by session id."""

    def __init__(self):
        self.sessions: dict[str, LiveSession] = {}

    def get(self, session_id: str) -> LiveSession | None:
        return self.sessions.get(session_id)

    def open(self, session_id: str) -> LiveSession:
        live = self.sessions.get(session_id)
        if live is None:
            live = self.sessions[session_id] = LiveSession(session_id)
        live.start_tasks()
        return live

    def release(self, live: LiveSession) -> None:
        """Called when a connection closes. Ended sessions with nobody connected are dropped."""
        if live.student is None and live.examiner is None and live.status == SessionStatus.ended:
            live.stop_tasks()
            self.sessions.pop(live.id, None)


hub = Hub()
