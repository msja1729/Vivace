from datetime import UTC, datetime, timedelta

import pytest

PDF = ("resume.pdf", b"%PDF-1.4 fake resume", "application/pdf")


def iso(delta: timedelta) -> str:
    return (datetime.now(UTC) + delta).isoformat()


@pytest.fixture
def setup(client, login):
    """An instructor's class with two students, and a resume assignment due tomorrow."""
    prof = login("Prof Iyer", "iyer@school.edu", role="instructor")
    asha = login("Asha", "asha@school.edu", role="student")
    ravi = login("Ravi", "ravi@school.edu", role="student")
    cls = client.post("/api/classes", json={"name": "ML", "subject": "ML"}, headers=prof).json()
    for s in (asha, ravi):
        client.post("/api/classes/join", json={"code": cls["joinCode"]}, headers=s)
    res = client.post(
        f"/api/classes/{cls['id']}/assignments",
        json={"title": "Resume + projects", "instructions": "PDF only", "deadline": iso(timedelta(days=1))},
        headers=prof,
    )
    assert res.status_code == 201, res.text
    return {"prof": prof, "asha": asha, "ravi": ravi, "cls": cls, "assignment": res.json()}


def submit(client, headers, assignment_id, **extra):
    files = [("files", PDF), ("files", ("chat.md", b"# claude session", "text/markdown"))]
    data = {"githubLinks": "https://github.com/asha/viva-bot\nhttps://github.com/asha/ml-notes", **extra}
    return client.post(
        f"/api/assignments/{assignment_id}/submission", files=files, data=data, headers=headers
    )


def test_members_list(client, setup):
    members = client.get(f"/api/classes/{setup['cls']['id']}/members", headers=setup["prof"]).json()
    assert [m["name"] for m in members] == ["Asha", "Ravi"]
    # Students can't see the member list.
    assert client.get(f"/api/classes/{setup['cls']['id']}/members", headers=setup["asha"]).status_code == 404


def test_new_assignment_counts(setup):
    a = setup["assignment"]
    assert (a["totalStudents"], a["submittedCount"], a["missingCount"]) == (2, 0, 2)
    assert a["isOpen"] is True


def test_submission_updates_dashboard(client, setup):
    a_id = setup["assignment"]["id"]
    res = submit(client, setup["asha"], a_id)
    assert res.status_code == 200, res.text
    assert res.json()["githubLinks"] == [
        "https://github.com/asha/viva-bot",
        "https://github.com/asha/ml-notes",
    ]
    assert [f["name"] for f in res.json()["files"]] == ["resume.pdf", "chat.md"]

    detail = client.get(f"/api/assignments/{a_id}", headers=setup["prof"]).json()
    assert (detail["submittedCount"], detail["missingCount"], detail["lateCount"]) == (1, 1, 0)
    statuses = {r["student"]["name"]: r["status"] for r in detail["students"]}
    assert statuses == {"Asha": "submitted", "Ravi": "missing"}

    # The instructor can download the resume.
    resume = next(f for f in detail["students"][0]["submission"]["files"] if f["name"] == "resume.pdf")
    dl = client.get(f"/api/files/{resume['id']}/download", headers=setup["prof"])
    assert dl.status_code == 200 and dl.content == PDF[1]
    # Another student can't.
    assert client.get(f"/api/files/{resume['id']}/download", headers=setup["ravi"]).status_code == 404


def test_resubmission_replaces_files(client, setup, upload_dir):
    a_id = setup["assignment"]["id"]
    submit(client, setup["asha"], a_id)
    submit(client, setup["asha"], a_id)
    files = client.get(f"/api/classes/{setup['cls']['id']}/files", headers=setup["prof"]).json()
    assert sorted(f["kind"] for f in files) == ["submission", "submission"]
    assert files[0]["context"] == "Resume + projects · Asha"
    assert len([p for p in upload_dir.rglob("*") if p.is_file()]) == 2


def test_no_submissions_after_deadline(client, setup):
    a_id = setup["assignment"]["id"]
    assert submit(client, setup["asha"], a_id).status_code == 200
    body = {"title": "Resume + projects", "deadline": iso(-timedelta(hours=1))}
    assert client.put(f"/api/assignments/{a_id}", json=body, headers=setup["prof"]).status_code == 200
    res = submit(client, setup["ravi"], a_id)
    assert res.status_code == 403 and "deadline" in res.json()["detail"]
    assert submit(client, setup["asha"], a_id).status_code == 403  # no resubmitting either
    mine = client.get(f"/api/assignments/{a_id}/mine", headers=setup["ravi"]).json()
    assert (mine["myStatus"], mine["isOpen"]) == ("missed", False)


def test_turn_in_needs_a_file(client, setup):
    res = client.post(
        f"/api/assignments/{setup['assignment']['id']}/submission",
        data={"githubLinks": "https://github.com/x/y"},
        headers=setup["asha"],
    )
    assert res.status_code == 400


def test_rejects_wrong_file_type_and_bad_links(client, setup):
    a_id = setup["assignment"]["id"]
    res = client.post(
        f"/api/assignments/{a_id}/submission",
        files=[("files", ("resume.exe", b"MZ", "application/octet-stream"))],
        headers=setup["asha"],
    )
    assert res.status_code == 400 and "only" in res.json()["detail"]
    assert submit(client, setup["asha"], a_id, githubLinks="not a link").status_code == 400


def test_outsiders_cannot_submit_or_manage(client, setup, login):
    outsider = login("Out", "out@school.edu", role="student")
    a_id = setup["assignment"]["id"]
    assert submit(client, outsider, a_id).status_code == 404
    assert client.get(f"/api/assignments/{a_id}", headers=setup["asha"]).status_code == 404
    assert client.delete(f"/api/assignments/{a_id}", headers=setup["asha"]).status_code == 404


def test_delete_assignment_removes_files(client, setup, upload_dir):
    a_id = setup["assignment"]["id"]
    submit(client, setup["asha"], a_id)
    assert client.delete(f"/api/assignments/{a_id}", headers=setup["prof"]).status_code == 204
    assert client.get(f"/api/classes/{setup['cls']['id']}/files", headers=setup["prof"]).json() == []
    assert not [p for p in upload_dir.rglob("*") if p.is_file()]


def test_naive_deadline_rejected(client, setup):
    res = client.post(
        f"/api/classes/{setup['cls']['id']}/assignments",
        json={"title": "x", "deadline": "2030-01-01T10:00:00"},
        headers=setup["prof"],
    )
    assert res.status_code == 422


def graded_setup(client, setup, total=50):
    a_id = setup["assignment"]["id"]
    body = {
        "title": "Resume + projects",
        "deadline": iso(timedelta(days=1)),
        "graded": True,
        "totalMarks": total,
    }
    res = client.put(f"/api/assignments/{a_id}", json=body, headers=setup["prof"])
    assert res.status_code == 200, res.text
    return a_id


def test_graded_needs_total_marks(client, setup):
    body = {"title": "x", "deadline": iso(timedelta(days=1)), "graded": True}
    res = client.post(f"/api/classes/{setup['cls']['id']}/assignments", json=body, headers=setup["prof"])
    assert res.status_code == 422


def test_return_marks_and_feedback(client, setup):
    a_id = graded_setup(client, setup)
    sub = submit(client, setup["asha"], a_id).json()
    url = f"/api/submissions/{sub['id']}/grade"

    assert client.put(url, data={"marks": "51"}, headers=setup["prof"]).status_code == 400  # over total
    assert client.put(url, data={"feedback": "Nice"}, headers=setup["prof"]).status_code == 400  # no marks
    assert (
        client.put(url, data={"marks": "40"}, headers=setup["asha"]).status_code == 404
    )  # students can't grade

    res = client.put(
        url, data={"marks": "42.5", "feedback": "  Good depth on the API design.  "}, headers=setup["prof"]
    )
    assert res.status_code == 200, res.text
    assert (res.json()["marks"], res.json()["feedback"]) == (42.5, "Good depth on the API design.")
    assert res.json()["returnedAt"]

    detail = client.get(f"/api/assignments/{a_id}", headers=setup["prof"]).json()
    assert (detail["returnedCount"], detail["averageMarks"], detail["totalMarks"]) == (1, 42.5, 50)


def test_ungraded_takes_feedback_only(client, setup):
    sub = submit(client, setup["asha"], setup["assignment"]["id"]).json()
    url = f"/api/submissions/{sub['id']}/grade"
    assert client.put(url, data={"marks": "5", "feedback": "x"}, headers=setup["prof"]).status_code == 400
    res = client.put(url, data={"feedback": "Add a README to the repo."}, headers=setup["prof"])
    assert res.status_code == 200 and res.json()["marks"] is None


def test_cannot_lower_total_below_given_marks(client, setup):
    a_id = graded_setup(client, setup)
    sub = submit(client, setup["asha"], a_id).json()
    client.put(f"/api/submissions/{sub['id']}/grade", data={"marks": "40"}, headers=setup["prof"])
    base = {"title": "Resume + projects", "deadline": iso(timedelta(days=1))}
    lower = {**base, "graded": True, "totalMarks": 30}
    assert client.put(f"/api/assignments/{a_id}", json=lower, headers=setup["prof"]).status_code == 400
    ungraded = {**base, "graded": False}
    assert client.put(f"/api/assignments/{a_id}", json=ungraded, headers=setup["prof"]).status_code == 400


def test_student_sees_own_assignment_and_returned_feedback_files(client, setup):
    a_id = graded_setup(client, setup)
    mine = client.get(f"/api/classes/{setup['cls']['id']}/my-assignments", headers=setup["asha"]).json()
    assert [(m["id"], m["myStatus"], m["submission"]) for m in mine] == [(a_id, "assigned", None)]

    sub = submit(client, setup["asha"], a_id).json()
    assert (
        client.get(f"/api/assignments/{a_id}/mine", headers=setup["asha"]).json()["myStatus"] == "turned_in"
    )

    files = [("attachments", ("marked.pdf", b"%PDF-1.4 marked", "application/pdf"))]
    res = client.put(
        f"/api/submissions/{sub['id']}/grade",
        data={"marks": "45", "feedback": "See notes"},
        files=files,
        headers=setup["prof"],
    )
    assert res.status_code == 200, res.text
    fb_file = res.json()["feedbackFiles"][0]
    assert res.json()["files"] and all(f["kind"] != "feedback" for f in res.json()["files"])

    mine = client.get(f"/api/assignments/{a_id}/mine", headers=setup["asha"]).json()
    assert mine["myStatus"] == "returned" and mine["submission"]["marks"] == 45
    # The student can open the feedback file; another student can't.
    assert client.get(f"/api/files/{fb_file['id']}/download", headers=setup["asha"]).status_code == 200
    assert client.get(f"/api/files/{fb_file['id']}/download", headers=setup["ravi"]).status_code == 404


def test_students_see_only_shared_material(client, setup):
    cls_id = setup["cls"]["id"]
    submit(client, setup["asha"], setup["assignment"]["id"])
    up = [("files", ("syllabus.pdf", b"%PDF-1.4 syllabus", "application/pdf"))]
    material = client.post(f"/api/classes/{cls_id}/files", files=up, headers=setup["prof"]).json()[0]

    listed = client.get(f"/api/classes/{cls_id}/files", headers=setup["ravi"]).json()
    assert [f["name"] for f in listed] == ["syllabus.pdf"]  # not Asha's resume
    assert client.get(f"/api/files/{material['id']}/download", headers=setup["ravi"]).status_code == 200
    assert len(client.get(f"/api/classes/{cls_id}/files", headers=setup["prof"]).json()) == 3
    # Students can't upload material.
    assert client.post(f"/api/classes/{cls_id}/files", files=up, headers=setup["ravi"]).status_code == 404


def test_turn_in_again_keeps_chosen_files(client, setup, upload_dir):
    a_id = setup["assignment"]["id"]
    first = submit(client, setup["asha"], a_id).json()["files"]
    pdf = next(f for f in first if f["name"] == "resume.pdf")
    # Keep the PDF, drop the transcript, add a zip.
    res = client.post(
        f"/api/assignments/{a_id}/submission",
        files=[("files", ("code.zip", b"PK zip", "application/zip"))],
        data={"keepFileIds": [pdf["id"]]},
        headers=setup["asha"],
    )
    assert res.status_code == 200, res.text
    assert sorted(f["name"] for f in res.json()["files"]) == ["code.zip", "resume.pdf"]
    assert len([p for p in upload_dir.rglob("*") if p.is_file()]) == 2  # transcript bytes deleted

    # Keeping nothing and adding nothing is refused.
    res = client.post(f"/api/assignments/{a_id}/submission", data={"githubLinks": ""}, headers=setup["asha"])
    assert res.status_code == 400
