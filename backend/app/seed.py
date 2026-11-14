"""Create a demo account with two weeks of realistic queue history.

    python -m app.seed                      # always rebuild
    python -m app.seed --if-stale-hours 1   # rebuild only if older than 1 h

Safe to re-run: it deletes the demo account and rebuilds it. The history is
produced by simulating a single-server queue (one counter per queue): people
arrive at random, the counter serves them first-come first-served, and some
give up if they wait too long. The current state at the end is live, so the
demo opens with people waiting and someone at the counter.
"""

import argparse
import random
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select

from app.db import SessionLocal
from app.models import Manager, Queue, Token, TokenEvent, TokenStatus
from app.security import hash_password

DEMO_EMAIL = "demo@queuemanager.app"
DEMO_PASSWORD = "demo1234"
TZ = ZoneInfo("Asia/Kolkata")
DAYS = 14

# name, average arrivals per open hour, average service minutes
QUEUES = [
    ("Front Desk", 9, 5.0),
    ("Pharmacy", 7, 6.5),
    ("Lab Reports", 4, 9.0),
]
NAMES = ["Aarav", "Diya", "Kabir", "Ananya", "Vihaan", "Isha", "Arjun", "Meera", "Rohan", "Saanvi",
         "Aditya", "Kavya", "Reyansh", "Tara", "Ishaan", "Nisha", "Dev", "Pooja", "Kiran", "Riya"]


def _busyness(local_hour: float) -> float:
    """Arrival-rate multiplier through the day: morning and evening peaks."""
    if 10 <= local_hour < 12.5:
        return 1.6
    if 16.5 <= local_hour < 18.5:
        return 1.4
    if 13 <= local_hour < 14:
        return 0.6  # lunch lull
    return 1.0


def _arrivals(rng: random.Random, rate_per_hour: float, now: datetime) -> list[datetime]:
    """Arrival instants over the last DAYS days, during opening hours
    (09:00-19:00 local), plus a busy final half hour so the demo is live."""
    times = []
    today = now.astimezone(TZ).date()
    for back in range(DAYS, -1, -1):
        day = today - timedelta(days=back)
        t = datetime(day.year, day.month, day.day, 9, 0, tzinfo=TZ)
        close = datetime(day.year, day.month, day.day, 19, 0, tzinfo=TZ)
        while t < close:
            # Exponential gaps between arrivals = a Poisson arrival process.
            rate = rate_per_hour * _busyness(t.hour + t.minute / 60)
            t += timedelta(hours=rng.expovariate(rate))
            if t < close and t < now - timedelta(minutes=35):
                times.append(t.astimezone(UTC))
    t = now - timedelta(minutes=35)
    while True:
        t += timedelta(hours=rng.expovariate(rate_per_hour * 1.8))
        if t >= now - timedelta(minutes=1):
            break
        times.append(t)
    return times


def _simulate(rng, queue_id, arrivals, service_minutes, now):
    tokens, events = [], []
    counter_free_at = datetime.min.replace(tzinfo=UTC)
    for number, arrived in enumerate(arrivals, start=1):
        tok = Token(queue_id=queue_id, number=number, position=number, created_at=arrived,
                    label=rng.choice(NAMES) if rng.random() < 0.85 else None)
        events.append((tok, "created", arrived))
        starts = max(arrived, counter_free_at)
        patience = timedelta(minutes=rng.uniform(15, 60))

        if starts > arrived + patience and arrived + patience <= now:
            tok.status, tok.cancelled_at = TokenStatus.cancelled, arrived + patience
            events.append((tok, "cancelled", tok.cancelled_at))
        elif starts > now:
            tok.status = TokenStatus.waiting
        else:
            service = timedelta(minutes=max(1.0, rng.gauss(service_minutes, service_minutes / 3)))
            tok.serving_at = starts
            events.append((tok, "serving", starts))
            counter_free_at = starts + service
            if counter_free_at <= now:
                tok.status, tok.served_at = TokenStatus.served, counter_free_at
                events.append((tok, "served", counter_free_at))
            else:
                tok.status = TokenStatus.serving
        tokens.append(tok)
    return tokens, events


def seed(now: datetime | None = None) -> None:
    now = now or datetime.now(UTC)
    rng = random.Random(2026)
    with SessionLocal() as db:
        db.execute(delete(Manager).where(Manager.email == DEMO_EMAIL))  # cascades
        manager = Manager(name="Demo Manager", email=DEMO_EMAIL, password_hash=hash_password(DEMO_PASSWORD))
        db.add(manager)
        db.flush()
        for name, rate, service in QUEUES:
            queue = Queue(manager_id=manager.id, name=name, created_at=now - timedelta(days=DAYS + 1))
            db.add(queue)
            db.flush()
            tokens, events = _simulate(rng, queue.id, _arrivals(rng, rate, now), service, now)
            queue.next_token_number = len(tokens) + 1
            db.add_all(tokens)
            db.flush()
            db.add_all(TokenEvent(queue_id=queue.id, token_id=t.id, type=kind, at=at) for t, kind, at in events)
        db.commit()
    print(f"Demo account ready: {DEMO_EMAIL} / {DEMO_PASSWORD}")


def demo_age(now: datetime) -> timedelta | None:
    """How long ago the demo account was built, or None if it doesn't exist."""
    with SessionLocal() as db:
        created = db.execute(select(Manager.created_at).where(Manager.email == DEMO_EMAIL)).scalar_one_or_none()
    return None if created is None else now - created


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--if-stale-hours", type=float, default=None,
                        help="only rebuild if the demo is missing or older than this")
    args = parser.parse_args()
    now = datetime.now(UTC)
    if args.if_stale_hours is not None:
        age = demo_age(now)
        if age is not None and age < timedelta(hours=args.if_stale_hours):
            print(f"Demo data is {age.total_seconds() / 3600:.1f} h old; keeping it.")
            raise SystemExit(0)
    seed(now)
