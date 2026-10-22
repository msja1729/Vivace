from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import BadRequest, Conflict
from app.models import Role, User


def ensure_school_email(email: str) -> str:
    email = email.strip().lower()
    domain = email.rsplit("@", 1)[-1]
    settings = get_settings()
    if domain in settings.blocked_email_domains:
        raise BadRequest("Use your school Microsoft account, not a personal email.")
    if settings.allowed_email_domains and domain not in settings.allowed_email_domains:
        raise BadRequest(f"Sign in with your {' / '.join(settings.allowed_email_domains)} account.")
    return email


def get_or_create_user(db: Session, name: str, email: str) -> User:
    """Returning users keep their saved name and role; new users start with role = None."""
    email = ensure_school_email(email)
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(name=name.strip(), email=email)
        db.add(user)
        db.commit()
        db.refresh(user)
    return user


def set_role(db: Session, user: User, role: Role) -> User:
    """A role is chosen once, at registration."""
    if user.role is not None and user.role != role:
        raise Conflict("Your role is already set.")
    user.role = role
    db.commit()
    db.refresh(user)
    return user
