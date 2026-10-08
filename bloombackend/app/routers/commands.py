from datetime import datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import get_current_device, get_current_user
from app.models import Device, DeviceCommand, Photo, Plant, User, utcnow
from app.schemas_commands import (
    ActuatorReportIn,
    ActuatorReportOut,
    ActuatorStateOut,
    CommandCreate,
    CommandOut,
    CommandResultIn,
    DeviceCommandOut,
    PhotoOut,
)
from app.services.actuator_service import apply_device_report, get_actuator_state
from app.services.notification_service import notify_command_failed

router = APIRouter(tags=["commands"])

MAX_PENDING_PER_PLANT = 20
POLL_BATCH = 10


def _own_plant(db: Session, plant_id: int, user: User) -> Plant:
    plant = db.get(Plant, plant_id)
    if plant is None or plant.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Растение не найдено")
    return plant


def _expire_stale(db: Session, plant_id: int, now: datetime) -> None:
    """Протухшие команды: не взятые вовремя и взятые, но без ответа."""
    db.execute(
        update(DeviceCommand)
        .where(
            DeviceCommand.plant_id == plant_id,
            DeviceCommand.status == "pending",
            DeviceCommand.created_at < now - timedelta(seconds=settings.command_ttl_sec),
        )
        .values(status="expired", finished_at=now, result_message="Устройство не забрало команду")
    )
    db.execute(
        update(DeviceCommand)
        .where(
            DeviceCommand.plant_id == plant_id,
            DeviceCommand.status == "sent",
            DeviceCommand.sent_at < now - timedelta(seconds=settings.command_result_timeout_sec),
        )
        .values(status="failed", finished_at=now, result_message="Устройство не прислало результат")
    )


# ======================================================= со стороны пользователя
@router.post(
    "/plants/{plant_id}/commands",
    response_model=CommandOut,
    status_code=status.HTTP_201_CREATED,
)
def create_command(
    plant_id: int,
    data: CommandCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Поставить команду в очередь (насос, вентиляторы, лампа, увлажнитель, камера, штора)."""
    plant = _own_plant(db, plant_id, user)

    has_device = db.scalar(select(Device.id).where(Device.plant_id == plant.id).limit(1))
    if has_device is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "К растению не привязано ни одно устройство"
        )

    now = utcnow()
    _expire_stale(db, plant.id, now)
    pending = db.scalar(
        select(func.count())
        .select_from(DeviceCommand)
        .where(DeviceCommand.plant_id == plant.id, DeviceCommand.status == "pending")
    )
    if pending >= MAX_PENDING_PER_PLANT:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "Слишком много неотправленных команд. Устройство онлайн?"
        )

    cmd = DeviceCommand(
        plant_id=plant.id,
        command_type=data.type,
        payload=data.model_dump(exclude={"type"}),
        status="pending",
    )
    db.add(cmd)
    db.commit()
    db.refresh(cmd)
    return cmd


@router.get("/plants/{plant_id}/commands", response_model=list[CommandOut])
def list_commands(
    plant_id: int,
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """История команд (новые первыми)."""
    plant = _own_plant(db, plant_id, user)
    _expire_stale(db, plant.id, utcnow())
    db.commit()
    return db.scalars(
        select(DeviceCommand)
        .where(DeviceCommand.plant_id == plant.id)
        .order_by(DeviceCommand.id.desc())
        .limit(limit)
    ).all()


@router.get("/plants/{plant_id}/commands/{command_id}", response_model=CommandOut)
def get_command(
    plant_id: int,
    command_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Статус одной команды (фронт может опрашивать, пока не станет done/failed/expired)."""
    plant = _own_plant(db, plant_id, user)
    _expire_stale(db, plant.id, utcnow())
    db.commit()
    cmd = db.get(DeviceCommand, command_id)
    if cmd is None or cmd.plant_id != plant.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Команда не найдена")
    return cmd

@router.get("/plants/{plant_id}/actuators/state", response_model=ActuatorStateOut)
def actuators_state(
    plant_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Что сейчас включено: насос, вентиляторы 1-3, лампа, увлажнитель, штора."""
    plant = _own_plant(db, plant_id, user)
    now = utcnow()
    _expire_stale(db, plant.id, now)
    db.commit()
    return get_actuator_state(db, plant.id, now)


# ============================================================ со стороны ESP
@router.post("/device/commands/poll", response_model=list[DeviceCommandOut])
def poll_commands(
    types: str | None = Query(None, description="Через запятую: camera,pump..."),
    db: Session = Depends(get_db),
    device: Device = Depends(get_current_device),
):
    now = utcnow()
    device.last_seen_at = now
    _expire_stale(db, device.plant_id, now)

    stmt = select(DeviceCommand).where(
        DeviceCommand.plant_id == device.plant_id, DeviceCommand.status == "pending"
    )
    if types:
        stmt = stmt.where(DeviceCommand.command_type.in_([t.strip() for t in types.split(",")]))
    candidates = db.scalars(stmt.order_by(DeviceCommand.id).limit(POLL_BATCH)).all()

    claimed = []
    for cmd in candidates:
        # атомарно «забираем»: если параллельно взял другой контроллер, rowcount будет 0
        res = db.execute(
            update(DeviceCommand)
            .where(DeviceCommand.id == cmd.id, DeviceCommand.status == "pending")
            .values(status="sent", device_id=device.id, sent_at=now)
        )
        if res.rowcount == 1:
            claimed.append(cmd)
    db.commit()

    return [DeviceCommandOut(id=c.id, type=c.command_type, params=c.payload) for c in claimed]


@router.post("/device/commands/{command_id}/result", response_model=CommandOut)
def report_result(
    command_id: int,
    data: CommandResultIn,
    db: Session = Depends(get_db),
    device: Device = Depends(get_current_device),
):
    """ESP сообщает, выполнена ли команда."""
    cmd = db.get(DeviceCommand, command_id)
    if cmd is None or cmd.plant_id != device.plant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Команда не найдена")
    if cmd.status in ("done", "failed"):  # повторный отчёт после сбоя связи: ничего не меняем
        return cmd
    if cmd.status != "sent" or cmd.device_id != device.id:
        raise HTTPException(status.HTTP_409_CONFLICT, "Команда не находится в обработке этим устройством")

    now = utcnow()
    cmd.status = data.status
    cmd.result_message = data.message
    cmd.finished_at = now
    device.last_seen_at = now
    if data.status == "failed":
        notify_command_failed(db, cmd)
    db.commit()
    db.refresh(cmd)
    return cmd

@router.post("/device/actuators/state", response_model=ActuatorReportOut)
def report_actuators(
    data: ActuatorReportIn,
    db: Session = Depends(get_db),
    device: Device = Depends(get_current_device),
):
    """ESP сообщает состояние исполнителей: после своего включения/выключения или как плановый снимок."""
    now = utcnow()
    device.last_seen_at = now
    recorded = apply_device_report(db, device, data, now)
    db.commit()
    return ActuatorReportOut(recorded=recorded, state=get_actuator_state(db, device.plant_id, now))


# ===================================================================== фото
@router.post("/device/photos", response_model=PhotoOut, status_code=status.HTTP_201_CREATED)
async def upload_photo(
    request: Request,
    command_id: int | None = Query(None, description="id команды camera, по которой сделан снимок"),
    db: Session = Depends(get_db),
    device: Device = Depends(get_current_device),
):
    """ESP отправляет JPEG в теле запроса (Content-Type: image/jpeg)."""
    limit = settings.max_photo_bytes
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > limit:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Файл слишком большой")

    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > limit:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Файл слишком большой")
    if not body.startswith(b"\xff\xd8\xff"):
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Ожидается JPEG")

    def _save() -> Photo:
        if command_id is not None:
            cmd = db.get(DeviceCommand, command_id)
            if cmd is None or cmd.plant_id != device.plant_id:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Команда не найдена")

        photo = Photo(
            plant_id=device.plant_id,
            device_id=device.id,
            command_id=command_id,
            filename="",
            size_bytes=len(body),
        )
        db.add(photo)
        db.flush()  # получаем photo.id
        photo.filename = f"{photo.id}.jpg"

        directory = Path(settings.photos_dir) / str(device.plant_id)
        directory.mkdir(parents=True, exist_ok=True)
        (directory / photo.filename).write_bytes(bytes(body))

        # храним только последние N снимков
        old = db.scalars(
            select(Photo)
            .where(Photo.plant_id == device.plant_id)
            .order_by(Photo.id.desc())
            .offset(settings.max_photos_per_plant)
        ).all()
        for p in old:
            (directory / p.filename).unlink(missing_ok=True)
            db.delete(p)

        device.last_seen_at = utcnow()
        db.commit()
        db.refresh(photo)
        return photo

    return await run_in_threadpool(_save)


@router.get("/plants/{plant_id}/photos", response_model=list[PhotoOut])
def list_photos(
    plant_id: int,
    command_id: int | None = Query(None, description="Только снимки по этой команде"),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    plant = _own_plant(db, plant_id, user)
    stmt = select(Photo).where(Photo.plant_id == plant.id)
    if command_id is not None:
        stmt = stmt.where(Photo.command_id == command_id)
    return db.scalars(stmt.order_by(Photo.id.desc()).limit(limit)).all()


@router.get("/plants/{plant_id}/photos/{photo_id}/image")
def get_photo_image(
    plant_id: int,
    photo_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    plant = _own_plant(db, plant_id, user)
    photo = db.get(Photo, photo_id)
    if photo is None or photo.plant_id != plant.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Снимок не найден")
    path = Path(settings.photos_dir) / str(plant.id) / photo.filename
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Файл снимка не найден")
    return FileResponse(path, media_type="image/jpeg")