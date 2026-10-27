from datetime import timedelta
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Device, Plant, SensorReading, User, utcnow
from app.schemas import (
    DeviceCreate,
    DeviceCreatedOut,
    DeviceOut,
    SensorReadingIn,
    SensorReadingOut,
)
from app.security import generate_device_key, hash_device_key
from app.services.notification_service import check_reading

logger = logging.getLogger(__name__)

router = APIRouter(tags=["sensors"])

MAX_HISTORY_POINTS = 10_000


def _own_plant(db: Session, plant_id: int, user: User) -> Plant:
    plant = db.get(Plant, plant_id)
    if plant is None or plant.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Растение не найдено")
    return plant


def _public_plant(db: Session, plant_id: int) -> Plant:
    plant = db.get(Plant, plant_id)
    if plant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Растение не найдено")
    return plant


def _optional_device(
    db: Session,
    plant_id: int,
    device_id: int | None,
) -> Device | None:
    if device_id is None:
        return None

    device = db.get(Device, device_id)
    if device is None or device.plant_id != plant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Устройство не найдено")
    return device


@router.post(
    "/plants/{plant_id}/devices",
    response_model=DeviceCreatedOut,
    status_code=status.HTTP_201_CREATED,
)
def create_device(
    plant_id: int,
    data: DeviceCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    plant = _own_plant(db, plant_id, user)
    key = generate_device_key()
    device = Device(
        plant_id=plant.id,
        name=data.name,
        key_hash=hash_device_key(key),
    )
    db.add(device)
    db.commit()
    db.refresh(device)
    return DeviceCreatedOut(
        id=device.id,
        plant_id=device.plant_id,
        name=device.name,
        created_at=device.created_at,
        last_seen_at=device.last_seen_at,
        api_key=key,
    )


@router.get("/plants/{plant_id}/devices", response_model=list[DeviceOut])
def list_devices(
    plant_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    plant = _own_plant(db, plant_id, user)
    return db.scalars(
        select(Device)
        .where(Device.plant_id == plant.id)
        .order_by(Device.id)
    ).all()


@router.delete(
    "/plants/{plant_id}/devices/{device_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_device(
    plant_id: int,
    device_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    plant = _own_plant(db, plant_id, user)
    device = db.get(Device, device_id)
    if device is None or device.plant_id != plant.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Устройство не найдено")
    db.delete(device)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/sensors/readings",
    response_model=SensorReadingOut,
    status_code=status.HTTP_201_CREATED,
)
def ingest_reading(
    data: SensorReadingIn,
    plant_id: int = Query(..., ge=1),
    device_id: int | None = Query(None, ge=1),
    db: Session = Depends(get_db),
):
    plant = _public_plant(db, plant_id)
    device = _optional_device(db, plant.id, device_id)

    now = utcnow()
    recorded_at = data.recorded_at or now
    if recorded_at > now + timedelta(minutes=5):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "recorded_at находится в будущем",
        )

    reading = SensorReading(
        plant_id=plant.id,
        device_id=device.id if device else None,
        recorded_at=recorded_at,
        **data.model_dump(exclude={"recorded_at"}),
    )
    db.add(reading)

    if device is not None:
        device.last_seen_at = now

    db.commit()
    db.refresh(reading)
    out = SensorReadingOut.model_validate(reading)

    try:
        check_reading(db, plant.id, reading)
    except Exception:
        db.rollback()
        logger.exception("Не удалось проверить показания на опасные значения")

    return out


@router.get(
    "/plants/{plant_id}/sensors/latest",
    response_model=SensorReadingOut,
)
def latest_reading(
    plant_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    plant = _own_plant(db, plant_id, user)
    reading = db.scalar(
        select(SensorReading)
        .where(SensorReading.plant_id == plant.id)
        .order_by(SensorReading.recorded_at.desc(), SensorReading.id.desc())
        .limit(1)
    )
    if reading is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "Показаний от датчиков пока нет",
        )
    return reading


@router.get(
    "/plants/{plant_id}/sensors/history",
    response_model=list[SensorReadingOut],
)
def history(
    plant_id: int,
    hours: int = Query(24, ge=1, le=168),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    plant = _own_plant(db, plant_id, user)
    since = utcnow() - timedelta(hours=hours)
    rows = db.scalars(
        select(SensorReading)
        .where(
            SensorReading.plant_id == plant.id,
            SensorReading.recorded_at >= since,
        )
        .order_by(SensorReading.recorded_at.desc(), SensorReading.id.desc())
        .limit(MAX_HISTORY_POINTS)
    ).all()
    rows.reverse()
    return rows
