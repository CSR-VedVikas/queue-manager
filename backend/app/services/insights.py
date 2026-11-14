"""AI summary of the dashboard, written by Claude (Fable 5.2 by default).

The model only ever sees the numbers the dashboard already shows: no names,
no token labels, no emails. It returns a headline, a few observations and
one suggestion as JSON (structured output), which the frontend renders.

Cost control, because the demo account is public:
  * one answer per manager / queue / range / timezone per clock hour (cache);
  * a daily cap on model calls across the whole server;
  * an empty period is answered without calling the model at all.
"""

from __future__ import annotations

import json
import logging
import threading
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any

from app.config import get_settings

log = logging.getLogger("queue_manager.insights")

SYSTEM_PROMPT = """\
You help the manager of a walk-in service counter (a clinic front desk, a \
pharmacy, a lab) understand how their queues went. You get the dashboard \
numbers as JSON.

Write for a busy manager reading on a phone: plain words, minutes, and times \
of day on a 24-hour clock in the given timezone. Say "typical wait" for the \
median and "long wait" for the 90th percentile; never use statistics terms. \
Use only the numbers provided. If the data doesn't show something, leave it \
out rather than guess.

headline: one sentence with the single most useful thing to know.
points: two to four short observations, each built on a number from the data.
suggestion: one concrete change to try, tied to what the data shows."""

OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "headline": {"type": "string"},
        "points": {"type": "array", "items": {"type": "string"}},
        "suggestion": {"type": "string"},
    },
    "required": ["headline", "points", "suggestion"],
    "additionalProperties": False,
}

PERIOD_NAMES = {"24h": "last 24 hours", "7d": "last 7 days", "30d": "last 30 days"}
MAX_POINTS = 4


class InsightsError(Exception):
    """A failure the user should see, with the HTTP status to send."""

    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


# ---------- client

_client: Any = None
_client_lock = threading.Lock()


def get_client() -> Any | None:
    """FastAPI dependency: the shared Anthropic client, or None when no API
    key is configured (the feature is then off)."""
    settings = get_settings()
    if not settings.anthropic_api_key:
        return None
    global _client
    with _client_lock:
        if _client is None:
            import anthropic

            # 40 s per attempt, one retry: stays inside the frontend's 90 s.
            _client = anthropic.Anthropic(api_key=settings.anthropic_api_key, timeout=40.0, max_retries=1)
    return _client


# ---------- cache and daily cap (in memory: one server process on the free tier)

_cache: dict[tuple, dict] = {}
_calls_by_day: dict[date, int] = {}
_state_lock = threading.Lock()


def reset_state() -> None:
    """For tests."""
    with _state_lock:
        _cache.clear()
        _calls_by_day.clear()


def _hour_key(now: datetime) -> str:
    return now.astimezone(UTC).strftime("%Y%m%d%H")


def _reserve_call(now: datetime, limit: int) -> None:
    today = now.astimezone(UTC).date()
    with _state_lock:
        for day in [d for d in _calls_by_day if d != today]:
            del _calls_by_day[day]
        used = _calls_by_day.get(today, 0)
        if used >= limit:
            raise InsightsError(429, "Today's limit for AI summaries has been reached. Try again tomorrow.")
        _calls_by_day[today] = used + 1


# ---------- prompt

def _minutes(sec: float | None) -> float | None:
    return None if sec is None else round(sec / 60, 1)


def build_facts(dashboard: dict, scope_name: str | None) -> dict:
    """The dashboard, reshaped into what a reader of the page sees: minutes
    instead of seconds, readable keys, no internal ids."""
    s = dashboard["summary"]
    facts: dict[str, Any] = {
        "scope": scope_name or "all queues",
        "period": PERIOD_NAMES.get(dashboard["range"], dashboard["range"]),
        "timezone": dashboard["timezone"],
        "totals": {
            "arrived": s["arrived"],
            "served": s["served"],
            "cancelled_or_no_show": s["cancelled"],
            "cancellation_rate": s["cancellation_rate"],
            "typical_wait_min": _minutes(s["median_wait_sec"]),
            "long_wait_min": _minutes(s["p90_wait_sec"]),
            "average_wait_min": _minutes(s["avg_wait_sec"]),
            "average_time_at_counter_min": _minutes(s["avg_service_sec"]),
            "waiting_now": s["waiting_now"],
            "longest_current_wait_min": _minutes(s["longest_wait_now_sec"]),
        },
        f"per_{dashboard['granularity']}": [
            {
                "start": b["bucket"],
                "arrived": b["arrived"],
                "served": b["served"],
                "average_wait_min": _minutes(b["avg_wait_sec"]),
                "most_people_waiting_at_once": b["peak_queue_length"],
            }
            for b in dashboard["series"]
        ],
        "arrivals_by_hour_of_day": {f"{h['hour']:02d}:00": h["arrived"] for h in dashboard["arrivals_by_hour"]},
    }
    if scope_name is None and dashboard.get("queues"):
        facts["per_queue"] = [
            {
                "queue": q["name"],
                "waiting_now": q["waiting_now"],
                "served": q["served"],
                "cancelled_or_no_show": q["cancelled"],
                "average_wait_min": _minutes(q["avg_wait_sec"]),
            }
            for q in dashboard["queues"]
        ]
    return facts


# ---------- the call

@dataclass(frozen=True)
class Request:
    manager_id: int
    queue_id: int | None
    range: str
    timezone: str


def summarize(client: Any | None, req: Request, dashboard: dict, scope_name: str | None,
              now: datetime | None = None) -> dict:
    now = now or datetime.now(UTC)
    if client is None:
        raise InsightsError(503, "AI summaries aren't turned on for this server.")

    s = dashboard["summary"]
    if s["arrived"] == 0 and s["served"] == 0 and s["waiting_now"] == 0:
        return {"headline": "Nothing happened in this period yet, so there is nothing to summarize.",
                "points": [], "suggestion": None, "model": None, "generated_at": now, "cached": False}

    key = (req.manager_id, req.queue_id, req.range, req.timezone, _hour_key(now))
    with _state_lock:
        hit = _cache.get(key)
    if hit is not None:
        return {**hit, "cached": True}

    settings = get_settings()
    _reserve_call(now, settings.insights_daily_limit)
    result = _call_model(client, settings.insights_model, build_facts(dashboard, scope_name))
    result["generated_at"] = now

    with _state_lock:
        current = _hour_key(now)
        for k in [k for k in _cache if k[-1] != current]:
            del _cache[k]
        _cache[key] = result
    return {**result, "cached": False}


def _call_model(client: Any, model: str, facts: dict) -> dict:
    import anthropic

    try:
        response = client.beta.messages.create(
            model=model,
            max_tokens=8000,
            # If the model declines, the API reruns the request on a fallback
            # model it picks for the refusal category, inside the same call.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={
                "effort": "low",  # a short summary of given numbers; no deep reasoning needed
                "format": {"type": "json_schema", "schema": OUTPUT_SCHEMA},
            },
            system=SYSTEM_PROMPT,
            messages=[{
                "role": "user",
                "content": "Summarize this period for the manager.\n\n<dashboard>\n"
                           + json.dumps(facts, separators=(",", ":"))
                           + "\n</dashboard>",
            }],
        )
    except anthropic.RateLimitError:
        raise InsightsError(503, "The AI service is busy. Try again in a minute.")
    except (anthropic.AuthenticationError, anthropic.PermissionDeniedError):
        log.error("Anthropic API key was rejected; check ANTHROPIC_API_KEY")
        raise InsightsError(503, "AI summaries aren't set up correctly on this server.")
    except anthropic.APITimeoutError:
        raise InsightsError(504, "The AI service took too long to answer. Try again.")
    except anthropic.APIConnectionError:
        raise InsightsError(502, "Couldn't reach the AI service. Try again in a minute.")
    except anthropic.APIStatusError as e:
        log.error("Anthropic API error %s: %s", e.status_code, e.message)
        raise InsightsError(502, "The AI service ran into a problem. Try again in a minute.")

    usage = getattr(response, "usage", None)
    log.info("insights model=%s stop=%s in=%s out=%s", getattr(response, "model", model),
             response.stop_reason, getattr(usage, "input_tokens", "?"), getattr(usage, "output_tokens", "?"))

    if response.stop_reason == "refusal":
        raise InsightsError(502, "The AI declined to summarize this period. The numbers on the page are unaffected.")
    if response.stop_reason == "max_tokens":
        raise InsightsError(502, "The AI's answer was cut short. Try again.")

    text = next((b.text for b in response.content if getattr(b, "type", None) == "text"), None)
    try:
        data = json.loads(text or "")
        headline = str(data["headline"]).strip()
        points = [str(p).strip() for p in data["points"] if str(p).strip()][:MAX_POINTS]
        suggestion = str(data["suggestion"]).strip() or None
    except (ValueError, KeyError, TypeError):
        log.error("Unexpected insights payload: %r", (text or "")[:500])
        raise InsightsError(502, "The AI's answer couldn't be read. Try again.")
    if not headline:
        raise InsightsError(502, "The AI's answer was empty. Try again.")

    return {"headline": headline, "points": points, "suggestion": suggestion,
            "model": getattr(response, "model", model)}
