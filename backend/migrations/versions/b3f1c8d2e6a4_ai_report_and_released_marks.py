"""AI report per session, and the marks / AI report released to the student

Revision ID: b3f1c8d2e6a4
Revises: a7d2e4c91b3f
Create Date: 2026-10-22 18:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b3f1c8d2e6a4"
down_revision: str | Sequence[str] | None = "a7d2e4c91b3f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("viva_sessions", schema=None) as batch_op:
        batch_op.add_column(sa.Column("ai_report", sa.JSON(), nullable=True))
    with op.batch_alter_table("viva_feedback", schema=None) as batch_op:
        batch_op.add_column(sa.Column("marks", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("ai_report", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("viva_feedback", schema=None) as batch_op:
        batch_op.drop_column("ai_report")
        batch_op.drop_column("marks")
    with op.batch_alter_table("viva_sessions", schema=None) as batch_op:
        batch_op.drop_column("ai_report")
