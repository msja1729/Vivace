"""The topic-by-topic Co-Pilot through the live room, each instructor's own AI key, and its settings."""

# ruff: noqa: F811 — the fixtures below are imported from test_live and used as test arguments

from app.live import session as live_session
from app.services import ai_settings
from tests.test_live import no_models, setup, until, ws_url  # noqa: F401


class TopicLLM:
    """Answers each Co-Pilot step by the shape of its schema, and records the prompts."""

    def __init__(self):
        self.prompts: list[str] = []

    async def json(self, system, prompt, schema, max_tokens=4000):
        self.prompts.append(prompt)
        props = schema["properties"]
        if "topics" in props:
            return {
                "topics": [
                    {"name": "Cache", "kind": "project", "summary": "An LRU cache in Rust"},
                    {"name": "Chatbot", "kind": "project", "summary": "A support chatbot"},
                ]
            }
        if "questions" in props:
            return {"questions": [{"question": "Why LRU?", "why": "design", "criterion": "Ownership"}]}
        if "ready" in props:
            final = "Grade this topic now" in prompt
            return {
                "ready": "A2." in prompt,  # two answers on the topic = enough
                "confidence": "high" if final or "A2." in prompt else "low",
                "level": "partial",
                "score": 6,
                "summary": "Knows the eviction policy, not the trade-offs.",
                "evidence": "recent items are reused",
                "missing": "" if "A2." in prompt else "trade-offs",
            }
        return {}  # per-answer grading: not needed here


def until_copilot(ws, check, limit=60):
    for _ in range(limit):
        msg = ws.receive_json()
        view = msg.get("copilot") if msg["type"] == "state" else msg if msg["type"] == "copilot" else None
        if view and check(view):
            return view
    raise AssertionError("no matching Co-Pilot message")


def test_copilot_topic_by_topic(client, setup, monkeypatch):
    llm = TopicLLM()
    monkeypatch.setattr(live_session, "get_llm", lambda: llm)
    assert client.post(f"/api/vivas/{setup['viva_id']}/join", headers=setup["asha"]).status_code == 200
    with client.websocket_connect(ws_url(setup, setup["asha"])) as student:
        until(student, "state")
        with client.websocket_connect(ws_url(setup, setup["prof"])) as examiner:
            # 1. Topics from the student's work.
            view = until_copilot(examiner, lambda v: len(v["topics"]) == 2)
            assert [t["status"] for t in view["topics"]] == ["new", "new"]

            # 2. Pick a topic: opening questions on it.
            examiner.send_json({"type": "start"})
            examiner.send_json({"type": "topic", "id": "t1"})
            view = until_copilot(examiner, lambda v: v["suggestions"] and v["mode"] == "opening")
            assert view["current"] == "t1" and view["suggestions"][0]["question"] == "Why LRU?"

            # 3. Two answers on the topic: the second makes it ready, and the examiner is told.
            room = live_session.hub.sessions[next(iter(live_session.hub.sessions))]
            client.portal.call(room._log_answer, "Why LRU?", "Because recent items are reused.")
            client.portal.call(room._check_topic, "t1")
            assert room.copilot_notice is None
            client.portal.call(room._log_answer, "What breaks if the cache is full?", "The oldest item goes.")
            client.portal.call(room._check_topic, "t1")
            assert room.copilot_notice.startswith("Ready to grade Cache")

            # 4. Follow-up: built on the last answer.
            examiner.send_json({"type": "suggest", "mode": "follow_up"})
            until_copilot(examiner, lambda v: v["mode"] == "follow_up" and not v["busy"])
            assert "LAST answer" in llm.prompts[-1] and "The oldest item goes." in llm.prompts[-1]

            # 5. Moving to another topic grades the previous one on all its answers.
            examiner.send_json({"type": "topic", "id": "t2"})
            view = until_copilot(examiner, lambda v: v["topics"][0]["status"] == "graded")
            grade = view["topics"][0]["grade"]
            assert grade["level"] == "partial" and grade["score"] == 6 and grade["answers"] == 2
            assert grade["limited"] is False  # it had been ready before moving on
            assert view["current"] == "t2"
            examiner.send_json({"type": "end"})
            until(student, "ended")

    # Saved with the session, for the report.
    with live_session.db_factory() as db:
        from app.models import VivaSession

        saved = db.query(VivaSession).one().copilot
    assert saved["grades"]["t1"]["score"] == 6 and len(saved["log"]["t1"]) == 2


def test_examiners_own_key_comes_first(client, setup, login, monkeypatch):
    made = []
    monkeypatch.setattr(ai_settings.llm_mod, "make_llm", lambda p, k, m: made.append((p, k, m)) or f"{p}:{k}")
    monkeypatch.setattr(live_session, "get_llm", lambda: "server")
    from app.models import User, VivaSession

    client.post(f"/api/vivas/{setup['viva_id']}/join", headers=setup["asha"])
    with client.websocket_connect(ws_url(setup, setup["asha"])):
        pass
    with live_session.db_factory() as db:
        s = db.query(VivaSession).one()
        assert live_session.resolve_llm(db, s) == ("server", None)  # nobody has a key yet

        prof = db.query(User).filter_by(email="iyer@school.edu").one()
        prof.ai_provider, prof.ai_model, prof.ai_key_enc = (
            "claude",
            "claude-sonnet-5-5",
            ai_settings.encrypt("sk-prof"),
        )
        db.commit()
        assert live_session.resolve_llm(db, s) == ("claude:sk-prof", None)  # the class instructor's


def test_ai_settings_never_return_the_key(client, login, monkeypatch):
    prof = login("Prof", "prof@school.edu", role="instructor")
    out = client.get("/api/users/me/ai", headers=prof).json()
    assert out["provider"] is None and out["keyHint"] is None and "gemini" in out["models"]

    res = client.put(
        "/api/users/me/ai",
        json={"provider": "gemini", "model": "", "apiKey": "AIza-secret-1234"},
        headers=prof,
    )
    assert res.status_code == 200
    out = res.json()
    assert out["keyHint"] == "…1234" and out["model"] == "gemini-3.5-flash"
    assert "secret" not in res.text

    # Changing the model keeps the saved key; switching provider needs a new one.
    assert (
        client.put(
            "/api/users/me/ai", json={"provider": "gemini", "model": "gemini-2.5-flash"}, headers=prof
        ).json()["keyHint"]
        == "…1234"
    )
    assert client.put("/api/users/me/ai", json={"provider": "claude"}, headers=prof).status_code == 400

    class Ok:
        async def json(self, *a, **k):
            return {"answer": "ok"}

    monkeypatch.setattr(ai_settings, "llm_for", lambda user: Ok())
    assert client.post("/api/users/me/ai/check", headers=prof).json()["ok"] is True

    assert client.delete("/api/users/me/ai", headers=prof).json()["keyHint"] is None
    student = login("Stu", "stu@school.edu", role="student")
    assert client.get("/api/users/me/ai", headers=student).status_code == 403


def test_topic_grades_reach_the_report(client, setup, monkeypatch):
    from app.models import VivaSession

    client.post(f"/api/vivas/{setup['viva_id']}/join", headers=setup["asha"])
    with client.websocket_connect(ws_url(setup, setup["asha"])):
        pass
    with live_session.db_factory() as db:
        s = db.query(VivaSession).one()
        s.copilot = {
            "topics": [
                {"id": "t1", "name": "Cache", "kind": "project", "summary": ""},
                {"id": "t2", "name": "Chatbot", "kind": "project", "summary": ""},
            ],
            "grades": {
                "t1": {
                    "level": "partial",
                    "score": 6,
                    "summary": "Knows eviction.",
                    "evidence": "x",
                    "limited": True,
                    "answers": 2,
                }
            },
        }
        db.commit()
        sid = s.id
    topics = client.get(f"/api/viva-sessions/{sid}", headers=setup["prof"]).json()["topics"]
    assert topics == [
        {
            "name": "Cache",
            "kind": "project",
            "level": "partial",
            "score": 6.0,
            "summary": "Knows eviction.",
            "evidence": "x",
            "limited": True,
            "answers": 2,
        }
    ]
