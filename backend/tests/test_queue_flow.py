"""The eight requirements from the brief, one behaviour per test."""

from tests.conftest import add_tokens, signup, waiting_labels


# 1-2. Create named queues

def test_create_and_list_queues(client, auth):
    assert client.post("/api/queues", json={"name": "  Front   desk "}, headers=auth).status_code == 201
    client.post("/api/queues", json={"name": "Pharmacy"}, headers=auth)
    names = [q["name"] for q in client.get("/api/queues", headers=auth).json()]
    assert names == ["Front desk", "Pharmacy"]  # whitespace normalised


def test_queue_names_unique_per_manager_only(client, auth):
    client.post("/api/queues", json={"name": "Front desk"}, headers=auth)
    assert client.post("/api/queues", json={"name": "Front desk"}, headers=auth).status_code == 409
    other = signup(client, "b@example.com")
    assert client.post("/api/queues", json={"name": "Front desk"}, headers=other).status_code == 201


def test_blank_queue_name_rejected(client, auth):
    assert client.post("/api/queues", json={"name": "   "}, headers=auth).status_code == 422


# 3-4. Add tokens; list who's waiting

def test_tokens_get_sequential_numbers_and_join_the_back(client, auth, queue_id):
    detail = add_tokens(client, auth, queue_id, "Ravi", "Meera", None)
    assert [t["number"] for t in detail["waiting"]] == [1, 2, 3]
    assert waiting_labels(detail) == ["Ravi", "Meera", None]


# 5. Move up and down

def test_move_up_and_down(client, auth, queue_id):
    detail = add_tokens(client, auth, queue_id, "A", "B", "C")
    c = detail["waiting"][2]["id"]
    detail = client.post(f"/api/queues/{queue_id}/tokens/{c}/move", json={"direction": "up"}, headers=auth).json()
    assert waiting_labels(detail) == ["A", "C", "B"]
    detail = client.post(f"/api/queues/{queue_id}/tokens/{c}/move", json={"direction": "up"}, headers=auth).json()
    assert waiting_labels(detail) == ["C", "A", "B"]
    detail = client.post(f"/api/queues/{queue_id}/tokens/{c}/move", json={"direction": "down"}, headers=auth).json()
    assert waiting_labels(detail) == ["A", "C", "B"]


def test_cannot_move_past_the_ends(client, auth, queue_id):
    detail = add_tokens(client, auth, queue_id, "A", "B")
    first, last = detail["waiting"][0]["id"], detail["waiting"][1]["id"]
    up = client.post(f"/api/queues/{queue_id}/tokens/{first}/move", json={"direction": "up"}, headers=auth)
    down = client.post(f"/api/queues/{queue_id}/tokens/{last}/move", json={"direction": "down"}, headers=auth)
    assert up.status_code == down.status_code == 409


def test_move_skips_over_cancelled_tokens(client, auth, queue_id):
    detail = add_tokens(client, auth, queue_id, "A", "B", "C")
    a, b, c = (t["id"] for t in detail["waiting"])
    client.post(f"/api/queues/{queue_id}/tokens/{b}/cancel", headers=auth)
    detail = client.post(f"/api/queues/{queue_id}/tokens/{c}/move", json={"direction": "up"}, headers=auth).json()
    assert waiting_labels(detail) == ["C", "A"]


def test_new_token_still_joins_the_back_after_moves(client, auth, queue_id):
    detail = add_tokens(client, auth, queue_id, "A", "B")
    b = detail["waiting"][1]["id"]
    client.post(f"/api/queues/{queue_id}/tokens/{b}/move", json={"direction": "up"}, headers=auth)
    detail = add_tokens(client, auth, queue_id, "C")
    assert waiting_labels(detail) == ["B", "A", "C"]


# 6. Serve the front of the line

def test_serve_next_calls_the_front_and_completes_the_previous(client, auth, queue_id):
    add_tokens(client, auth, queue_id, "A", "B")
    d = client.post(f"/api/queues/{queue_id}/serve-next", headers=auth).json()
    assert d["serving"]["label"] == "A" and waiting_labels(d) == ["B"]

    d = client.post(f"/api/queues/{queue_id}/serve-next", headers=auth).json()
    assert d["serving"]["label"] == "B" and d["waiting"] == []
    assert d["recent"][0]["label"] == "A" and d["recent"][0]["status"] == "served"

    d = client.post(f"/api/queues/{queue_id}/serve-next", headers=auth).json()
    assert d["serving"] is None  # B finished, nobody left

    empty = client.post(f"/api/queues/{queue_id}/serve-next", headers=auth)
    assert empty.status_code == 409


def test_serve_next_respects_reordering(client, auth, queue_id):
    detail = add_tokens(client, auth, queue_id, "A", "B")
    b = detail["waiting"][1]["id"]
    client.post(f"/api/queues/{queue_id}/tokens/{b}/move", json={"direction": "up"}, headers=auth)
    d = client.post(f"/api/queues/{queue_id}/serve-next", headers=auth).json()
    assert d["serving"]["label"] == "B"


def test_complete_without_calling_next(client, auth, queue_id):
    add_tokens(client, auth, queue_id, "A", "B")
    client.post(f"/api/queues/{queue_id}/serve-next", headers=auth)
    d = client.post(f"/api/queues/{queue_id}/complete", headers=auth).json()
    assert d["serving"] is None and waiting_labels(d) == ["B"]
    assert client.post(f"/api/queues/{queue_id}/complete", headers=auth).status_code == 409


# 7. Cancel

def test_cancel_waiting_and_serving(client, auth, queue_id):
    detail = add_tokens(client, auth, queue_id, "A", "B")
    b = detail["waiting"][1]["id"]
    d = client.post(f"/api/queues/{queue_id}/tokens/{b}/cancel", headers=auth).json()
    assert waiting_labels(d) == ["A"]

    d = client.post(f"/api/queues/{queue_id}/serve-next", headers=auth).json()
    a = d["serving"]["id"]
    d = client.post(f"/api/queues/{queue_id}/tokens/{a}/cancel", headers=auth).json()  # no-show
    assert d["serving"] is None


def test_finished_tokens_cannot_change(client, auth, queue_id):
    detail = add_tokens(client, auth, queue_id, "A")
    a = detail["waiting"][0]["id"]
    client.post(f"/api/queues/{queue_id}/tokens/{a}/cancel", headers=auth)
    again = client.post(f"/api/queues/{queue_id}/tokens/{a}/cancel", headers=auth)
    move = client.post(f"/api/queues/{queue_id}/tokens/{a}/move", json={"direction": "up"}, headers=auth)
    assert again.status_code == move.status_code == 409


# Authorization: one manager can never see or touch another's queue

def test_other_managers_queue_is_invisible(client, auth, queue_id):
    detail = add_tokens(client, auth, queue_id, "A")
    token = detail["waiting"][0]["id"]
    intruder = signup(client, "intruder@example.com")
    attempts = [
        client.get(f"/api/queues/{queue_id}", headers=intruder),
        client.post(f"/api/queues/{queue_id}/tokens", json={"label": "x"}, headers=intruder),
        client.post(f"/api/queues/{queue_id}/tokens/{token}/cancel", headers=intruder),
        client.post(f"/api/queues/{queue_id}/serve-next", headers=intruder),
        client.delete(f"/api/queues/{queue_id}", headers=intruder),
        client.get(f"/api/analytics?queue_id={queue_id}", headers=intruder),
    ]
    assert all(r.status_code == 404 for r in attempts)
    assert client.get("/api/queues", headers=intruder).json() == []


def test_token_from_another_queue_is_not_found(client, auth, queue_id):
    other_q = client.post("/api/queues", json={"name": "Other"}, headers=auth).json()["id"]
    token = add_tokens(client, auth, other_q, "X")["waiting"][0]["id"]
    res = client.post(f"/api/queues/{queue_id}/tokens/{token}/cancel", headers=auth)
    assert res.status_code == 404


def test_delete_queue(client, auth, queue_id):
    add_tokens(client, auth, queue_id, "A")
    assert client.delete(f"/api/queues/{queue_id}", headers=auth).status_code == 204
    assert client.get(f"/api/queues/{queue_id}", headers=auth).status_code == 404


def test_queue_list_summary(client, auth, queue_id):
    add_tokens(client, auth, queue_id, "A", "B", "C")
    client.post(f"/api/queues/{queue_id}/serve-next", headers=auth)
    client.post(f"/api/queues/{queue_id}/serve-next", headers=auth)
    [q] = client.get("/api/queues?tz=Asia/Kolkata", headers=auth).json()
    assert q["waiting_count"] == 1
    assert q["serving"]["label"] == "B"
    assert q["served_today"] == 1
