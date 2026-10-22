"""The AI report, sending results to the student, the student's work for the live room, and the
Co-Pilot's project-by-project plan."""

# ruff: noqa: F811 — the fixtures below are imported from test_live and used as test arguments

import asyncio
from types import SimpleNamespace

from app.live import session as live_session
from app.live.evaluation import agents
from app.live.evaluation.context import Context
from app.live.evaluation.report import qa_pairs
from app.models import Speaker, VivaTurn
from tests.test_live import no_models, setup, until, ws_url  # noqa: F401


def turn(speaker, text):
    return SimpleNamespace(speaker=Speaker(speaker), text=text)


def test_questions_are_paired_with_the_students_answers():
    pairs = qa_pairs(
        [
            turn("examiner", "Hello."),
            turn("examiner", "Tell me about your cache."),
            turn("student", "It is an LRU cache."),
            turn("student", "Built on a hash map."),
            turn("examiner", "Why LRU?"),
            turn("student", "Recent items are reused."),
            turn("examiner", "Thanks."),
        ]
    )
    assert pairs == [
        {
            "question": "Hello. Tell me about your cache.",
            "answer": "It is an LRU cache. Built on a hash map.",
        },
        {"question": "Why LRU?", "answer": "Recent items are reused."},
        {"question": "Thanks.", "answer": ""},
    ]


def ended_session(client, setup) -> str:
    """A finished interview with one question and one answer; returns its session id."""
    assert client.post(f"/api/vivas/{setup['viva_id']}/join", headers=setup["asha"]).status_code == 200
    with client.websocket_connect(ws_url(setup, setup["asha"])) as student:
        until(student, "state")
        with client.websocket_connect(ws_url(setup, setup["prof"])) as examiner:
            until(examiner, "state")
            examiner.send_json({"type": "start"})
            until(student, "state")
            examiner.send_json({"type": "show_question", "text": "Why did you pick a hash map?"})
            session_id = until(examiner, "turn")["turn"]
            examiner.send_json({"type": "end"})
            until(student, "ended")
    stats = client.get(f"/api/vivas/{setup['viva_id']}/stats", headers=setup["prof"]).json()
    session_id = stats["students"][0]["sessionId"]
    with live_session.db_factory() as db:
        db.add(
            VivaTurn(
                session_id=session_id,
                speaker=Speaker.student,
                text="For O(1) lookups.",
                start_ts=9,
                end_ts=11,
            )
        )
        db.commit()
    return session_id


def test_ai_report_and_sending_results_to_the_student(client, setup):
    sid = ended_session(client, setup)
    prof, asha = setup["prof"], setup["asha"]

    report = client.get(f"/api/viva-sessions/{sid}", headers=prof).json()
    assert report["qa"] == [{"question": "Why did you pick a hash map?", "answer": "For O(1) lookups."}]
    assert report["sentToStudent"] is None

    res = client.post(f"/api/viva-sessions/{sid}/ai-report", headers=prof)
    assert res.status_code == 200, res.text
    ai = res.json()["aiReport"]
    assert ai["verdict"] == "insufficient_evidence"  # the fake AI returned nothing useful
    assert [c["name"] for c in ai["criteria"]] == [c["name"] for c in report["evaluationCriteria"]]

    send = f"/api/viva-sessions/{sid}/send"
    body = {"includeMarks": True, "includeAiReport": True, "message": "Well done."}
    assert client.post(send, json=body, headers=prof).status_code == 400  # marks not saved yet
    criteria = [{"name": report["evaluationCriteria"][0]["name"], "score": 8}]
    client.put(
        f"/api/viva-sessions/{sid}/result", json={"score": 7.5, "criteriaScores": criteria}, headers=prof
    )
    assert client.post(send, json=body, headers=asha).status_code in (403, 404)  # students can't send
    res = client.post(send, json=body, headers=prof)
    assert res.status_code == 200, res.text
    assert res.json()["sentToStudent"]["marks"]["score"] == 7.5

    mine = client.get(f"/api/vivas/{setup['viva_id']}/mine", headers=asha).json()["feedback"]
    assert mine["feedback"] == "Well done."
    assert mine["marks"]["criteria"][0]["score"] == 8 and mine["marks"]["outOf"] == 10
    assert mine["aiReport"]["verdict"] == "insufficient_evidence"

    # Sending again without the AI report takes it back.
    body = {"includeMarks": True, "includeAiReport": False, "message": ""}
    client.post(send, json=body, headers=prof)
    mine = client.get(f"/api/vivas/{setup['viva_id']}/mine", headers=asha).json()["feedback"]
    assert mine["aiReport"] is None and mine["marks"]["score"] == 7.5


def test_student_work_without_a_linked_assignment(client, setup):
    url = f"/api/vivas/{setup['viva_id']}/students/{setup['asha_id']}/work"
    work = client.get(url, headers=setup["prof"]).json()
    assert work == {"assignmentTitle": None, "submittedAt": None, "files": [], "links": [], "note": ""}
    assert client.get(url, headers=setup["asha"]).status_code in (403, 404)


def test_deleting_a_finished_viva(client, setup):
    ended_session(client, setup)
    assert client.delete(f"/api/vivas/{setup['viva_id']}", headers=setup["prof"]).status_code == 204
    assert client.get(f"/api/vivas/{setup['viva_id']}", headers=setup["prof"]).status_code == 404


class PlanLLM:
    def __init__(self, reply):
        self.reply, self.prompts = reply, []

    async def json(self, system, prompt, schema, max_tokens=4000):
        self.prompts.append(prompt)
        return self.reply


def test_copilot_moves_on_when_a_project_has_enough_evidence():
    state = agents.ExamState(
        title="t", instructions="", criteria=[], context=Context("Projects: Cache, Chatbot", [])
    )
    state.transcript = [("examiner", "How does your cache evict?"), ("student", "LRU with a linked list.")]
    llm = PlanLLM(
        {
            "projects": ["Cache", "Chatbot"],
            "current_project": "Cache",
            "enough_evidence": True,
            "coverage_note": "Design, eviction and trade-offs covered.",
            "next_project": "Chatbot",
            "suggestions": [
                {
                    "question": "What model does the chatbot use?",
                    "kind": "new_project",
                    "why": "x",
                    "criterion": "y",
                }
            ],
        }
    )
    plan = asyncio.run(agents.suggest(llm, state, None, covered=["Old project"], focus=""))
    assert plan.enough_evidence and plan.next_project == "Chatbot"
    assert plan.suggestions[0].kind == "new_project"
    assert "Old project" in llm.prompts[0]  # covered projects are passed on

    asyncio.run(agents.suggest(llm, state, None, covered=[], focus="Chatbot"))
    assert "move to this project now: Chatbot" in llm.prompts[1]


def test_integrity_summary_in_plain_words():
    from app.live.integrity.rules import integrity_summary

    unseen = integrity_summary([], 0, proctor_frames=3, face_frames=3)
    assert unseen["level"] == "unverified" and "couldn't be checked" in unseen["text"]

    clean = integrity_summary([], 0, proctor_frames=3000, face_frames=2990)
    assert clean["level"] == "clear" and clean["text"].startswith("Attended genuinely")

    minor = integrity_summary([("gaze_off_screen", 10, 14), ("gaze_off_screen", 50, 54)], 8, 3000, 2990)
    assert minor["level"] == "minor"
    assert "looked away from the screen twice (8 s)" in minor["text"]

    serious = integrity_summary([("second_person", 5, 9), ("gaze_off_screen", 10, 14)], 25, 3000, 2990)
    assert serious["level"] == "concerns"
    assert serious["text"].startswith("Integrity concerns: the student had another person in view once")


def test_report_has_the_integrity_summary(client, setup):
    sid = ended_session(client, setup)
    report = client.get(f"/api/viva-sessions/{sid}", headers=setup["prof"]).json()
    assert report["integrity"]["level"] == "unverified"  # no video in the test room
