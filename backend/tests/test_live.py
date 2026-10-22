"""The live room: WebSocket protocol, integrity rules, delivery metrics and answer grading.
No ML models are loaded here: the engines are switched off and the LLM is a fake."""

import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from starlette.websockets import WebSocketDisconnect

from app.live import engines
from app.live import session as live_session
from app.live.config import LiveConfig
from app.live.evaluation import agents, metrics
from app.live.evaluation.context import Context
from app.live.integrity.rules import IntegrityMonitor
from app.live.integrity.vision import FrameObs
from app.models import VivaSession, VivaTurn
from app.services import vivas as viva_service

START = datetime.now(UTC).replace(microsecond=0) + timedelta(days=1)


@pytest.fixture(autouse=True)
def no_models(monkeypatch):
    for name in ("face_landmarker", "yolo", "whisper", "speaker_encoder", "embedder"):
        monkeypatch.setattr(engines, name, lambda: None)
    monkeypatch.setattr(live_session, "get_llm", lambda: FakeLLM())
    yield
    live_session.hub.sessions.clear()


class FakeLLM:
    async def json(self, system, prompt, schema, max_tokens=4000):
        if "suggestions" in schema["properties"]:
            return {
                "suggestions": [
                    {
                        "question": "Why a hash map?",
                        "kind": "opening",
                        "why": "design",
                        "criterion": "Ownership",
                    }
                ]
            }
        return {
            "correctness": 0.8,
            "depth": 0.4,
            "memorization_flag": True,
            "reasoning": "Recited the definition.",
            "strengths": ["correct definition"],
            "weak_points": ["no example from own project"],
            "reference_answer": "A hash map gives O(1) average lookups.",
            "criteria": [{"name": "Conceptual understanding", "tested": True, "score": 6}],
        }


@pytest.fixture
def setup(client, login, monkeypatch):
    prof = login("Prof Iyer", "iyer@school.edu", role="instructor")
    ta = login("Tara TA", "tara@school.edu", role="instructor")
    asha = login("Asha", "asha@school.edu", role="student")
    cls = client.post("/api/classes", json={"name": "ML", "subject": "ML"}, headers=prof).json()
    client.post("/api/classes/join", json={"code": cls["joinCode"]}, headers=asha)
    ta_id = client.get("/api/users/me", headers=ta).json()["id"]
    client.post(f"/api/classes/{cls['id']}/tas", json={"userId": ta_id}, headers=prof)
    prof_id = client.get("/api/users/me", headers=prof).json()["id"]
    asha_id = client.get("/api/users/me", headers=asha).json()["id"]
    v = client.post(f"/api/classes/{cls['id']}/vivas", json={"audience": "whole_class"}, headers=prof).json()
    body = {
        "title": "Project viva",
        "assignmentId": None,
        "studentIds": [],
        "startsAt": START.isoformat(),
        "durationMinutes": 15,
        "conductedBy": "staff",
        "examinerIds": [prof_id, ta_id],
        "allocation": [{"studentId": asha_id, "examinerId": prof_id}],
        "interviewInstructions": "Ask about their projects.",
        "evaluationCriteria": v["evaluationCriteria"],
        "reportFormat": "Score and gaps.",
        "summaryStats": v["summaryStats"],
    }
    assert client.put(f"/api/vivas/{v['id']}", json=body, headers=prof).status_code == 200
    assert client.post(f"/api/vivas/{v['id']}/schedule", headers=prof).status_code == 200
    monkeypatch.setattr(viva_service, "utcnow", lambda: START + timedelta(minutes=1))
    return {"prof": prof, "ta": ta, "asha": asha, "asha_id": asha_id, "viva_id": v["id"]}


def ws_url(setup, headers):
    token = headers["Authorization"].split()[1]
    return f"/api/ws/vivas/{setup['viva_id']}/students/{setup['asha_id']}?token={token}"


def until(ws, kind: str, limit: int = 50) -> dict:
    for _ in range(limit):
        msg = ws.receive_json()
        if msg["type"] == kind:
            return msg
    raise AssertionError(f"no {kind} message")


def test_student_must_join_before_the_live_room(client, setup):
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(ws_url(setup, setup["asha"])) as ws:
            ws.receive_json()
    assert exc.value.code == 4403


def test_only_the_allocated_examiner_or_owner_conducts(client, setup):
    client.post(f"/api/vivas/{setup['viva_id']}/join", headers=setup["asha"])
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(ws_url(setup, setup["ta"])) as ws:
            ws.receive_json()
    assert exc.value.code == 4403


def test_live_room_flow(client, setup):
    assert client.post(f"/api/vivas/{setup['viva_id']}/join", headers=setup["asha"]).status_code == 200
    with client.websocket_connect(ws_url(setup, setup["asha"])) as student:
        assert until(student, "state")["status"] == "waiting"
        with client.websocket_connect(ws_url(setup, setup["prof"])) as examiner:
            state = until(examiner, "state")
            assert state["studentOnline"] and state["status"] == "waiting"
            assert until(student, "presence")["examiner"] is True

            # WebRTC handshake is relayed untouched.
            examiner.send_json({"type": "signal", "data": {"sdp": "offer"}})
            assert until(student, "signal")["data"] == {"sdp": "offer"}

            examiner.send_json({"type": "start"})
            assert until(student, "state")["status"] == "live"

            examiner.send_json({"type": "show_question", "text": "What does your cache evict first?"})
            assert until(student, "question")["text"].startswith("What does")
            assert until(examiner, "turn")["turn"]["speaker"] == "examiner"

            examiner.send_json({"type": "end"})
            until(student, "ended")
            session_id = until(examiner, "state")
            assert session_id["status"] == "ended"

    stats = client.get(f"/api/vivas/{setup['viva_id']}/stats", headers=setup["prof"]).json()
    row = stats["students"][0]
    assert row["vivaStatus"] == "completed" and row["sessionStatus"] == "ended"

    criteria = [{"name": "Communication", "score": 7}]
    url = f"/api/viva-sessions/{row['sessionId']}/result"
    res = client.put(
        url, json={"score": 7.5, "criteriaScores": criteria, "notes": "Good."}, headers=setup["prof"]
    )
    assert res.status_code == 200, res.text
    report = res.json()
    assert report["score"] == 7.5 and report["turns"][0]["text"].startswith("What does")
    assert report["riskBand"] == "low"
    stats = client.get(f"/api/vivas/{setup['viva_id']}/stats", headers=setup["prof"]).json()
    assert stats["averageScore"] == 7.5
    assert stats["criteriaAverages"] == [{"name": "Communication", "average": 7.0}]
    # Students can't read the report.
    assert client.get(f"/api/viva-sessions/{row['sessionId']}", headers=setup["asha"]).status_code == 404


def test_result_needs_an_ended_interview(client, setup):
    client.post(f"/api/vivas/{setup['viva_id']}/join", headers=setup["asha"])
    with client.websocket_connect(ws_url(setup, setup["asha"])) as student:
        sid = None
        until(student, "state")
    q = client.get(f"/api/vivas/{setup['viva_id']}/queue", headers=setup["prof"]).json()
    sid = q["rows"][0]["sessionId"]
    url = f"/api/viva-sessions/{sid}/result"
    assert client.put(url, json={"score": 5}, headers=setup["prof"]).status_code == 409
    assert client.post(f"/api/viva-sessions/{sid}/end", headers=setup["prof"]).json()["status"] == "ended"
    assert client.put(url, json={"score": 5}, headers=setup["prof"]).status_code == 200


def test_answers_are_graded_and_mastery_tracked(client, setup):
    client.post(f"/api/vivas/{setup['viva_id']}/join", headers=setup["asha"])
    with client.websocket_connect(ws_url(setup, setup["asha"])) as student:
        until(student, "state")
    sid = client.get(f"/api/vivas/{setup['viva_id']}/queue", headers=setup["prof"]).json()["rows"][0][
        "sessionId"
    ]

    async def scenario():
        room = live_session.LiveSession(sid)
        room.state = agents.ExamState(
            title="t", instructions="", criteria=[], context=Context("Built a cache in Python.", [])
        )
        S = live_session.Speaker
        await room._add_turn(S.examiner, "What is a hash map?", 0.0, 2.0)
        words = [(0.0, 0.4, "A"), (0.5, 1.0, "hash"), (1.1, 1.6, "map"), (4.0, 4.5, "stores")]
        await room._add_turn(S.student, "A hash map stores key value pairs um", 3.5, 8.5, words=words)
        await room._add_turn(S.examiner, "Why did you use one?", 10.0, 11.0)
        for _ in range(50):
            await asyncio.sleep(0.02)
            if room.mastery is not None:
                break
        return room

    room = asyncio.run(scenario())
    assert room.last_grade is not None and room.last_grade.memorization_flag
    assert room.suggestions and room.suggestions[0]["question"] == "Why a hash map?"
    with live_session.db_factory() as db:
        answer = db.query(VivaTurn).filter_by(session_id=sid, speaker="student").one()
        a = answer.analysis
        assert a["question"] == "What is a hash map?"
        assert a["latencyS"] == 1.5 and a["longPauses"] == 1
        assert a["memorizationFlag"] and a["similarity"] is None  # no embedding model in tests
        # Without similarity: (0.5*0.8 + 0.2*fluency) / 0.7
        assert a["mastery"] == pytest.approx(100 * (0.5 * 0.8 + 0.2 * a["fluency"]) / 0.7, abs=0.1)
        assert db.get(VivaSession, sid).mastery_score == a["mastery"]

    report = client.get(f"/api/viva-sessions/{sid}", headers=setup["prof"]).json()
    suggested = {c["name"]: c["score"] for c in report["suggestedCriteriaScores"]}
    assert suggested["Conceptual understanding"] == 6


# ---------- integrity rules ----------


def face(**kw) -> FrameObs:
    base = {
        "faces": 1,
        "face_ok": True,
        "eye_x": 0.0,
        "eye_y": 0.0,
        "yaw": 0.0,
        "pitch": 0.0,
        "mouth_open": 0.2,
    }
    return FrameObs(**(base | kw))


def run(monitor, frames, fps=5, t0=0.0):
    changes = []
    for i, obs in enumerate(frames):
        changes += monitor.on_frame(t0 + i / fps, obs)
    return changes


def test_looking_away_is_flagged_after_3_seconds():
    m = IntegrityMonitor(LiveConfig())
    assert run(m, [face(eye_x=0.8)] * 10) == []  # 2 s
    opened = run(m, [face(eye_x=0.8)] * 10, t0=2.0)
    assert [c.flag.type for c in opened if c.kind == "open"] == ["gaze_off_screen"]
    closed = run(m, [face()], t0=5.0)
    assert closed[0].kind == "close" and closed[0].flag.end - closed[0].flag.start >= 3


def test_no_face_and_multiple_faces():
    m = IntegrityMonitor(LiveConfig())
    types = {c.flag.type for c in run(m, [face(faces=0)] * 20) if c.kind == "open"}
    assert types == {"no_face"}
    types = {c.flag.type for c in run(m, [face(faces=2)] * 3, t0=10) if c.kind == "open"}
    assert "multiple_faces" in types


def test_phone_needs_3_of_5_frames():
    m = IntegrityMonitor(LiveConfig())
    phone = {"label": "cell phone", "conf": 0.9, "box": [0, 0, 0.1, 0.1]}
    with_phone = face(objects_ok=True, objects=[phone], persons=1)
    without = face(objects_ok=True, objects=[], persons=1)
    assert run(m, [with_phone, without, with_phone, without]) == []
    opened = run(m, [with_phone], t0=1)
    assert opened and opened[0].flag.type == "prohibited_object" and opened[0].flag.detail == "cell phone"


def test_second_person_from_yolo():
    m = IntegrityMonitor(LiveConfig())
    two = face(objects_ok=True, persons=2)
    assert any(c.flag.type == "second_person" for c in run(m, [two] * 3))


def test_reading_sweeps():
    m = IntegrityMonitor(LiveConfig())
    sweep = [face(eye_x=x) for x in (-0.3, 0.0, 0.3, 0.0, -0.3, 0.0, 0.3, 0.0, -0.3, 0.0, 0.3, 0.0, -0.3)]
    assert any(c.flag.type == "reading_pattern" for c in run(m, sweep, fps=2))


def test_lip_sync_mismatch():
    m = IntegrityMonitor(LiveConfig())
    for i in range(40):
        m.on_voice(i * 0.1, True)
    changes = run(m, [face(mouth_open=0.01)] * 20, fps=5, t0=0)
    assert any(c.flag.type == "lipsync_mismatch" for c in changes)


def test_calibration_widens_gaze_bounds():
    m = IntegrityMonitor(LiveConfig())
    m.start_calibration()
    run(m, [face(eye_x=x, eye_y=y) for x, y in [(-0.5, 0.3), (0.5, 0.3), (-0.5, -0.4), (0.5, -0.4)] * 3])
    bounds = m.finish_calibration()
    assert bounds["eye_x"][0] < -0.5 and bounds["eye_x"][1] > 0.5
    assert run(m, [face(eye_x=0.55)] * 20) == []  # inside the calibrated screen now


def test_speaker_check_and_risk():
    m = IntegrityMonitor(LiveConfig())
    assert m.on_speaker_check(0, 3, 0.8) is None
    change = m.on_speaker_check(5, 8, 0.2)
    assert change.flag.type == "secondary_speaker" and change.flag.confidence == 0.8
    risk = m.risk(10)
    assert risk == pytest.approx(20 * (1 + 3 / 10))
    assert m.risk(10 + 601) == 0 and m.peak_risk == risk  # outside the rolling window


# ---------- delivery metrics ----------


def test_delivery_metrics():
    d = metrics.delivery("um so basically it like stores pairs", 6.0, 1.0, [0.2, 2.5])
    assert d.words == 7 and d.long_pauses == 1
    assert d.filler_rate == pytest.approx(3 / 0.1)
    assert 0 <= d.fluency <= 1
    assert metrics.mastery(None, None, 0.9, LiveConfig().mastery_weights) is None
    assert metrics.mastery(1.0, 1.0, 1.0, LiveConfig().mastery_weights) == 100
