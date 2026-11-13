"""Hammer one queue from many threads at once, then check the invariants.

Each thread uses its own database session (its own connection and
transaction), exactly like concurrent HTTP requests would. Without the
per-queue row lock these tests fail: duplicate token numbers, two tokens
'serving' at once, or the same person served twice.
"""

import random
import threading
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Manager, Queue, Token, TokenStatus
from app.services import queue_service as qs

THREADS = 12


def _setup_queue() -> tuple[int, int]:
    with SessionLocal() as db:
        m = Manager(name="M", email="m@example.com", password_hash="x")
        db.add(m)
        db.flush()
        q = Queue(manager_id=m.id, name="Q")
        db.add(q)
        db.commit()
        return m.id, q.id


def _run(fn, n: int):
    """Release n threads at the same instant to maximise overlap."""
    gate = threading.Barrier(n)
    errors: list[Exception] = []

    def worker(i):
        gate.wait()
        try:
            fn(i)
        except qs.QueueError as e:
            errors.append(e)

    with ThreadPoolExecutor(max_workers=n) as pool:
        list(pool.map(worker, range(n)))
    return errors


def _tokens(queue_id: int) -> list[Token]:
    with SessionLocal() as db:
        return list(db.execute(select(Token).where(Token.queue_id == queue_id)).scalars())


def test_concurrent_adds_never_share_a_number():
    manager_id, queue_id = _setup_queue()

    def add(i):
        with SessionLocal() as db:
            q = qs.lock_queue(db, queue_id, manager_id)
            qs.add_token(db, q, f"person {i}")
            db.commit()

    assert _run(add, THREADS * 2) == []
    numbers = sorted(t.number for t in _tokens(queue_id))
    assert numbers == list(range(1, THREADS * 2 + 1))  # 1..N, no gaps, no duplicates


def test_concurrent_serve_next_serves_each_person_once():
    manager_id, queue_id = _setup_queue()
    with SessionLocal() as db:
        q = qs.lock_queue(db, queue_id, manager_id)
        for i in range(THREADS):
            qs.add_token(db, q, f"person {i}")
        db.commit()

    called: list[int] = []
    lock = threading.Lock()

    def serve(_):
        with SessionLocal() as db:
            q = qs.lock_queue(db, queue_id, manager_id)
            _, now_serving = qs.serve_next(db, q)
            db.commit()
            if now_serving:
                with lock:
                    called.append(now_serving.number)

    errors = _run(serve, THREADS)
    assert errors == []
    assert sorted(called) == list(range(1, THREADS + 1))  # everyone called exactly once
    tokens = _tokens(queue_id)
    assert sum(t.status == TokenStatus.serving for t in tokens) == 1
    assert sum(t.status == TokenStatus.served for t in tokens) == THREADS - 1


def test_concurrent_moves_keep_a_valid_order():
    manager_id, queue_id = _setup_queue()
    with SessionLocal() as db:
        q = qs.lock_queue(db, queue_id, manager_id)
        ids = [qs.add_token(db, q, f"p{i}").id for i in range(8)]
        db.commit()

    rng = random.Random(42)
    plans = [(rng.choice(ids), rng.choice(["up", "down"])) for _ in range(THREADS * 3)]

    def move(i):
        token_id, direction = plans[i]
        with SessionLocal() as db:
            q = qs.lock_queue(db, queue_id, manager_id)
            try:
                qs.move_token(db, q, token_id, direction)
                db.commit()
            except qs.QueueError:  # already at the front/back: fine
                db.rollback()

    _run(move, len(plans))
    tokens = _tokens(queue_id)
    # Positions must still be a permutation of the token numbers:
    # nothing lost, nothing duplicated.
    assert sorted(t.position for t in tokens) == sorted(t.number for t in tokens)
    assert len(tokens) == 8
