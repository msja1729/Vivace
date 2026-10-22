from datetime import UTC, datetime, timedelta

import pytest

from app.services import vivas as viva_service


def iso(delta: timedelta) -> str:
    return (datetime.now(UTC) + delta).isoformat()


@pytest.fixture
def setup(client, login):
    prof = login("Prof Iyer", "iyer@school.edu", role="instructor")
    students = [login(n, f"{n.lower()}@school.edu", role="student") for n in ("Asha", "Ravi", "Meera")]
    cls = client.post("/api/classes", json={"name": "ML", "subject": "ML"}, headers=prof).json()
    for s in students:
        client.post("/api/classes/join", json={"code": cls["joinCode"]}, headers=s)
    members = client.get(f"/api/classes/{cls['id']}/members", headers=prof).json()
    # Two TAs, so with the instructor there are three examiners: one per student, all at the start time.
    tas = [login(n, f"{n.lower()}@school.edu", role="instructor") for n in ("Tara", "Tom")]
    for ta in tas:
        me = client.get("/api/users/me", headers=ta).json()
        client.post(f"/api/classes/{cls['id']}/tas", json={"userId": me["id"]}, headers=prof)
    return {
        "prof": prof,
        "tas": tas,
        "students": students,
        "cls": cls,
        "ids": {m["name"]: m["id"] for m in members},
    }


def create(client, setup, audience="whole_class"):
    res = client.post(
        f"/api/classes/{setup['cls']['id']}/vivas", json={"audience": audience}, headers=setup["prof"]
    )
    assert res.status_code == 201, res.text
    return res.json()


def ready_body(viva, **overrides):
    """A complete setup, built from the viva as returned by the API.
    Students are shared out round-robin over all staff (one each in the 3-examiner fixture)."""
    students = (
        overrides.get("studentIds")
        or [s["id"] for s in viva["students"]]
        or [p["id"] for p in viva["unallocated"] + [s["student"] for s in viva["slots"]]]
    )
    examiners = [e["id"] for e in viva["staff"]]
    body = {
        "conductedBy": "staff",
        "breakMinutes": 5,
        "examinerIds": examiners,
        "allocation": [
            {"studentId": sid, "examinerId": examiners[i % len(examiners)]} for i, sid in enumerate(students)
        ],
        "title": "Mid-term viva",
        "assignmentId": viva["assignmentId"],
        "studentIds": [s["id"] for s in viva["students"]],
        "startsAt": iso(timedelta(days=1)),
        "endsAt": iso(timedelta(days=1, hours=3)),
        "durationMinutes": 20,
        "interviewInstructions": "Ask about their projects first.",
        "evaluationCriteria": viva["evaluationCriteria"],
        "reportFormat": "Score, strengths, gaps, next steps.",
        "summaryStats": viva["summaryStats"],
    }
    return {**body, **overrides}


def test_new_viva_is_draft_with_defaults(client, setup):
    viva = create(client, setup)
    assert viva["status"] == "draft" and viva["phase"] == "draft"
    assert viva["studentCount"] == 3
    assert len(viva["evaluationCriteria"]) == 3
    assert "average_score" in viva["summaryStats"]


def test_new_viva_links_latest_assignment(client, setup):
    body = {"title": "Resumes", "deadline": iso(timedelta(days=1))}
    a = client.post(f"/api/classes/{setup['cls']['id']}/assignments", json=body, headers=setup["prof"]).json()
    viva = create(client, setup)
    assert viva["assignmentId"] == a["id"] and viva["assignmentTitle"] == "Resumes"


def test_schedule_requires_complete_setup(client, setup):
    viva = create(client, setup)
    res = client.post(f"/api/vivas/{viva['id']}/schedule", headers=setup["prof"])
    assert res.status_code == 400
    assert "interview instructions" in res.json()["detail"] and "start time" in res.json()["detail"]

    assert (
        client.put(f"/api/vivas/{viva['id']}", json=ready_body(viva), headers=setup["prof"]).status_code
        == 200
    )
    res = client.post(f"/api/vivas/{viva['id']}/schedule", headers=setup["prof"])
    assert res.status_code == 200, res.text
    assert res.json()["phase"] == "upcoming"

    listed = client.get(f"/api/classes/{setup['cls']['id']}/vivas", headers=setup["prof"]).json()
    assert [v["phase"] for v in listed] == ["upcoming"]


def test_instructions_file_counts_as_instructions(client, setup):
    viva = create(client, setup)
    files = [("files", ("rubric.pdf", b"%PDF-1.4 rubric", "application/pdf"))]
    res = client.post(f"/api/vivas/{viva['id']}/files", files=files, headers=setup["prof"])
    assert res.status_code == 201 and res.json()[0]["kind"] == "viva_instructions"
    body = ready_body(viva, interviewInstructions="")
    client.put(f"/api/vivas/{viva['id']}", json=body, headers=setup["prof"])
    assert client.post(f"/api/vivas/{viva['id']}/schedule", headers=setup["prof"]).status_code == 200


def test_end_time_follows_start_window_and_duration(client, setup):
    viva = create(client, setup)
    body = ready_body(viva, durationMinutes=30)
    res = client.put(f"/api/vivas/{viva['id']}", json=body, headers=setup["prof"]).json()
    starts = datetime.fromisoformat(res["startsAt"])
    assert datetime.fromisoformat(res["joinClosesAt"]) - starts == timedelta(minutes=5)
    assert datetime.fromisoformat(res["endsAt"]) - starts == timedelta(minutes=35)


def test_selected_students(client, setup):
    viva = create(client, setup, audience="selected")
    assert viva["studentCount"] == 0
    ids = setup["ids"]
    body = ready_body(viva, studentIds=[ids["Asha"], ids["Meera"]])
    res = client.put(f"/api/vivas/{viva['id']}", json=body, headers=setup["prof"])
    assert res.status_code == 200, res.text
    assert [s["name"] for s in res.json()["students"]] == ["Asha", "Meera"]

    # Keeping one student and swapping the other must not clash with the unique constraint.
    body = ready_body(viva, studentIds=[ids["Meera"], ids["Ravi"]])
    res = client.put(f"/api/vivas/{viva['id']}", json=body, headers=setup["prof"])
    assert [s["name"] for s in res.json()["students"]] == ["Meera", "Ravi"]

    stats = client.get(f"/api/vivas/{viva['id']}/stats", headers=setup["prof"]).json()
    assert stats["assignedCount"] == 2


def test_selected_viva_needs_students(client, setup):
    viva = create(client, setup, audience="selected")
    client.put(f"/api/vivas/{viva['id']}", json=ready_body(viva), headers=setup["prof"])
    res = client.post(f"/api/vivas/{viva['id']}/schedule", headers=setup["prof"])
    assert res.status_code == 400 and "pick at least one student" in res.json()["detail"]


def test_cannot_pick_outsiders(client, setup, login):
    login("Out", "out@school.edu", role="student")
    viva = create(client, setup, audience="selected")
    res = client.put(
        f"/api/vivas/{viva['id']}", json=ready_body(viva, studentIds=["nope"]), headers=setup["prof"]
    )
    assert res.status_code == 400


def test_stats_show_resume_readiness(client, setup):
    body = {"title": "Resumes", "deadline": iso(timedelta(days=1))}
    a = client.post(f"/api/classes/{setup['cls']['id']}/assignments", json=body, headers=setup["prof"]).json()
    client.post(
        f"/api/assignments/{a['id']}/submission",
        files=[("files", ("cv.pdf", b"%PDF-1.4", "application/pdf"))],
        headers=setup["students"][0],
    )
    viva = create(client, setup)
    stats = client.get(f"/api/vivas/{viva['id']}/stats", headers=setup["prof"]).json()
    assert (stats["assignedCount"], stats["resumesReady"], stats["completedCount"]) == (3, 1, 0)
    assert stats["averageScore"] is None
    assert {r["student"]["name"]: r["resumeStatus"] for r in stats["students"]}["Asha"] == "submitted"


def test_unschedule_and_delete(client, setup):
    viva = create(client, setup)
    client.put(f"/api/vivas/{viva['id']}", json=ready_body(viva), headers=setup["prof"])
    client.post(f"/api/vivas/{viva['id']}/schedule", headers=setup["prof"])
    res = client.post(f"/api/vivas/{viva['id']}/unschedule", headers=setup["prof"])
    assert res.json()["phase"] == "draft"
    assert client.delete(f"/api/vivas/{viva['id']}", headers=setup["prof"]).status_code == 204
    assert client.get(f"/api/vivas/{viva['id']}", headers=setup["prof"]).status_code == 404


def test_students_cannot_see_vivas(client, setup):
    viva = create(client, setup)
    student = setup["students"][0]
    assert client.get(f"/api/vivas/{viva['id']}", headers=student).status_code == 404
    assert client.get(f"/api/classes/{setup['cls']['id']}/vivas", headers=student).status_code == 404
    res = client.post(
        f"/api/classes/{setup['cls']['id']}/vivas", json={"audience": "selected"}, headers=student
    )
    assert res.status_code == 404


def test_material_upload_and_delete(client, setup):
    cls_id = setup["cls"]["id"]
    files = [("files", ("syllabus.pdf", b"%PDF-1.4 syllabus", "application/pdf"))]
    up = client.post(f"/api/classes/{cls_id}/files", files=files, headers=setup["prof"])
    assert up.status_code == 201, up.text
    file_id = up.json()[0]["id"]
    assert client.delete(f"/api/files/{file_id}", headers=setup["prof"]).status_code == 204
    assert client.get(f"/api/classes/{cls_id}/files", headers=setup["prof"]).json() == []


def scheduled(client, setup):
    viva = create(client, setup)
    client.put(f"/api/vivas/{viva['id']}", json=ready_body(viva), headers=setup["prof"])
    res = client.post(f"/api/vivas/{viva['id']}/schedule", headers=setup["prof"])
    assert res.status_code == 200, res.text
    return res.json()


def at(monkeypatch, when: datetime):
    """Pretend the current time is `when`."""
    monkeypatch.setattr(viva_service, "utcnow", lambda: when)


def test_join_window_is_strict(client, setup, monkeypatch):
    viva = scheduled(client, setup)
    starts = datetime.fromisoformat(viva["startsAt"])
    asha, ravi, meera = setup["students"]
    join = lambda h: client.post(f"/api/vivas/{viva['id']}/join", headers=h)  # noqa: E731

    at(monkeypatch, starts - timedelta(minutes=1))
    assert join(asha).status_code == 400  # not open yet

    at(monkeypatch, starts + timedelta(minutes=2))
    res = join(asha)
    assert res.status_code == 200, res.text
    assert datetime.fromisoformat(res.json()["endsAt"]) - starts == timedelta(minutes=22)

    at(monkeypatch, starts + timedelta(minutes=5))
    assert join(ravi).status_code == 200  # exactly at the 5-minute mark still counts

    at(monkeypatch, starts + timedelta(minutes=5, seconds=1))
    res = join(meera)
    assert res.status_code == 403 and "within 5 minutes" in res.json()["detail"]
    assert join(asha).status_code == 200  # already in: can reopen during their time

    stats = client.get(f"/api/vivas/{viva['id']}/stats", headers=setup["prof"]).json()
    status = {r["student"]["name"]: r["vivaStatus"] for r in stats["students"]}
    assert status == {"Asha": "joined", "Ravi": "joined", "Meera": "missed"}
    assert (stats["joinedCount"], stats["missedCount"], stats["joinWindowMinutes"]) == (2, 1, 5)


def test_before_window_closes_nobody_is_missed(client, setup, monkeypatch):
    viva = scheduled(client, setup)
    at(monkeypatch, datetime.fromisoformat(viva["startsAt"]) + timedelta(minutes=3))
    stats = client.get(f"/api/vivas/{viva['id']}/stats", headers=setup["prof"]).json()
    assert stats["missedCount"] == 0
    assert {r["vivaStatus"] for r in stats["students"]} == {"not_started"}


def test_only_assigned_students_can_join(client, setup, login, monkeypatch):
    viva = create(client, setup, audience="selected")
    ids = setup["ids"]
    client.put(
        f"/api/vivas/{viva['id']}", json=ready_body(viva, studentIds=[ids["Asha"]]), headers=setup["prof"]
    )
    viva = client.post(f"/api/vivas/{viva['id']}/schedule", headers=setup["prof"]).json()
    at(monkeypatch, datetime.fromisoformat(viva["startsAt"]) + timedelta(minutes=1))
    asha, ravi, _ = setup["students"]
    assert client.post(f"/api/vivas/{viva['id']}/join", headers=ravi).status_code == 404
    assert client.post(f"/api/vivas/{viva['id']}/join", headers=asha).status_code == 200


def test_drafts_cannot_be_joined(client, setup):
    viva = create(client, setup)
    assert client.post(f"/api/vivas/{viva['id']}/join", headers=setup["students"][0]).status_code == 404


def test_student_viva_view_and_feedback(client, setup, monkeypatch):
    viva = scheduled(client, setup)
    starts = datetime.fromisoformat(viva["startsAt"])
    asha = setup["students"][0]
    cls_id = setup["cls"]["id"]

    mine = client.get(f"/api/classes/{cls_id}/my-vivas", headers=asha).json()
    assert [(m["id"], m["myStatus"]) for m in mine] == [(viva["id"], "upcoming")]
    assert "interviewInstructions" not in mine[0]  # setup stays private

    at(monkeypatch, starts + timedelta(minutes=1))
    assert client.get(f"/api/vivas/{viva['id']}/mine", headers=asha).json()["myStatus"] == "open"
    client.post(f"/api/vivas/{viva['id']}/join", headers=asha)
    assert client.get(f"/api/vivas/{viva['id']}/mine", headers=asha).json()["myStatus"] == "in_progress"
    # Staff vivas: in progress until the examiner ends it (or long after the viva is over).
    at(monkeypatch, starts + timedelta(minutes=30))
    assert client.get(f"/api/vivas/{viva['id']}/mine", headers=asha).json()["myStatus"] == "in_progress"
    at(monkeypatch, starts + timedelta(hours=2))
    assert client.get(f"/api/vivas/{viva['id']}/mine", headers=asha).json()["myStatus"] == "attended"
    assert (
        client.get(f"/api/vivas/{viva['id']}/mine", headers=setup["students"][1]).json()["myStatus"]
        == "missed"
    )

    url = f"/api/vivas/{viva['id']}/students/{setup['ids']['Asha']}/feedback"
    files = [("attachments", ("report.pdf", b"%PDF-1.4 report", "application/pdf"))]
    res = client.put(
        url, data={"feedback": "Strong on design, weak on testing."}, files=files, headers=setup["prof"]
    )
    assert res.status_code == 200, res.text
    assert client.put(url, data={"feedback": "x"}, headers=asha).status_code == 404  # students can't send

    fb = client.get(f"/api/vivas/{viva['id']}/mine", headers=asha).json()["feedback"]
    assert fb["feedback"].startswith("Strong") and fb["files"][0]["name"] == "report.pdf"
    assert client.get(f"/api/files/{fb['files'][0]['id']}/download", headers=asha).status_code == 200
    assert (
        client.get(f"/api/files/{fb['files'][0]['id']}/download", headers=setup["students"][1]).status_code
        == 404
    )

    stats = client.get(f"/api/vivas/{viva['id']}/stats", headers=setup["prof"]).json()
    assert {r["student"]["name"]: bool(r["feedback"]) for r in stats["students"]}["Asha"] is True


def test_students_dont_see_draft_vivas(client, setup):
    create(client, setup)
    assert (
        client.get(f"/api/classes/{setup['cls']['id']}/my-vivas", headers=setup["students"][0]).json() == []
    )
