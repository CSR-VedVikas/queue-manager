"""Analytics on hand-built history where the right answers are known."""

from datetime import UTC, datetime, timedelta

from app.db import SessionLocal
from app.models import Manager, Queue
from app.services import analytics
from app.services import queue_service as qs

NOW = datetime(2026, 11, 10, 12, 0, tzinfo=UTC)  # 17:30 in Asia/Kolkata


def _history():
    """Three customers, 10 / 20 / 30 minute waits, 5-minute services, plus
    one cancellation and one person still waiting."""
    with SessionLocal() as db:
        m = Manager(name="M", email="m@example.com", password_hash="x")
        db.add(m)
        db.flush()
        q = Queue(manager_id=m.id, name="Desk")
        db.add(q)
        db.flush()
        base = NOW - timedelta(hours=3)
        for i, wait in enumerate([10, 20, 30]):
            arrive = base + timedelta(minutes=40 * i)
            qs.add_token(db, q, f"c{i}", now=arrive)
            qs.serve_next(db, q, now=arrive + timedelta(minutes=wait))
            qs.complete_current(db, q, now=arrive + timedelta(minutes=wait + 5))
        cancelled = qs.add_token(db, q, "gone", now=NOW - timedelta(minutes=50))
        qs.cancel_token(db, q, cancelled.id, now=NOW - timedelta(minutes=40))
        qs.add_token(db, q, "still waiting", now=NOW - timedelta(minutes=15))
        db.commit()
        return m.id, q.id


def test_summary_numbers():
    manager_id, queue_id = _history()
    with SessionLocal() as db:
        d = analytics.dashboard(db, manager_id, queue_id, "24h", "Asia/Kolkata", now=NOW)
    s = d["summary"]
    assert s["arrived"] == 5
    assert s["served"] == 3
    assert s["cancelled"] == 1
    assert s["cancellation_rate"] == 0.25
    assert s["avg_wait_sec"] == 20 * 60
    assert s["median_wait_sec"] == 20 * 60
    assert s["avg_service_sec"] == 5 * 60
    assert s["waiting_now"] == 1
    assert s["longest_wait_now_sec"] == 15 * 60


def test_series_buckets_follow_the_viewers_timezone():
    manager_id, queue_id = _history()
    with SessionLocal() as db:
        d = analytics.dashboard(db, manager_id, queue_id, "24h", "Asia/Kolkata", now=NOW)
    series = d["series"]
    assert len(series) == 24
    # The last bucket starts at the current *local* hour (17:00 IST), not UTC.
    assert series[-1]["bucket"] == "2026-11-10T17:00:00"
    assert sum(b["arrived"] for b in series) == 5
    assert sum(b["served"] for b in series) == 3
    # Current hour (11:30-12:00 UTC): the line was empty, then one person joined.
    assert series[-1]["peak_queue_length"] == 1


def test_peak_queue_length_sweep():
    """Three people overlap in line, then all are called: peak is 3, and an
    hour with no events carries in the length from before it."""
    with SessionLocal() as db:
        m = Manager(name="M", email="p@example.com", password_hash="x")
        db.add(m); db.flush()
        q = Queue(manager_id=m.id, name="Peak"); db.add(q); db.flush()
        t0 = datetime(2026, 11, 10, 9, 0, tzinfo=UTC)
        for i in range(3):
            qs.add_token(db, q, None, now=t0 + timedelta(minutes=i))       # 09:00, 09:01, 09:02
        for i in range(3):
            qs.serve_next(db, q, now=t0 + timedelta(minutes=10 + i))       # leave line 09:10..09:12
        qs.complete_current(db, q, now=t0 + timedelta(minutes=20))
        qs.add_token(db, q, "late", now=datetime(2026, 11, 10, 10, 30, tzinfo=UTC))
        db.commit()
        d = analytics.dashboard(db, m.id, q.id, "24h", "UTC",
                                now=datetime(2026, 11, 10, 11, 30, tzinfo=UTC))
    by_hour = {b["bucket"][11:16]: b["peak_queue_length"] for b in d["series"]}
    assert by_hour["09:00"] == 3   # all three overlapped
    assert by_hour["10:00"] == 1   # 'late' joined at 10:30
    assert by_hour["11:00"] == 1   # no events this hour: carried in from 10:00
    assert by_hour["08:00"] == 0


def test_empty_queue_returns_nulls_not_errors():
    with SessionLocal() as db:
        m = Manager(name="M", email="e@example.com", password_hash="x")
        db.add(m)
        db.commit()
        d = analytics.dashboard(db, m.id, None, "7d", "Asia/Kolkata", now=NOW)
    assert d["summary"]["avg_wait_sec"] is None
    assert d["summary"]["cancellation_rate"] is None
    assert len(d["series"]) == 7


def test_unknown_timezone_falls_back_to_utc():
    assert analytics.resolve_timezone("Not/AZone").key == "UTC"
    assert analytics.resolve_timezone(None).key == "UTC"


def test_analytics_endpoint(client, auth, queue_id):
    res = client.get(f"/api/analytics?queue_id={queue_id}&range=30d&tz=Asia/Kolkata", headers=auth)
    assert res.status_code == 200
    assert len(res.json()["series"]) == 30
    assert client.get("/api/analytics?range=1y", headers=auth).status_code == 422


def test_legacy_timezone_names_work(client, auth, queue_id):
    """Some browsers report India as 'Asia/Calcutta' (the old name). PostgreSQL
    builds without legacy aliases reject it; this once crashed the dashboard."""
    res = client.get(f"/api/analytics?queue_id={queue_id}&range=24h&tz=Asia/Calcutta", headers=auth)
    assert res.status_code == 200
    assert res.json()["timezone"] == "Asia/Kolkata"


def test_server_errors_still_carry_cors_headers(client, auth, monkeypatch):
    """A crash must reach the browser as a readable 500, not as a fake
    'network error' caused by missing CORS headers."""
    from app.routers import queues as queues_router

    def boom(*args, **kwargs):
        raise RuntimeError("simulated failure")

    monkeypatch.setattr(queues_router.analytics, "dashboard", boom)
    res = client.get("/api/analytics", headers={**auth, "Origin": "http://localhost:5173"})
    assert res.status_code == 500
    assert res.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert "problem" in res.json()["detail"]
