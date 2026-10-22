"""proctoring frame counts per session (for the report's integrity summary)

Revision ID: c5a9e2f7d1b8
Revises: b3f1c8d2e6a4
Create Date: 2026-10-23 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c5a9e2f7d1b8"
down_revision: str | Sequence[str] | None = "b3f1c8d2e6a4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("viva_sessions", schema=None) as batch_op:
        batch_op.add_column(sa.Column("proctor_frames", sa.Integer(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("face_frames", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    with op.batch_alter_table("viva_sessions", schema=None) as batch_op:
        batch_op.drop_column("face_frames")
        batch_op.drop_column("proctor_frames")
