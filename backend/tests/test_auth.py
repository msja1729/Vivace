from app.core.config import get_settings
from app.core.security import hash_password


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


def _register(client, email="asha@school.edu", password="correct-horse", role="student"):
    return client.post(
        "/api/auth/register", json={"name": "Asha Rao", "email": email, "password": password, "role": role}
    )


def test_register_then_login(client):
    res = _register(client, email="Asha@School.edu", role="instructor")
    assert res.status_code == 201
    assert res.json()["role"] == "instructor"
    assert "accessToken" not in res.json()  # registering doesn't sign you in

    res = client.post("/api/auth/login", json={"email": "asha@school.edu", "password": "correct-horse"})
    assert res.status_code == 200
    headers = {"Authorization": f"Bearer {res.json()['accessToken']}"}
    assert client.get("/api/users/me", headers=headers).json()["email"] == "asha@school.edu"


def test_login_rejects_wrong_password_and_unknown_email(client):
    _register(client)
    for email, password in [("asha@school.edu", "wrong-password"), ("nobody@school.edu", "correct-horse")]:
        res = client.post("/api/auth/login", json={"email": email, "password": password})
        assert res.status_code == 401
        assert res.json()["detail"] == "Incorrect email or password."


def test_register_rules(client):
    assert _register(client).status_code == 201
    assert _register(client).status_code == 409  # same email again
    assert _register(client, email="a@gmail.com").status_code == 400  # school emails only
    assert _register(client, email="b@school.edu", password="short").status_code == 422


def test_password_less_login_is_off_outside_dev_mode(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "auth_mode", "password")
    res = client.post("/api/auth/dev-login", json={"name": "A", "email": "a@school.edu"})
    assert res.status_code == 404


def test_passwords_are_hashed(client):
    from app.core.security import verify_password

    assert verify_password("correct-horse", hash_password("correct-horse"))
    assert not verify_password("correct-horsf", hash_password("correct-horse"))
    assert not verify_password("anything", None)
