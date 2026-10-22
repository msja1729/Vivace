import secrets
from typing import Literal

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.core.errors import BadRequest, Conflict, Forbidden, NotFound
from app.models import ClassMember, ClassRoom, ClassTA, Role, User
from app.schemas.classroom import ClassCreateIn, ClassOut, PersonOut, TAOut

# No look-alike characters (0/O, 1/I).
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
MAX_SEARCH_RESULTS = 10


def _new_join_code(db: Session) -> str:
    while True:
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
        if not db.scalar(select(ClassRoom.id).where(ClassRoom.join_code == code)):
            return code


def _students_query():
    """Class members who aren't TAs of that class (a TA stops counting as a student)."""
    return (
        select(ClassMember)
        .outerjoin(
            ClassTA, and_(ClassTA.class_id == ClassMember.class_id, ClassTA.user_id == ClassMember.user_id)
        )
        .where(ClassTA.id.is_(None))
    )


def _member_counts(db: Session, class_ids: list[str]) -> dict[str, int]:
    if not class_ids:
        return {}
    sub = _students_query().where(ClassMember.class_id.in_(class_ids)).subquery()
    rows = db.execute(select(sub.c.class_id, func.count()).group_by(sub.c.class_id))
    return dict(rows.all())


def is_ta(db: Session, class_id: str, user_id: str) -> bool:
    return bool(db.scalar(select(ClassTA.id).where(ClassTA.class_id == class_id, ClassTA.user_id == user_id)))


def is_member(db: Session, class_id: str, user_id: str) -> bool:
    """A student of the class (joined with the code, and not a TA of it)."""
    return bool(
        db.scalar(_students_query().where(ClassMember.class_id == class_id, ClassMember.user_id == user_id))
    )


def role_in(db: Session, cls: ClassRoom, user: User) -> Literal["owner", "ta", "student"] | None:
    if cls.instructor_id == user.id:
        return "owner"
    if is_ta(db, cls.id, user.id):
        return "ta"
    if is_member(db, cls.id, user.id):
        return "student"
    return None


def to_out(cls: ClassRoom, role: Literal["owner", "ta", "student"], member_count: int) -> ClassOut:
    return ClassOut(
        id=cls.id,
        name=cls.name,
        subject=cls.subject,
        description=cls.description,
        instructor_id=cls.instructor_id,
        instructor_name=cls.instructor.name,
        member_count=member_count,
        created_at=cls.created_at,
        my_role=role,
        join_code=cls.join_code if role in ("owner", "ta") else None,
    )


def create_class(db: Session, data: ClassCreateIn, instructor: User) -> ClassOut:
    if instructor.role != Role.instructor:
        raise Forbidden("Only instructors can create classes.")
    cls = ClassRoom(**data.model_dump(), join_code=_new_join_code(db), instructor_id=instructor.id)
    db.add(cls)
    db.commit()
    db.refresh(cls)
    return to_out(cls, "owner", 0)


def join_class(db: Session, code: str, user: User) -> ClassOut:
    cls = db.scalar(select(ClassRoom).where(ClassRoom.join_code == code))
    if cls is None:
        raise NotFound("No class found with that code. Check it with your instructor.")
    if cls.instructor_id == user.id:
        raise Conflict("You already own this class.")
    if is_ta(db, cls.id, user.id):
        raise Conflict("You are a TA of this class.")
    already = db.scalar(
        select(ClassMember.id).where(ClassMember.class_id == cls.id, ClassMember.user_id == user.id)
    )
    if already:
        raise Conflict("You have already joined this class.")
    db.add(ClassMember(class_id=cls.id, user_id=user.id))
    db.commit()
    return to_out(cls, "student", _member_counts(db, [cls.id]).get(cls.id, 0))


def list_my_classes(db: Session, user: User) -> tuple[list[ClassOut], list[ClassOut], list[ClassOut]]:
    """(teaching, assisting, joined)"""
    teaching = list(
        db.scalars(
            select(ClassRoom).where(ClassRoom.instructor_id == user.id).order_by(ClassRoom.created_at.desc())
        )
    )
    assisting = list(
        db.scalars(
            select(ClassRoom)
            .join(ClassTA, ClassTA.class_id == ClassRoom.id)
            .where(ClassTA.user_id == user.id)
            .order_by(ClassTA.added_at.desc())
        )
    )
    sub = _students_query().where(ClassMember.user_id == user.id).subquery()
    joined = list(
        db.scalars(
            select(ClassRoom).join(sub, sub.c.class_id == ClassRoom.id).order_by(sub.c.joined_at.desc())
        )
    )
    counts = _member_counts(db, [c.id for c in teaching + assisting + joined])
    return (
        [to_out(c, "owner", counts.get(c.id, 0)) for c in teaching],
        [to_out(c, "ta", counts.get(c.id, 0)) for c in assisting],
        [to_out(c, "student", counts.get(c.id, 0)) for c in joined],
    )


def get_class(db: Session, class_id: str, user: User) -> ClassOut:
    """Only staff and students can see a class; others get 404 (not 403) to avoid leaking it."""
    cls = db.get(ClassRoom, class_id)
    role = role_in(db, cls, user) if cls else None
    if role is None:
        raise NotFound("Class not found.")
    return to_out(cls, role, _member_counts(db, [cls.id]).get(cls.id, 0))


def get_managed_class(db: Session, class_id: str, user: User) -> ClassRoom:
    """The class, if `user` is its instructor or a TA. Everyone else gets 404."""
    cls = db.get(ClassRoom, class_id)
    if cls is None or (cls.instructor_id != user.id and not is_ta(db, cls.id, user.id)):
        raise NotFound("Class not found.")
    return cls


def get_owned_class(db: Session, class_id: str, user: User) -> ClassRoom:
    """The class, if `user` created it. TAs get 403; everyone else 404."""
    cls = get_managed_class(db, class_id, user)
    if cls.instructor_id != user.id:
        raise Forbidden("Only the class owner can do this.")
    return cls


def list_members(db: Session, class_id: str) -> list[ClassMember]:
    """Students in the class (not TAs), in the order they joined."""
    return list(
        db.scalars(_students_query().where(ClassMember.class_id == class_id).order_by(ClassMember.joined_at))
    )


# ---------- Teaching assistants ----------


def list_tas(db: Session, class_id: str, user: User) -> list[TAOut]:
    cls = get_managed_class(db, class_id, user)
    rows = db.scalars(select(ClassTA).where(ClassTA.class_id == cls.id).order_by(ClassTA.added_at))
    return [TAOut(id=t.user.id, name=t.user.name, email=t.user.email, added_at=t.added_at) for t in rows]


def search_ta_candidates(db: Session, class_id: str, query: str, user: User) -> list[PersonOut]:
    """Registered users whose email (or name) matches, who could be added as TAs."""
    cls = get_owned_class(db, class_id, user)
    q = query.strip().lower()
    if len(q) < 3:
        return []
    existing = select(ClassTA.user_id).where(ClassTA.class_id == cls.id)
    pattern = f"%{q.replace('%', '').replace('_', '')}%"
    rows = db.scalars(
        select(User)
        .where(
            User.role.is_not(None),
            User.id != cls.instructor_id,
            User.id.not_in(existing),
            or_(func.lower(User.email).like(pattern), func.lower(User.name).like(pattern)),
        )
        .order_by(User.email)
        .limit(MAX_SEARCH_RESULTS)
    )
    return [PersonOut.model_validate(u) for u in rows]


def add_ta(db: Session, class_id: str, ta_user_id: str, user: User) -> list[TAOut]:
    cls = get_owned_class(db, class_id, user)
    ta = db.get(User, ta_user_id)
    if ta is None or ta.role is None:
        raise BadRequest("That user hasn't registered yet.")
    if ta.id == cls.instructor_id:
        raise Conflict("You own this class already.")
    if is_ta(db, cls.id, ta.id):
        raise Conflict(f"{ta.name} is already a TA.")
    db.add(ClassTA(class_id=cls.id, user_id=ta.id))
    db.commit()
    return list_tas(db, cls.id, user)


def remove_ta(db: Session, class_id: str, ta_user_id: str, user: User) -> None:
    cls = get_owned_class(db, class_id, user)
    row = db.scalar(select(ClassTA).where(ClassTA.class_id == cls.id, ClassTA.user_id == ta_user_id))
    if row is None:
        raise NotFound("TA not found.")
    db.delete(row)
    db.commit()
