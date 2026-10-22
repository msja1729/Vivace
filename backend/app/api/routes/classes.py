from typing import Annotated

from fastapi import APIRouter, Query, status

from app.api.deps import DbSession, RegisteredUser
from app.schemas.classroom import (
    AddTAIn,
    ClassCreateIn,
    ClassOut,
    JoinClassIn,
    MemberOut,
    MyClassesOut,
    PersonOut,
    TAOut,
)
from app.services import classes

router = APIRouter(prefix="/classes", tags=["classes"])


@router.post("", response_model=ClassOut, status_code=status.HTTP_201_CREATED)
def create_class(body: ClassCreateIn, user: RegisteredUser, db: DbSession):
    """Instructors only. Returns the class with its new join code."""
    return classes.create_class(db, body, user)


@router.post("/join", response_model=ClassOut)
def join_class(body: JoinClassIn, user: RegisteredUser, db: DbSession):
    return classes.join_class(db, body.code, user)


@router.get("/mine", response_model=MyClassesOut)
def my_classes(user: RegisteredUser, db: DbSession):
    teaching, assisting, joined = classes.list_my_classes(db, user)
    return MyClassesOut(teaching=teaching, assisting=assisting, joined=joined)


@router.get("/{class_id}", response_model=ClassOut)
def get_class(class_id: str, user: RegisteredUser, db: DbSession):
    return classes.get_class(db, class_id, user)


@router.get("/{class_id}/members", response_model=list[MemberOut])
def list_members(class_id: str, user: RegisteredUser, db: DbSession):
    """Instructor and TAs: the students in the class."""
    cls = classes.get_managed_class(db, class_id, user)
    return [
        MemberOut(id=m.user.id, name=m.user.name, email=m.user.email, joined_at=m.joined_at)
        for m in classes.list_members(db, cls.id)
    ]


@router.get("/{class_id}/tas", response_model=list[TAOut])
def list_tas(class_id: str, user: RegisteredUser, db: DbSession):
    return classes.list_tas(db, class_id, user)


@router.get("/{class_id}/ta-candidates", response_model=list[PersonOut])
def search_ta_candidates(
    class_id: str, user: RegisteredUser, db: DbSession, q: Annotated[str, Query(max_length=120)] = ""
):
    """Owner only: find registered users by email (or name) to add as TAs. Needs 3+ characters."""
    return classes.search_ta_candidates(db, class_id, q, user)


@router.post("/{class_id}/tas", response_model=list[TAOut], status_code=status.HTTP_201_CREATED)
def add_ta(class_id: str, body: AddTAIn, user: RegisteredUser, db: DbSession):
    """Owner only: give a user instructor permissions in this class."""
    return classes.add_ta(db, class_id, body.user_id, user)


@router.delete("/{class_id}/tas/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_ta(class_id: str, user_id: str, user: RegisteredUser, db: DbSession):
    classes.remove_ta(db, class_id, user_id, user)
