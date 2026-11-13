"""HTTP layer for queues and tokens. Each handler is thin: validate input
(Pydantic), lock the queue, call the service, commit, return. The business
rules live in services/queue_service.py."""

from datetime import UTC, datetime, time
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_manager
from app.models import Manager, Queue, Token, TokenStatus
from app.schemas import (
    MoveIn,
    QueueDetailOut,
    QueueIn,
    QueueSummaryOut,
    TokenIn,
    TokenOut,
)
from app.services import analytics
from app.services import queue_service as qs

router = APIRouter(prefix="/api", tags=["queues"])


def _detail(db: Session, queue: Queue) -> QueueDetailOut:
    serving = qs.serving_token(db, queue.id)
    return QueueDetailOut(
        id=queue.id,
        name=queue.name,
        created_at=queue.created_at,
        serving=TokenOut.model_validate(serving) if serving else None,
        waiting=[TokenOut.model_validate(t) for t in qs.waiting_tokens(db, queue.id)],
        recent=[TokenOut.model_validate(t) for t in qs.recent_finished(db, queue.id)],
        server_time=datetime.now(UTC),
    )


# ---------- queues

@router.get("/queues", response_model=list[QueueSummaryOut])
def list_queues(
    tz: str | None = Query(None, max_length=64),
    manager: Manager = Depends(current_manager),
    db: Session = Depends(get_db),
):
    # "Today" means the viewer's today: midnight in their timezone, not UTC.
    zone = analytics.resolve_timezone(tz)
    local_today = datetime.now(zone).date()
    start_of_day = datetime.combine(local_today, time.min, tzinfo=zone)
    waiting = func.count(Token.id).filter(Token.status == TokenStatus.waiting)
    served_today = func.count(Token.id).filter(Token.served_at >= start_of_day)
    rows = db.execute(
        select(Queue, waiting, served_today)
        .outerjoin(Token, and_(Token.queue_id == Queue.id))
        .where(Queue.manager_id == manager.id)
        .group_by(Queue.id)
        .order_by(Queue.created_at)
    ).all()
    serving_by_queue = {
        t.queue_id: t
        for t in db.execute(
            select(Token)
            .join(Queue, Queue.id == Token.queue_id)
            .where(Queue.manager_id == manager.id, Token.status == TokenStatus.serving)
        ).scalars()
    }
    return [
        QueueSummaryOut(
            id=q.id, name=q.name, created_at=q.created_at,
            waiting_count=w, served_today=s,
            serving=TokenOut.model_validate(serving_by_queue[q.id]) if q.id in serving_by_queue else None,
        )
        for q, w, s in rows
    ]


@router.post("/queues", response_model=QueueDetailOut, status_code=status.HTTP_201_CREATED)
def create_queue(body: QueueIn, manager: Manager = Depends(current_manager), db: Session = Depends(get_db)):
    queue = qs.create_queue(db, manager.id, body.name)
    db.commit()
    return _detail(db, queue)


@router.get("/queues/{queue_id}", response_model=QueueDetailOut)
def get_queue(queue_id: int, manager: Manager = Depends(current_manager), db: Session = Depends(get_db)):
    return _detail(db, qs.get_queue(db, queue_id, manager.id))


@router.delete("/queues/{queue_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_queue(queue_id: int, manager: Manager = Depends(current_manager), db: Session = Depends(get_db)):
    qs.delete_queue(db, qs.lock_queue(db, queue_id, manager.id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- tokens. Every change returns the whole updated queue, so the
# client never has to guess what the new order looks like.

@router.post("/queues/{queue_id}/tokens", response_model=QueueDetailOut, status_code=status.HTTP_201_CREATED)
def add_token(queue_id: int, body: TokenIn, manager: Manager = Depends(current_manager),
              db: Session = Depends(get_db)):
    queue = qs.lock_queue(db, queue_id, manager.id)
    qs.add_token(db, queue, body.label)
    db.commit()
    return _detail(db, queue)


@router.post("/queues/{queue_id}/tokens/{token_id}/move", response_model=QueueDetailOut)
def move_token(queue_id: int, token_id: int, body: MoveIn, manager: Manager = Depends(current_manager),
               db: Session = Depends(get_db)):
    queue = qs.lock_queue(db, queue_id, manager.id)
    qs.move_token(db, queue, token_id, body.direction)
    db.commit()
    return _detail(db, queue)


@router.post("/queues/{queue_id}/tokens/{token_id}/cancel", response_model=QueueDetailOut)
def cancel_token(queue_id: int, token_id: int, manager: Manager = Depends(current_manager),
                 db: Session = Depends(get_db)):
    queue = qs.lock_queue(db, queue_id, manager.id)
    qs.cancel_token(db, queue, token_id)
    db.commit()
    return _detail(db, queue)


@router.post("/queues/{queue_id}/serve-next", response_model=QueueDetailOut)
def serve_next(queue_id: int, manager: Manager = Depends(current_manager), db: Session = Depends(get_db)):
    queue = qs.lock_queue(db, queue_id, manager.id)
    qs.serve_next(db, queue)
    db.commit()
    return _detail(db, queue)


@router.post("/queues/{queue_id}/complete", response_model=QueueDetailOut)
def complete_current(queue_id: int, manager: Manager = Depends(current_manager), db: Session = Depends(get_db)):
    queue = qs.lock_queue(db, queue_id, manager.id)
    qs.complete_current(db, queue)
    db.commit()
    return _detail(db, queue)


# ---------- analytics

@router.get("/analytics")
def get_analytics(
    queue_id: int | None = None,
    range_: Literal["24h", "7d", "30d"] = Query("7d", alias="range"),
    tz: str | None = Query(None, max_length=64),
    manager: Manager = Depends(current_manager),
    db: Session = Depends(get_db),
):
    if queue_id is not None:
        qs.get_queue(db, queue_id, manager.id)  # 404 unless it's theirs
    return analytics.dashboard(db, manager.id, queue_id, range_, tz)
