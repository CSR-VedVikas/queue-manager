from tests.conftest import signup


def test_signup_then_me(client):
    headers = signup(client, "Asha@Example.com")
    res = client.get("/api/auth/me", headers=headers)
    assert res.status_code == 200
    assert res.json()["email"] == "asha@example.com"  # stored lower-case


def test_duplicate_email_is_rejected_case_insensitively(client):
    signup(client, "asha@example.com")
    res = client.post("/api/auth/signup",
                      json={"name": "Other", "email": "ASHA@example.com", "password": "password123"})
    assert res.status_code == 409


def test_login_success_and_failure_messages_match(client):
    signup(client, "asha@example.com", "password123")
    ok = client.post("/api/auth/login", json={"email": "asha@example.com", "password": "password123"})
    assert ok.status_code == 200 and ok.json()["access_token"]

    wrong_pw = client.post("/api/auth/login", json={"email": "asha@example.com", "password": "nope"})
    no_user = client.post("/api/auth/login", json={"email": "ghost@example.com", "password": "nope"})
    assert wrong_pw.status_code == no_user.status_code == 401
    # Same message either way: the API doesn't reveal which emails exist.
    assert wrong_pw.json() == no_user.json()


def test_protected_routes_need_a_valid_token(client):
    assert client.get("/api/queues").status_code == 401
    assert client.get("/api/queues", headers={"Authorization": "Bearer garbage"}).status_code == 401


def test_password_rules(client):
    short = client.post("/api/auth/signup", json={"name": "A", "email": "a@x.com", "password": "short"})
    assert short.status_code == 422
    too_long = client.post("/api/auth/signup", json={"name": "A", "email": "a@x.com", "password": "x" * 73})
    assert too_long.status_code == 422  # bcrypt only reads 72 bytes; refuse rather than truncate
