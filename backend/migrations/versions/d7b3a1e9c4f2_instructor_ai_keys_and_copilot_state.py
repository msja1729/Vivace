"""each instructor's own AI provider / key, and the Co-Pilot's topic state per session

Revision ID: d7b3a1e9c4f2
Revises: c5a9e2f7d1b8
Create Date: 2026-10-24 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d7b3a1e9c4f2"
down_revision: str | Sequence[str] | None = "c5a9e2f7d1b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("ai_provider", sa.String(length=20), nullable=True))
        batch_op.add_column(sa.Column("ai_model", sa.String(length=80), nullable=True))
        batch_op.add_column(sa.Column("ai_key_enc", sa.Text(), nullable=True))
    with op.batch_alter_table("viva_sessions", schema=None) as batch_op:
        batch_op.add_column(sa.Column("copilot", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("viva_sessions", schema=None) as batch_op:
        batch_op.drop_column("copilot")
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("ai_key_enc")
        batch_op.drop_column("ai_model")
        batch_op.drop_column("ai_provider")
