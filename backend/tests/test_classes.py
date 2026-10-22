import pytest

NEW_CLASS = {"name": "ML - Section A", "subject": "Machine Learning", "description": ""}


@pytest.fixture
def instructor(login):
    return login("Prof Iyer", "iyer@school.edu", role="instructor")


@pytest.fixture
def student(login):
    return login("Asha", "asha@school.edu", role="student")


def create(client, headers):
    res = client.post("/api/classes", json=NEW_CLASS, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


def test_instructor_creates_class_with_code(client, instructor):
    cls = create(client, instructor)
    assert len(cls["joinCode"]) == 6
    assert cls["instructorName"] == "Prof Iyer"
    assert cls["memberCount"] == 0


def test_student_cannot_create_class(client, student):
    assert client.post("/api/classes", json=NEW_CLASS, headers=student).status_code == 403


def test_user_without_role_is_blocked(client, login):
    headers = login("New", "new@school.edu")
    assert client.get("/api/classes/mine", headers=headers).status_code == 403


def test_join_flow(client, instructor, student):
    cls = create(client, instructor)

    # Lowercase code works; join code is hidden from students.
    res = client.post("/api/classes/join", json={"code": cls["joinCode"].lower()}, headers=student)
    assert res.status_code == 200
    assert res.json()["joinCode"] is None
    assert res.json()["memberCount"] == 1

    assert (
        client.post("/api/classes/join", json={"code": cls["joinCode"]}, headers=student).status_code == 409
    )

    mine = client.get("/api/classes/mine", headers=student).json()
    assert [c["id"] for c in mine["joined"]] == [cls["id"]]
    assert mine["teaching"] == []

    teaching = client.get("/api/classes/mine", headers=instructor).json()["teaching"]
    assert teaching[0]["memberCount"] == 1


def test_wrong_code(client, student):
    res = client.post("/api/classes/join", json={"code": "ZZZZZZ"}, headers=student)
    assert res.status_code == 404


def test_owner_cannot_join_own_class(client, instructor):
    cls = create(client, instructor)
    assert (
        client.post("/api/classes/join", json={"code": cls["joinCode"]}, headers=instructor).status_code
        == 409
    )


def test_instructor_can_join_another_class(client, instructor, login):
    other = login("Prof Rao", "rao@school.edu", role="instructor")
    cls = create(client, other)
    assert (
        client.post("/api/classes/join", json={"code": cls["joinCode"]}, headers=instructor).status_code
        == 200
    )


def test_class_visible_only_to_owner_and_members(client, instructor, student, login):
    cls = create(client, instructor)
    outsider = login("Outsider", "out@school.edu", role="student")

    assert client.get(f"/api/classes/{cls['id']}", headers=instructor).json()["joinCode"] == cls["joinCode"]
    assert client.get(f"/api/classes/{cls['id']}", headers=outsider).status_code == 404

    client.post("/api/classes/join", json={"code": cls["joinCode"]}, headers=student)
    assert client.get(f"/api/classes/{cls['id']}", headers=student).status_code == 200


def test_blank_name_rejected(client, instructor):
    res = client.post("/api/classes", json={**NEW_CLASS, "name": ""}, headers=instructor)
    assert res.status_code == 422
