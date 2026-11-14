"""CORS: the main frontend URL and this project's other Vercel deployment URLs
are allowed; other sites are not. Uses a standalone app so the test does not
depend on the environment the main app was started with."""

import pytest
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from app.config import check_origin_regex

VERCEL_PATTERN = r"^https://frontend(-[a-z0-9-]+)?-ved-projects10\.vercel\.app$"


def make_client() -> TestClient:
    app = FastAPI()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["https://frontend-seven-psi-28.vercel.app"],
        allow_origin_regex=VERCEL_PATTERN,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.post("/api/auth/login")
    def login():
        return {}

    return TestClient(app)


def preflight(client: TestClient, origin: str):
    return client.options(
        "/api/auth/login",
        headers={"Origin": origin, "Access-Control-Request-Method": "POST",
                 "Access-Control-Request-Headers": "content-type"},
    )


@pytest.mark.parametrize("origin", [
    "https://frontend-seven-psi-28.vercel.app",
    "https://frontend-qcw41nhiv-ved-projects10.vercel.app",
    "https://frontend-git-main-ved-projects10.vercel.app",
])
def test_project_origins_allowed(origin):
    res = preflight(make_client(), origin)
    assert res.status_code == 200
    assert res.headers["access-control-allow-origin"] == origin


@pytest.mark.parametrize("origin", [
    "https://evil.example.com",
    "https://frontend-x-ved-projects10.vercel.app.evil.com",
    "http://frontend-qcw41nhiv-ved-projects10.vercel.app",
    "https://attacker-ved-projects10.vercel.app",
])
def test_other_origins_refused(origin):
    res = preflight(make_client(), origin)
    assert "access-control-allow-origin" not in res.headers


def test_unsafe_patterns_rejected():
    check_origin_regex(VERCEL_PATTERN)
    check_origin_regex(None)
    for bad in [r".*", r"^https://.*\.vercel\.app$", r"https://x\.app", r"^http://x\.app$"]:
        with pytest.raises(RuntimeError):
            check_origin_regex(bad)
