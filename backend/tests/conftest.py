import os

# Point the app at the test database *before* it is imported.
os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://postgres@localhost:5432/queue_manager_test"
)
os.environ.setdefault("ENV", "test")

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.db import engine  # noqa: E402
from app.main import app  # noqa: E402

BACKEND_DIR = os.path.dirname(os.path.dirname(__file__))


@pytest.fixture(scope="session", autouse=True)
def schema():
    """Build the schema from the real migrations, so tests also prove the
    migrations produce what the code expects."""
    cfg = Config(os.path.join(BACKEND_DIR, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(BACKEND_DIR, "alembic"))
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    yield


@pytest.fixture(autouse=True)
def clean_tables():
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE managers, queues, tokens, token_events RESTART IDENTITY CASCADE"))
    yield


@pytest.fixture
def client():
    return TestClient(app)


def signup(client: TestClient, email: str = "a@example.com", password: str = "password123") -> dict:
    res = client.post("/api/auth/signup", json={"name": "Asha", "email": email, "password": password})
    assert res.status_code == 201, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


@pytest.fixture
def auth(client):
    return signup(client)


@pytest.fixture
def queue_id(client, auth):
    res = client.post("/api/queues", json={"name": "Front desk"}, headers=auth)
    assert res.status_code == 201, res.text
    return res.json()["id"]


def add_tokens(client, auth, queue_id, *labels):
    data = None
    for label in labels:
        res = client.post(f"/api/queues/{queue_id}/tokens", json={"label": label}, headers=auth)
        assert res.status_code == 201, res.text
        data = res.json()
    return data


def waiting_labels(detail: dict) -> list[str]:
    return [t["label"] for t in detail["waiting"]]
