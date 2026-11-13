"""initial schema

Revision ID: 0001
Revises: 
Create Date: 2026-11-13 09:05:47.278486

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0001'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('managers',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('email', sa.String(length=254), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('password_hash', sa.String(length=100), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('email')
    )
    op.create_table('queues',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('manager_id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=80), nullable=False),
    sa.Column('next_token_number', sa.Integer(), server_default='1', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['manager_id'], ['managers.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('manager_id', 'name', name='uq_queues_manager_name')
    )
    op.create_index(op.f('ix_queues_manager_id'), 'queues', ['manager_id'], unique=False)
    op.create_table('tokens',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('queue_id', sa.Integer(), nullable=False),
    sa.Column('number', sa.Integer(), nullable=False),
    sa.Column('label', sa.String(length=80), nullable=True),
    sa.Column('status', sa.Enum('waiting', 'serving', 'served', 'cancelled', name='token_status'), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('serving_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('served_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['queue_id'], ['queues.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('queue_id', 'number', name='uq_tokens_queue_number'),
    sa.UniqueConstraint('queue_id', 'position', deferrable=True, initially='DEFERRED', name='uq_tokens_queue_position')
    )
    op.create_index('ix_tokens_queue_created', 'tokens', ['queue_id', 'created_at'], unique=False)
    op.create_index('ix_tokens_queue_status_position', 'tokens', ['queue_id', 'status', 'position'], unique=False)
    op.create_index('uq_tokens_one_serving_per_queue', 'tokens', ['queue_id'], unique=True, postgresql_where=sa.text("status = 'serving'"))
    op.create_table('token_events',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('queue_id', sa.Integer(), nullable=False),
    sa.Column('token_id', sa.Integer(), nullable=False),
    sa.Column('type', sa.String(length=20), nullable=False),
    sa.Column('at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['queue_id'], ['queues.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['token_id'], ['tokens.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_token_events_queue_at', 'token_events', ['queue_id', 'at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_token_events_queue_at', table_name='token_events')
    op.drop_table('token_events')
    op.drop_index('uq_tokens_one_serving_per_queue', table_name='tokens', postgresql_where=sa.text("status = 'serving'"))
    op.drop_index('ix_tokens_queue_status_position', table_name='tokens')
    op.drop_index('ix_tokens_queue_created', table_name='tokens')
    op.drop_table('tokens')
    op.drop_index(op.f('ix_queues_manager_id'), table_name='queues')
    op.drop_table('queues')
    op.drop_table('managers')
    sa.Enum(name='token_status').drop(op.get_bind(), checkfirst=True)
