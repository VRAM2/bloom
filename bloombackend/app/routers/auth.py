import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.models import (
    AlertState,
    ChatMessage,
    Device,
    DeviceCommand,
    Notification,
    Photo,
    Plant,
    PlantCare,
    PushSubscription,
    SensorReading,
    User,
)
from app.schemas import AccountDelete, TokenOut, UserLogin, UserOut, UserRegister
from app.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
def register(data: UserRegister, db: Session = Depends(get_db)):
    exists = db.scalar(select(User).where(User.username == data.username))
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, "Пользователь с таким именем уже существует")

    user = User(username=data.username, password_hash=hash_password(data.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:  # гонка двух одновременных регистраций
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Пользователь с таким именем уже существует")

    return TokenOut(access_token=create_access_token(user.id))


@router.post("/login", response_model=TokenOut)
def login(data: UserLogin, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.username == data.username))
    if user is None or not verify_password(data.password, user.password_hash):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Неверное имя или пароль",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return TokenOut(access_token=create_access_token(user.id))

@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    """Текущий пользователь. Фронт вызывает при запуске, чтобы проверить токен."""
    return user

@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    data: AccountDelete,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Полностью удаляет аккаунт и все данные пользователя. Необратимо. Нужен пароль."""
    if not verify_password(data.password, user.password_hash):
        # 403, а не 401: токен действителен, фронт не должен разлогинивать пользователя
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Неверный пароль")

    user_id = user.id
    plant_ids = list(db.scalars(select(Plant.id).where(Plant.user_id == user_id)))

    try:
        db.execute(delete(Notification).where(Notification.user_id == user_id))
        db.execute(delete(PushSubscription).where(PushSubscription.user_id == user_id))
        if plant_ids:
            db.execute(delete(ChatMessage).where(ChatMessage.plant_id.in_(plant_ids)))
            db.execute(delete(Photo).where(Photo.plant_id.in_(plant_ids)))
            db.execute(delete(SensorReading).where(SensorReading.plant_id.in_(plant_ids)))
            db.execute(delete(DeviceCommand).where(DeviceCommand.plant_id.in_(plant_ids)))
            db.execute(delete(PlantCare).where(PlantCare.plant_id.in_(plant_ids)))
            db.execute(delete(Device).where(Device.plant_id.in_(plant_ids)))
            db.execute(delete(Plant).where(Plant.id.in_(plant_ids)))
        db.execute(delete(User).where(User.id == user_id))
        db.commit()
    except Exception:
        db.rollback()
        raise

    # файлы снимков удаляем только после успешного коммита
    for plant_id in plant_ids:
        shutil.rmtree(Path(settings.photos_dir) / str(plant_id), ignore_errors=True)

    return Response(status_code=status.HTTP_204_NO_CONTENT)