def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_dev_login_creates_user_without_role(client):
    res = client.post("/api/auth/dev-login", json={"name": "Asha Rao", "email": "Asha@School.edu"})
    assert res.status_code == 200
    body = res.json()
    assert body["accessToken"]
    assert body["user"]["email"] == "asha@school.edu"
    assert body["user"]["role"] is None


def test_personal_email_rejected(client):
    res = client.post("/api/auth/dev-login", json={"name": "A", "email": "a@gmail.com"})
    assert res.status_code == 400
    assert "school" in res.json()["detail"]


def test_returning_user_keeps_role(client, login):
    login("Asha", "asha@school.edu", role="instructor")
    res = client.post("/api/auth/dev-login", json={"name": "Asha", "email": "asha@school.edu"})
    assert res.json()["user"]["role"] == "instructor"


def test_me_requires_token(client):
    assert client.get("/api/users/me").status_code == 401
    bad = {"Authorization": "Bearer not-a-token"}
    assert client.get("/api/users/me", headers=bad).status_code == 401


def test_role_can_only_be_set_once(client, login):
    headers = login("Ravi", "ravi@school.edu", role="student")
    res = client.put("/api/users/me/role", json={"role": "instructor"}, headers=headers)
    assert res.status_code == 409


def test_invalid_role_rejected(client, login):
    headers = login("Ravi", "ravi@school.edu")
    assert client.put("/api/users/me/role", json={"role": "admin"}, headers=headers).status_code == 422
