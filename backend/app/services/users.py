from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import BadRequest, Conflict, Unauthorized
from app.core.security import hash_password, verify_password
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


def register(db: Session, name: str, email: str, password: str, role: Role) -> User:
    """A new email + password account, with its role chosen on the form."""
    email = ensure_school_email(email)
    if db.scalar(select(User).where(User.email == email)) is not None:
        raise Conflict("An account with this email already exists. Log in instead.")
    user = User(name=name.strip(), email=email, role=role, password_hash=hash_password(password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def authenticate(db: Session, email: str, password: str) -> User:
    user = db.scalar(select(User).where(User.email == email.strip().lower()))
    if user is None or not verify_password(password, user.password_hash):
        raise Unauthorized("Incorrect email or password.")
    return user


def set_role(db: Session, user: User, role: Role) -> User:
    """A role is chosen once, at registration."""
    if user.role is not None and user.role != role:
        raise Conflict("Your role is already set.")
    user.role = role
    db.commit()
    db.refresh(user)
    return user
