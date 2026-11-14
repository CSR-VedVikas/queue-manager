"""AI dashboard summary. Claude is replaced by a fake client, so these tests
need no API key and cost nothing; they check what we send, how answers and
failures reach the user, and that the cache and daily cap hold."""

import json
from types import SimpleNamespace

import anthropic
import httpx2
import pytest

from app.config import get_settings
from app.main import app
from app.services import insights
from tests.conftest import signup

GOOD = {
    "headline": "Waits were short except mid-morning.",
    "points": ["Typical wait was 8 min.", "The line peaked at 10:00.", "6% of people left before being called."],
    "suggestion": "Open a second counter from 09:30 to 11:00.",
}


class FakeClient:
    """Stands in for anthropic.Anthropic: records each request and returns
    a canned response (or raises a canned error)."""

    def __init__(self, payload=GOOD, stop_reason="end_turn", error=None):
        self.calls = []
        self.payload, self.stop_reason, self.error = payload, stop_reason, error
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        text = self.payload if isinstance(self.payload, str) else json.dumps(self.payload)
        return SimpleNamespace(
            stop_reason=self.stop_reason,
            model=kwargs["model"],
            content=[SimpleNamespace(type="thinking", thinking=""), SimpleNamespace(type="text", text=text)],
            usage=SimpleNamespace(input_tokens=900, output_tokens=150),
        )


@pytest.fixture(autouse=True)
def fresh_state():
    insights.reset_state()
    yield
    app.dependency_overrides.pop(insights.get_client, None)


def use(client):
    app.dependency_overrides[insights.get_client] = lambda: client
    return client


def with_activity(client, auth, queue_id, label="Asha"):
    """One person served and one waiting, so the period isn't empty."""
    client.post(f"/api/queues/{queue_id}/tokens", json={"label": label}, headers=auth)
    client.post(f"/api/queues/{queue_id}/serve-next", headers=auth)
    client.post(f"/api/queues/{queue_id}/tokens", json={"label": "Bilal"}, headers=auth)


def ask(client, auth, **params):
    return client.post("/api/analytics/insights", params={"range": "24h", "tz": "Asia/Kolkata", **params}, headers=auth)


def test_features_reports_whether_a_key_is_set(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "anthropic_api_key", None)
    assert client.get("/api/features").json() == {"ai_summaries": False}
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-test")
    assert client.get("/api/features").json() == {"ai_summaries": True}


def test_without_a_key_the_feature_is_off(client, auth, queue_id):
    use(None)
    with_activity(client, auth, queue_id)
    res = ask(client, auth)
    assert res.status_code == 503
    assert res.json()["detail"] == "AI summaries aren't turned on for this server."


def test_requires_sign_in(client):
    use(FakeClient())
    assert client.post("/api/analytics/insights").status_code == 401


def test_summary_is_returned_and_request_is_well_formed(client, auth, queue_id):
    fake = use(FakeClient())
    with_activity(client, auth, queue_id, label="Asha Verma")
    res = ask(client, auth)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["headline"] == GOOD["headline"]
    assert body["points"] == GOOD["points"]
    assert body["suggestion"] == GOOD["suggestion"]
    assert body["model"] == "claude-fable-5-2"
    assert body["cached"] is False

    sent = fake.calls[0]
    assert sent["model"] == "claude-fable-5-2"
    assert sent["fallbacks"] == "default"
    assert "server-side-fallback-2026-07-01" in sent["betas"]
    assert sent["output_config"]["effort"] == "low"
    assert sent["output_config"]["format"]["type"] == "json_schema"
    assert "thinking" not in sent and "temperature" not in sent  # both rejected by Fable 5.2

    # Only numbers leave the server: no names people gave, no account email.
    prompt = sent["messages"][0]["content"]
    assert "Asha" not in prompt and "Bilal" not in prompt and "@example.com" not in prompt
    facts = json.loads(prompt.split("<dashboard>")[1].split("</dashboard>")[0])
    assert facts["totals"]["served"] == 0 and facts["totals"]["waiting_now"] == 1
    assert facts["period"] == "last 24 hours" and facts["timezone"] == "Asia/Kolkata"


def test_same_view_within_the_hour_is_cached(client, auth, queue_id):
    fake = use(FakeClient())
    with_activity(client, auth, queue_id)
    first, second = ask(client, auth), ask(client, auth)
    assert first.json()["cached"] is False and second.json()["cached"] is True
    assert second.json()["headline"] == first.json()["headline"]
    assert len(fake.calls) == 1
    ask(client, auth, range="7d")  # a different view is a new question
    assert len(fake.calls) == 2


def test_single_queue_scope_uses_its_name(client, auth, queue_id):
    fake = use(FakeClient())
    with_activity(client, auth, queue_id)
    assert ask(client, auth, queue_id=queue_id).status_code == 200
    facts = json.loads(fake.calls[0]["messages"][0]["content"].split("<dashboard>")[1].split("</dashboard>")[0])
    assert facts["scope"] == "Front desk"
    assert "per_queue" not in facts


def test_another_managers_queue_is_404_and_costs_nothing(client, auth, queue_id):
    fake = use(FakeClient())
    with_activity(client, auth, queue_id)
    other = signup(client, email="b@example.com")
    assert ask(client, other, queue_id=queue_id).status_code == 404
    assert fake.calls == []


def test_empty_period_needs_no_model_call(client, auth, queue_id):
    fake = use(FakeClient())
    res = ask(client, auth)
    assert res.status_code == 200
    assert res.json()["model"] is None and res.json()["points"] == []
    assert fake.calls == []


def test_refusal_is_reported_plainly(client, auth, queue_id):
    use(FakeClient(stop_reason="refusal", payload=""))
    with_activity(client, auth, queue_id)
    res = ask(client, auth)
    assert res.status_code == 502
    assert "declined" in res.json()["detail"]


def test_unreadable_answer_is_an_error_not_a_crash(client, auth, queue_id):
    use(FakeClient(payload="not json"))
    with_activity(client, auth, queue_id)
    res = ask(client, auth)
    assert res.status_code == 502
    assert res.json()["detail"] == "The AI's answer couldn't be read. Try again."


def test_long_answers_are_trimmed_to_four_points(client, auth, queue_id):
    use(FakeClient(payload={**GOOD, "points": [f"p{i}" for i in range(7)]}))
    with_activity(client, auth, queue_id)
    assert ask(client, auth).json()["points"] == ["p0", "p1", "p2", "p3"]


def test_network_failure_maps_to_a_clear_message(client, auth, queue_id):
    req = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    use(FakeClient(error=anthropic.APIConnectionError(request=req)))
    with_activity(client, auth, queue_id)
    res = ask(client, auth)
    assert res.status_code == 502
    assert res.json()["detail"] == "Couldn't reach the AI service. Try again in a minute."


def test_rate_limit_maps_to_busy(client, auth, queue_id):
    req = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    err = anthropic.RateLimitError("rate limited", response=httpx2.Response(429, request=req), body=None)
    use(FakeClient(error=err))
    with_activity(client, auth, queue_id)
    res = ask(client, auth)
    assert res.status_code == 503
    assert res.json()["detail"] == "The AI service is busy. Try again in a minute."


def test_daily_cap_stops_further_calls(client, auth, queue_id, monkeypatch):
    monkeypatch.setattr(get_settings(), "insights_daily_limit", 2)
    fake = use(FakeClient())
    with_activity(client, auth, queue_id)
    assert ask(client, auth, range="24h").status_code == 200
    assert ask(client, auth, range="7d").status_code == 200
    capped = ask(client, auth, range="30d")
    assert capped.status_code == 429
    assert "limit" in capped.json()["detail"]
    assert len(fake.calls) == 2
    assert ask(client, auth, range="24h").json()["cached"] is True  # cached answers still work
