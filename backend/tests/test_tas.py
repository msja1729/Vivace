from datetime import UTC, datetime, timedelta

import pytest


@pytest.fixture
def setup(client, login):
    prof = login("Prof Iyer", "iyer@iisc.ac.in", role="instructor")
    asha = login("Asha", "asha@iisc.ac.in", role="student")
    ta = login("Tara TA", "tara@iisc.ac.in", role="student")  # not in the class
    cls = client.post("/api/classes", json={"name": "ML", "subject": "ML"}, headers=prof).json()
    client.post("/api/classes/join", json={"code": cls["joinCode"]}, headers=asha)
    return {"prof": prof, "asha": asha, "ta": ta, "cls": cls}


def user_id(client, headers):
    return client.get("/api/users/me", headers=headers).json()["id"]


def add(client, setup, who):
    res = client.post(
        f"/api/classes/{setup['cls']['id']}/tas", json={"userId": user_id(client, who)}, headers=setup["prof"]
    )
    assert res.status_code == 201, res.text
    return res.json()


def test_owner_finds_users_by_email(client, setup):
    url = f"/api/classes/{setup['cls']['id']}/ta-candidates"
    found = client.get(url, params={"q": "tara@iisc"}, headers=setup["prof"]).json()
    assert [p["email"] for p in found] == ["tara@iisc.ac.in"]
    assert client.get(url, params={"q": "ta"}, headers=setup["prof"]).json() == []  # too short
    # The owner never shows up; existing TAs drop out of the results.
    assert all(
        p["email"] != "iyer@iisc.ac.in"
        for p in client.get(url, params={"q": "iisc"}, headers=setup["prof"]).json()
    )
    add(client, setup, setup["ta"])
    assert client.get(url, params={"q": "tara"}, headers=setup["prof"]).json() == []


def test_ta_gets_instructor_powers(client, setup):
    tas = add(client, setup, setup["ta"])
    assert [t["name"] for t in tas] == ["Tara TA"]
    cls_id, ta = setup["cls"]["id"], setup["ta"]

    cls = client.get(f"/api/classes/{cls_id}", headers=ta).json()
    assert cls["myRole"] == "ta" and cls["joinCode"]
    assert [c["id"] for c in client.get("/api/classes/mine", headers=ta).json()["assisting"]] == [cls_id]

    assert client.get(f"/api/classes/{cls_id}/members", headers=ta).status_code == 200
    body = {"title": "Resumes", "deadline": (datetime.now(UTC) + timedelta(days=1)).isoformat()}
    assert client.post(f"/api/classes/{cls_id}/assignments", json=body, headers=ta).status_code == 201
    assert (
        client.post(f"/api/classes/{cls_id}/vivas", json={"audience": "whole_class"}, headers=ta).status_code
        == 201
    )
    assert client.get(f"/api/classes/{cls_id}/files", headers=ta).status_code == 200


def test_only_owner_manages_tas(client, setup):
    add(client, setup, setup["ta"])
    cls_id = setup["cls"]["id"]
    asha_id = user_id(client, setup["asha"])
    # A TA can see the TA list but not change it or search users.
    assert client.get(f"/api/classes/{cls_id}/tas", headers=setup["ta"]).status_code == 200
    assert (
        client.post(f"/api/classes/{cls_id}/tas", json={"userId": asha_id}, headers=setup["ta"]).status_code
        == 403
    )
    assert (
        client.get(
            f"/api/classes/{cls_id}/ta-candidates", params={"q": "asha"}, headers=setup["ta"]
        ).status_code
        == 403
    )
    # Students get 404 on all of it.
    assert client.get(f"/api/classes/{cls_id}/tas", headers=setup["asha"]).status_code == 404


def test_student_made_ta_stops_counting_as_student(client, setup):
    cls_id = setup["cls"]["id"]
    add(client, setup, setup["asha"])
    assert client.get(f"/api/classes/{cls_id}/members", headers=setup["prof"]).json() == []
    assert client.get(f"/api/classes/{cls_id}", headers=setup["asha"]).json()["myRole"] == "ta"

    # Removing the TA role makes them a student again.
    asha_id = user_id(client, setup["asha"])
    assert client.delete(f"/api/classes/{cls_id}/tas/{asha_id}", headers=setup["prof"]).status_code == 204
    assert [
        m["name"] for m in client.get(f"/api/classes/{cls_id}/members", headers=setup["prof"]).json()
    ] == ["Asha"]


def test_removed_ta_loses_access(client, setup):
    add(client, setup, setup["ta"])
    cls_id = setup["cls"]["id"]
    ta_id = user_id(client, setup["ta"])
    client.delete(f"/api/classes/{cls_id}/tas/{ta_id}", headers=setup["prof"])
    assert client.get(f"/api/classes/{cls_id}", headers=setup["ta"]).status_code == 404


def test_cannot_add_twice_or_unknown(client, setup):
    add(client, setup, setup["ta"])
    cls_id = setup["cls"]["id"]
    again = {"userId": user_id(client, setup["ta"])}
    assert client.post(f"/api/classes/{cls_id}/tas", json=again, headers=setup["prof"]).status_code == 409
    assert (
        client.post(f"/api/classes/{cls_id}/tas", json={"userId": "nope"}, headers=setup["prof"]).status_code
        == 400
    )
