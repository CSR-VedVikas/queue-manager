"""Database tables. See docs/DESIGN.md sections 2-4 for the reasoning."""

import enum
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class TokenStatus(str, enum.Enum):
    waiting = "waiting"
    serving = "serving"
    served = "served"
    cancelled = "cancelled"


class Manager(Base):
    __tablename__ = "managers"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    password_hash: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Queue(Base):
    __tablename__ = "queues"

    id: Mapped[int] = mapped_column(primary_key=True)
    manager_id: Mapped[int] = mapped_column(ForeignKey("managers.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    # Counter for the next token number. Only ever read and incremented while
    # this row is locked (SELECT ... FOR UPDATE), so numbers are never reused.
    next_token_number: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (UniqueConstraint("manager_id", "name", name="uq_queues_manager_name"),)


class Token(Base):
    __tablename__ = "tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    queue_id: Mapped[int] = mapped_column(ForeignKey("queues.id", ondelete="CASCADE"))
    number: Mapped[int] = mapped_column(Integer)
    label: Mapped[str | None] = mapped_column(String(80), nullable=True)
    status: Mapped[TokenStatus] = mapped_column(
        Enum(TokenStatus, name="token_status"), default=TokenStatus.waiting
    )
    # Sort key: lower = closer to the front. Swapped on move up/down.
    position: Mapped[int] = mapped_column(Integer)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    serving_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    served_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("queue_id", "number", name="uq_tokens_queue_number"),
        # Checked at COMMIT, not per row, so two positions can be swapped
        # inside one transaction (see DESIGN.md section 4).
        UniqueConstraint(
            "queue_id", "position", name="uq_tokens_queue_position",
            deferrable=True, initially="DEFERRED",
        ),
        # A queue has one counter: at most one token may be 'serving'.
        Index(
            "uq_tokens_one_serving_per_queue", "queue_id",
            unique=True, postgresql_where=text("status = 'serving'"),
        ),
        Index("ix_tokens_queue_status_position", "queue_id", "status", "position"),
        Index("ix_tokens_queue_created", "queue_id", "created_at"),
    )


class TokenEvent(Base):
    """Append-only audit log: one row per action taken on a token."""

    __tablename__ = "token_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    queue_id: Mapped[int] = mapped_column(ForeignKey("queues.id", ondelete="CASCADE"))
    token_id: Mapped[int] = mapped_column(ForeignKey("tokens.id", ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(String(20))
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (Index("ix_token_events_queue_at", "queue_id", "at"),)
