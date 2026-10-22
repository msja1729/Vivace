"""Staff-run vivas: examiners, allocation into time slots, per-slot entry, examiner queues."""

from datetime import UTC, datetime, timedelta

import pytest

from app.services import vivas as viva_service

START = datetime.now(UTC).replace(microsecond=0) + timedelta(days=1)


@pytest.fixture
def setup(client, login):
    prof = login("Prof Iyer", "iyer@school.edu", role="instructor")
    ta = login("Tara TA", "tara@school.edu", role="instructor")
    names = ("Asha", "Ravi", "Meera", "Kiran")
    students = {n: login(n, f"{n.lower()}@school.edu", role="student") for n in names}
    cls = client.post("/api/classes", json={"name": "ML", "subject": "ML"}, headers=prof).json()
    for h in students.values():
        client.post("/api/classes/join", json={"code": cls["joinCode"]}, headers=h)
    ta_id = client.get("/api/users/me", headers=ta).json()["id"]
    client.post(f"/api/classes/{cls['id']}/tas", json={"userId": ta_id}, headers=prof)
    members = client.get(f"/api/classes/{cls['id']}/members", headers=prof).json()
    viva = client.post(
        f"/api/classes/{cls['id']}/vivas", json={"audience": "whole_class"}, headers=prof
    ).json()
    return {
        "prof": prof,
        "ta": ta,
        "students": students,
        "cls": cls,
        "viva": viva,
        "ids": {m["name"]: m["id"] for m in members},
        "prof_id": client.get("/api/users/me", headers=prof).json()["id"],
        "ta_id": ta_id,
    }


def body(setup, allocation, **overrides):
    v = setup["viva"]
    return {
        "title": "Project viva",
        "assignmentId": None,
        "studentIds": [],
        "startsAt": START.isoformat(),
        "durationMinutes": 15,
        "breakMinutes": 5,
        "conductedBy": "staff",
        "examinerIds": [setup["prof_id"], setup["ta_id"]],
        "allocation": [{"studentId": setup["ids"][s], "examinerId": e} for s, e in allocation],
        "interviewInstructions": "Ask about their projects.",
        "evaluationCriteria": v["evaluationCriteria"],
        "reportFormat": "Score and gaps.",
        "summaryStats": v["summaryStats"],
        **overrides,
    }


def save(client, setup, allocation, **overrides):
    return client.put(
        f"/api/vivas/{setup['viva']['id']}", json=body(setup, allocation, **overrides), headers=setup["prof"]
    )


def split(setup):
    p, t = setup["prof_id"], setup["ta_id"]
    return [("Asha", p), ("Ravi", t), ("Meera", p), ("Kiran", t)]


def test_new_viva_defaults_to_staff_with_every_examiner(setup):
    v = setup["viva"]
    assert v["conductedBy"] == "staff"
    assert {e["name"]: e["isOwner"] for e in v["staff"]} == {"Prof Iyer": True, "Tara TA": False}
    assert set(v["examinerIds"]) == {setup["prof_id"], setup["ta_id"]}
    assert len(v["unallocated"]) == 4 and v["slots"] == []


def test_allocation_creates_parallel_slots(client, setup):
    res = save(client, setup, split(setup))
    assert res.status_code == 200, res.text
    v = res.json()
    slots = {s["student"]["name"]: s for s in v["slots"]}
    # Each examiner's second student starts after one viva (15) + break (5).
    assert datetime.fromisoformat(slots["Asha"]["startsAt"]) == START
    assert datetime.fromisoformat(slots["Ravi"]["startsAt"]) == START
    assert datetime.fromisoformat(slots["Meera"]["startsAt"]) == START + timedelta(minutes=20)
    assert datetime.fromisoformat(slots["Kiran"]["startsAt"]) == START + timedelta(minutes=20)
    assert v["unallocated"] == []
    # Last slot + join window + duration.
    assert datetime.fromisoformat(v["endsAt"]) == START + timedelta(minutes=20 + 5 + 15)


def test_reordering_and_moving_students(client, setup):
    p, t = setup["prof_id"], setup["ta_id"]
    save(client, setup, split(setup))
    v = save(client, setup, [("Meera", p), ("Asha", p), ("Ravi", p), ("Kiran", t)]).json()
    order = {s["student"]["name"]: (s["examinerId"], s["position"]) for s in v["slots"]}
    assert order == {"Meera": (p, 0), "Asha": (p, 1), "Ravi": (p, 2), "Kiran": (t, 0)}


def test_scheduling_needs_every_student_allocated(client, setup):
    vid = setup["viva"]["id"]
    save(client, setup, split(setup)[:3])
    res = client.post(f"/api/vivas/{vid}/schedule", headers=setup["prof"])
    assert res.status_code == 400 and "allocate every student" in res.json()["detail"]
    save(client, setup, split(setup))
    assert client.post(f"/api/vivas/{vid}/schedule", headers=setup["prof"]).status_code == 200


def test_ai_examiner_cannot_be_scheduled_yet(client, setup):
    save(client, setup, [], conductedBy="ai")
    res = client.post(f"/api/vivas/{setup['viva']['id']}/schedule", headers=setup["prof"])
    assert res.status_code == 400 and "AI examiner" in res.json()["detail"]


def test_allocation_is_validated(client, setup, login):
    outsider = login("Olly", "olly@school.edu", role="instructor")
    olly = client.get("/api/users/me", headers=outsider).json()["id"]
    assert save(client, setup, [], examinerIds=[olly]).status_code == 400
    p = setup["prof_id"]
    # Only chosen examiners; each student once.
    assert save(client, setup, [("Asha", setup["ta_id"])], examinerIds=[p]).status_code == 400
    assert save(client, setup, [("Asha", p), ("Asha", p)]).status_code == 400


def test_tas_can_allocate(client, setup):
    res = client.put(f"/api/vivas/{setup['viva']['id']}", json=body(setup, split(setup)), headers=setup["ta"])
    assert res.status_code == 200, res.text


def schedule(client, setup):
    save(client, setup, split(setup))
    return client.post(f"/api/vivas/{setup['viva']['id']}/schedule", headers=setup["prof"]).json()


def test_entry_window_follows_each_students_slot(client, setup, monkeypatch):
    viva = schedule(client, setup)
    s = setup["students"]
    join = lambda h: client.post(f"/api/vivas/{viva['id']}/join", headers=h)  # noqa: E731

    monkeypatch.setattr(viva_service, "utcnow", lambda: START + timedelta(minutes=2))
    assert join(s["Asha"]).status_code == 200
    assert join(s["Meera"]).status_code == 400  # her slot starts at +20

    mine = client.get(f"/api/vivas/{viva['id']}/mine", headers=s["Meera"]).json()
    assert datetime.fromisoformat(mine["startsAt"]) == START + timedelta(minutes=20)
    assert mine["examiner"]["name"] == "Prof Iyer" and mine["myStatus"] == "upcoming"

    monkeypatch.setattr(viva_service, "utcnow", lambda: START + timedelta(minutes=21))
    assert join(s["Meera"]).status_code == 200
    monkeypatch.setattr(viva_service, "utcnow", lambda: START + timedelta(minutes=26))
    assert join(s["Kiran"]).status_code == 403  # Kiran's window (+20 to +25) has closed

    stats = client.get(f"/api/vivas/{viva['id']}/stats", headers=setup["prof"]).json()
    rows = {r["student"]["name"]: r for r in stats["students"]}
    assert rows["Kiran"]["vivaStatus"] == "missed" and rows["Kiran"]["examiner"]["name"] == "Tara TA"
    assert rows["Ravi"]["vivaStatus"] == "missed"


def test_examiner_queues(client, setup):
    viva = schedule(client, setup)
    ta_q = client.get(f"/api/vivas/{viva['id']}/queue", headers=setup["ta"]).json()
    assert [r["student"]["name"] for r in ta_q["rows"]] == ["Ravi", "Kiran"] and not ta_q["canConductAll"]
    prof_q = client.get(f"/api/vivas/{viva['id']}/queue", headers=setup["prof"]).json()
    assert len(prof_q["rows"]) == 4 and prof_q["canConductAll"]
    assert client.get(f"/api/vivas/{viva['id']}/queue", headers=setup["students"]["Asha"]).status_code == 404
