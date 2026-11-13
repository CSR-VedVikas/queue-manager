"""Queue operations. All business rules live here, not in the HTTP routes,
so they can be tested directly (including from many threads at once).

Every function that changes a queue takes the queue *already locked* via
lock_queue(). The caller commits. See docs/DESIGN.md sections 3-5.
"""

from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Queue, Token, TokenEvent, TokenStatus


class QueueError(Exception):
    """A request that is valid in shape but not allowed in the current state."""

    def __init__(self, message: str, status_code: int = 409):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class NotFound(QueueError):
    def __init__(self, what: str):
        super().__init__(f"{what} not found", 404)


# ---------- the state machine

ALLOWED_TRANSITIONS: dict[TokenStatus, set[TokenStatus]] = {
    TokenStatus.waiting: {TokenStatus.serving, TokenStatus.cancelled},
    TokenStatus.serving: {TokenStatus.served, TokenStatus.cancelled},
    TokenStatus.served: set(),
    TokenStatus.cancelled: set(),
}

_TIMESTAMP_FIELD = {
    TokenStatus.serving: "serving_at",
    TokenStatus.served: "served_at",
    TokenStatus.cancelled: "cancelled_at",
}


def _transition(db: Session, token: Token, new: TokenStatus, now: datetime) -> None:
    if new not in ALLOWED_TRANSITIONS[token.status]:
        raise QueueError(f"Token #{token.number} is {token.status.value} and cannot become {new.value}")
    token.status = new
    setattr(token, _TIMESTAMP_FIELD[new], now)
    _log(db, token, new.value, now)
    # Flush now so the partial unique index ("one serving per queue") sees
    # this change before the next statement in the same transaction.
    db.flush()


def _log(db: Session, token: Token, event_type: str, now: datetime) -> None:
    db.add(TokenEvent(queue_id=token.queue_id, token_id=token.id, type=event_type, at=now))


def _now() -> datetime:
    return datetime.now(UTC)


# ---------- locking and lookup

def lock_queue(db: Session, queue_id: int, manager_id: int) -> Queue:
    """Fetch a queue owned by this manager and lock its row until commit.

    Doubles as the authorization check: someone else's queue simply isn't
    found (404, so we don't even confirm it exists). The lock makes all
    changes to one queue run one at a time."""
    queue = db.execute(
        select(Queue)
        .where(Queue.id == queue_id, Queue.manager_id == manager_id)
        .with_for_update()
    ).scalar_one_or_none()
    if queue is None:
        raise NotFound("Queue")
    return queue


def get_queue(db: Session, queue_id: int, manager_id: int) -> Queue:
    """Read-only lookup with the same ownership check, no lock."""
    queue = db.execute(
        select(Queue).where(Queue.id == queue_id, Queue.manager_id == manager_id)
    ).scalar_one_or_none()
    if queue is None:
        raise NotFound("Queue")
    return queue


def _token_in_queue(db: Session, queue: Queue, token_id: int) -> Token:
    token = db.execute(
        select(Token).where(Token.id == token_id, Token.queue_id == queue.id)
    ).scalar_one_or_none()
    if token is None:
        raise NotFound("Token")
    return token


def serving_token(db: Session, queue_id: int) -> Token | None:
    return db.execute(
        select(Token).where(Token.queue_id == queue_id, Token.status == TokenStatus.serving)
    ).scalar_one_or_none()


def waiting_tokens(db: Session, queue_id: int) -> list[Token]:
    return list(
        db.execute(
            select(Token)
            .where(Token.queue_id == queue_id, Token.status == TokenStatus.waiting)
            .order_by(Token.position)
        ).scalars()
    )


# ---------- queue operations

def create_queue(db: Session, manager_id: int, name: str) -> Queue:
    queue = Queue(manager_id=manager_id, name=name)
    try:
        # SAVEPOINT: if the unique constraint fires, only this insert is
        # undone, not the whole transaction.
        with db.begin_nested():
            db.add(queue)
            db.flush()
    except IntegrityError:
        raise QueueError(f'You already have a queue called "{name}"') from None
    return queue


def add_token(db: Session, queue: Queue, label: str | None, now: datetime | None = None) -> Token:
    """Join the back of the line. The queue must be locked by the caller."""
    now = now or _now()
    number = queue.next_token_number
    queue.next_token_number = number + 1
    # position = number: always larger than every existing position,
    # so the new token is last in line.
    token = Token(
        queue_id=queue.id, number=number, label=label,
        status=TokenStatus.waiting, position=number, created_at=now,
    )
    db.add(token)
    db.flush()
    _log(db, token, "created", now)
    db.flush()
    return token


def move_token(db: Session, queue: Queue, token_id: int, direction: str, now: datetime | None = None) -> Token:
    """Swap a waiting token's position with its nearest waiting neighbour."""
    now = now or _now()
    token = _token_in_queue(db, queue, token_id)
    if token.status != TokenStatus.waiting:
        raise QueueError(f"Only waiting tokens can be moved; #{token.number} is {token.status.value}")

    if direction == "up":
        neighbour_query = (
            select(Token)
            .where(Token.queue_id == queue.id, Token.status == TokenStatus.waiting,
                   Token.position < token.position)
            .order_by(Token.position.desc())
        )
    else:
        neighbour_query = (
            select(Token)
            .where(Token.queue_id == queue.id, Token.status == TokenStatus.waiting,
                   Token.position > token.position)
            .order_by(Token.position.asc())
        )
    neighbour = db.execute(neighbour_query.limit(1)).scalar_one_or_none()
    if neighbour is None:
        edge = "front" if direction == "up" else "back"
        raise QueueError(f"Token #{token.number} is already at the {edge} of the queue")

    # The swap. Between these two UPDATEs both rows briefly share a position;
    # the DEFERRABLE unique constraint only checks at commit, when it's fixed.
    token.position, neighbour.position = neighbour.position, token.position
    _log(db, token, f"moved_{direction}", now)
    db.flush()
    return token


def serve_next(db: Session, queue: Queue, now: datetime | None = None) -> tuple[Token | None, Token | None]:
    """Finish the token at the counter (if any) and call the front of the line.

    Returns (completed, now_serving). Raises if there is nothing to do."""
    now = now or _now()
    completed = serving_token(db, queue.id)
    if completed is not None:
        # Must happen (and be flushed) before the next token becomes
        # 'serving', or the one-serving-per-queue index would reject it.
        _transition(db, completed, TokenStatus.served, now)

    front = db.execute(
        select(Token)
        .where(Token.queue_id == queue.id, Token.status == TokenStatus.waiting)
        .order_by(Token.position)
        .limit(1)
    ).scalar_one_or_none()

    if front is None and completed is None:
        raise QueueError("No one is waiting in this queue")
    if front is not None:
        _transition(db, front, TokenStatus.serving, now)
    return completed, front


def complete_current(db: Session, queue: Queue, now: datetime | None = None) -> Token:
    """Mark the token at the counter as served without calling the next one."""
    now = now or _now()
    current = serving_token(db, queue.id)
    if current is None:
        raise QueueError("No token is being served right now")
    _transition(db, current, TokenStatus.served, now)
    return current


def cancel_token(db: Session, queue: Queue, token_id: int, now: datetime | None = None) -> Token:
    now = now or _now()
    token = _token_in_queue(db, queue, token_id)
    _transition(db, token, TokenStatus.cancelled, now)
    return token


def delete_queue(db: Session, queue: Queue) -> None:
    db.delete(queue)  # tokens and events go with it (ON DELETE CASCADE)
    db.flush()


# ---------- read models

def recent_finished(db: Session, queue_id: int, limit: int = 15) -> list[Token]:
    finished_at = func.coalesce(Token.served_at, Token.cancelled_at)
    return list(
        db.execute(
            select(Token)
            .where(Token.queue_id == queue_id,
                   Token.status.in_([TokenStatus.served, TokenStatus.cancelled]))
            .order_by(finished_at.desc())
            .limit(limit)
        ).scalars()
    )
