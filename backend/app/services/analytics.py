"""Dashboard metrics, computed in SQL from the timestamps on each token.

Nothing here is a stored counter: every number is derived from what
actually happened, so it can't drift out of sync. See DESIGN.md section 6.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import text
from sqlalchemy.orm import Session

Range = Literal["24h", "7d", "30d"]


@dataclass(frozen=True)
class Window:
    first_local: datetime  # naive local time of the first bucket's start
    last_local: datetime   # naive local time of the last bucket's start
    step: timedelta
    since: datetime        # first bucket start, as an aware UTC instant
    granularity: Literal["hour", "day"]


# Browsers still report some timezones by their old names (Chrome on many
# Indian machines says "Asia/Calcutta"). Python knows the aliases, but a
# PostgreSQL built against a trimmed system tz database may not, so always
# send the current name.
_LEGACY_TZ = {
    "Asia/Calcutta": "Asia/Kolkata",
    "Asia/Katmandu": "Asia/Kathmandu",
    "Asia/Saigon": "Asia/Ho_Chi_Minh",
    "Asia/Rangoon": "Asia/Yangon",
    "Asia/Dacca": "Asia/Dhaka",
    "Asia/Thimbu": "Asia/Thimphu",
    "Asia/Ulan_Bator": "Asia/Ulaanbaatar",
    "Europe/Kiev": "Europe/Kyiv",
    "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
    "Atlantic/Faeroe": "Atlantic/Faroe",
    "Pacific/Truk": "Pacific/Chuuk",
    "Pacific/Ponape": "Pacific/Pohnpei",
}

_pg_timezones: set[str] | None = None


def resolve_timezone(name: str | None) -> ZoneInfo:
    name = _LEGACY_TZ.get(name or "", name) or "UTC"
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def _sql_safe_timezone(db: Session, tz: ZoneInfo) -> ZoneInfo:
    """Use the zone only if PostgreSQL knows it too; otherwise UTC.
    The list is read once per process and cached."""
    global _pg_timezones
    if _pg_timezones is None:
        _pg_timezones = set(db.execute(text("SELECT name FROM pg_timezone_names")).scalars())
    return tz if tz.key in _pg_timezones else ZoneInfo("UTC")


def build_window(range_: Range, tz: ZoneInfo, now: datetime) -> Window:
    """Bucket boundaries in the viewer's local time, so 'today' and the
    hourly buckets line up with their clock rather than UTC."""
    local_now = now.astimezone(tz).replace(tzinfo=None)
    if range_ == "24h":
        step, count = timedelta(hours=1), 24
        last = local_now.replace(minute=0, second=0, microsecond=0)
        granularity = "hour"
    else:
        step, count = timedelta(days=1), (7 if range_ == "7d" else 30)
        last = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
        granularity = "day"
    first = last - step * (count - 1)
    since = first.replace(tzinfo=tz).astimezone(UTC)
    return Window(first, last, step, since, granularity)


def _scope(queue_id: int | None) -> str:
    # Built from a fixed string, never from user input; values are bound.
    return "q.manager_id = :manager_id" + (" AND q.id = :queue_id" if queue_id is not None else "")


def dashboard(
    db: Session,
    manager_id: int,
    queue_id: int | None,
    range_: Range,
    tz_name: str | None,
    now: datetime | None = None,
) -> dict:
    now = now or datetime.now(UTC)
    tz = _sql_safe_timezone(db, resolve_timezone(tz_name))
    w = build_window(range_, tz, now)
    params = {
        "manager_id": manager_id, "queue_id": queue_id, "since": w.since, "now": now,
        "tz": tz.key, "first": w.first_local, "last": w.last_local, "step": w.step,
    }
    scope = _scope(queue_id)
    scoped_cte = f"""
        scoped AS (
            SELECT t.* FROM tokens t JOIN queues q ON q.id = t.queue_id
            WHERE {scope}
        )
    """

    # ---- headline numbers
    wait = "EXTRACT(EPOCH FROM (serving_at - created_at))"
    summary = db.execute(text(f"""
        WITH {scoped_cte}
        SELECT
            count(*) FILTER (WHERE created_at >= :since)                       AS arrived,
            count(*) FILTER (WHERE served_at >= :since)                        AS served,
            count(*) FILTER (WHERE cancelled_at >= :since)                     AS cancelled,
            avg({wait}) FILTER (WHERE serving_at >= :since)                    AS avg_wait,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY {wait})
                FILTER (WHERE serving_at >= :since)                            AS median_wait,
            percentile_cont(0.9) WITHIN GROUP (ORDER BY {wait})
                FILTER (WHERE serving_at >= :since)                            AS p90_wait,
            avg(EXTRACT(EPOCH FROM (served_at - serving_at)))
                FILTER (WHERE served_at >= :since)                             AS avg_service,
            count(*) FILTER (WHERE status = 'waiting')                         AS waiting_now,
            max(EXTRACT(EPOCH FROM (:now - created_at)))
                FILTER (WHERE status = 'waiting')                              AS longest_wait_now
        FROM scoped
    """), params).mappings().one()

    finished = (summary["served"] or 0) + (summary["cancelled"] or 0)

    # ---- time series, one row per bucket.
    #
    # Peak queue length uses a sweep line: every arrival is a +1 event and
    # every departure from the line (called to the counter, or cancelled) is
    # a -1 event. Sorting all events by time and taking a running sum gives
    # the exact queue length after every event, in O(n log n). A bucket's
    # peak is the largest running value inside it, or the value carried in
    # from before it if nothing happened during the bucket.
    series_rows = db.execute(text(f"""
        WITH {scoped_cte},
        deltas AS (
            SELECT created_at AS at, 1 AS d FROM scoped WHERE created_at <= :now
            UNION ALL
            SELECT COALESCE(serving_at, cancelled_at), -1 FROM scoped
            WHERE COALESCE(serving_at, cancelled_at) <= :now
        ),
        running AS (
            -- At equal timestamps, process departures (-1) before arrivals.
            SELECT at, sum(d) OVER (ORDER BY at, d ROWS UNBOUNDED PRECEDING) AS len
            FROM deltas
        ),
        buckets AS (
            SELECT gs                              AS local_start,
                   gs AT TIME ZONE :tz             AS start_at,
                   (gs + :step) AT TIME ZONE :tz   AS end_at
            FROM generate_series(CAST(:first AS timestamp), CAST(:last AS timestamp),
                                 CAST(:step AS interval)) AS gs
        )
        SELECT
            b.local_start,
            (SELECT count(*) FROM scoped s
              WHERE s.created_at >= b.start_at AND s.created_at < b.end_at)      AS arrived,
            (SELECT count(*) FROM scoped s
              WHERE s.served_at >= b.start_at AND s.served_at < b.end_at)        AS served,
            (SELECT avg(EXTRACT(EPOCH FROM (s.serving_at - s.created_at))) FROM scoped s
              WHERE s.serving_at >= b.start_at AND s.serving_at < b.end_at)      AS avg_wait,
            GREATEST(
                COALESCE((SELECT r.len FROM running r WHERE r.at < b.start_at
                          ORDER BY r.at DESC LIMIT 1), 0),
                COALESCE((SELECT max(r.len) FROM running r
                          WHERE r.at >= b.start_at AND r.at < b.end_at), 0)
            )                                                                    AS peak_queue_length
        FROM buckets b
        ORDER BY b.local_start
    """), params).mappings().all()

    # ---- busiest hours of the day (arrivals by local hour)
    hour_rows = db.execute(text(f"""
        WITH {scoped_cte}
        SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE :tz)::int AS hour, count(*) AS arrived
        FROM scoped
        WHERE created_at >= :since
        GROUP BY 1
    """), params).mappings().all()
    by_hour = {r["hour"]: r["arrived"] for r in hour_rows}

    # ---- per-queue breakdown (always across all of this manager's queues)
    queue_rows = db.execute(text("""
        SELECT q.id, q.name,
               count(t.id) FILTER (WHERE t.status = 'waiting')                    AS waiting_now,
               count(t.id) FILTER (WHERE t.served_at >= :since)                   AS served,
               count(t.id) FILTER (WHERE t.cancelled_at >= :since)                AS cancelled,
               avg(EXTRACT(EPOCH FROM (t.serving_at - t.created_at)))
                   FILTER (WHERE t.serving_at >= :since)                          AS avg_wait
        FROM queues q
        LEFT JOIN tokens t ON t.queue_id = q.id
        WHERE q.manager_id = :manager_id
        GROUP BY q.id, q.name
        ORDER BY lower(q.name)
    """), params).mappings().all()

    def num(v):
        return None if v is None else round(float(v), 1)

    return {
        "range": range_,
        "timezone": tz.key,
        "granularity": w.granularity,
        "since": w.since,
        "generated_at": now,
        "summary": {
            "arrived": summary["arrived"],
            "served": summary["served"],
            "cancelled": summary["cancelled"],
            "cancellation_rate": round(summary["cancelled"] / finished, 3) if finished else None,
            "avg_wait_sec": num(summary["avg_wait"]),
            "median_wait_sec": num(summary["median_wait"]),
            "p90_wait_sec": num(summary["p90_wait"]),
            "avg_service_sec": num(summary["avg_service"]),
            "waiting_now": summary["waiting_now"],
            "longest_wait_now_sec": num(summary["longest_wait_now"]),
        },
        "series": [
            {
                "bucket": r["local_start"].isoformat(),
                "arrived": r["arrived"],
                "served": r["served"],
                "avg_wait_sec": num(r["avg_wait"]),
                "peak_queue_length": r["peak_queue_length"],
            }
            for r in series_rows
        ],
        "arrivals_by_hour": [{"hour": h, "arrived": by_hour.get(h, 0)} for h in range(24)],
        "queues": [
            {
                "id": r["id"],
                "name": r["name"],
                "waiting_now": r["waiting_now"],
                "served": r["served"],
                "cancelled": r["cancelled"],
                "avg_wait_sec": num(r["avg_wait"]),
            }
            for r in queue_rows
        ],
    }
