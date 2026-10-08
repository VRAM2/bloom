from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Notification, User, utcnow
from app.schemas_notifications import MarkedOut, NotificationOut, UnreadCountOut

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _own(db: Session, notification_id: int, user: User) -> Notification:
    n = db.get(Notification, notification_id)
    if n is None or n.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Уведомление не найдено")
    return n


@router.get("", response_model=list[NotificationOut])
def list_notifications(
    unread_only: bool = False,
    plant_id: int | None = None,
    notif_type: str | None = Query(None, alias="type", description="Например: sensor_alert, water_low"),
    after_id: int | None = Query(None, description="Только новее этого id (для опроса)"),
    before_id: int | None = Query(None, description="Только старее этого id (для подгрузки)"),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Уведомления пользователя, новые первыми."""
    stmt = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        stmt = stmt.where(Notification.is_read.is_(False))
    if plant_id is not None:
        stmt = stmt.where(Notification.plant_id == plant_id)
    if notif_type is not None:
        stmt = stmt.where(Notification.type == notif_type)
    if after_id is not None:
        stmt = stmt.where(Notification.id > after_id)
    if before_id is not None:
        stmt = stmt.where(Notification.id < before_id)
    return db.scalars(stmt.order_by(Notification.id.desc()).limit(limit)).all()


@router.get("/unread-count", response_model=UnreadCountOut)
def unread_count(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Счётчик непрочитанных для значка колокольчика. Можно опрашивать раз в 30-60 секунд."""
    rows = db.execute(
        select(Notification.severity, func.count())
        .where(Notification.user_id == user.id, Notification.is_read.is_(False))
        .group_by(Notification.severity)
    ).all()
    counts = {severity: count for severity, count in rows}
    return UnreadCountOut(
        unread=sum(counts.values()),
        critical=counts.get("critical", 0),
        warning=counts.get("warning", 0),
        info=counts.get("info", 0),
    )


@router.post("/read-all", response_model=MarkedOut)
def mark_all_read(
    plant_id: int | None = Query(None, description="Только по этому растению"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = update(Notification).where(
        Notification.user_id == user.id, Notification.is_read.is_(False)
    )
    if plant_id is not None:
        stmt = stmt.where(Notification.plant_id == plant_id)
    result = db.execute(stmt.values(is_read=True, read_at=utcnow()))
    db.commit()
    return MarkedOut(updated=result.rowcount)


@router.post("/{notification_id}/read", response_model=NotificationOut)
def mark_read(
    notification_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    n = _own(db, notification_id, user)
    if not n.is_read:
        n.is_read = True
        n.read_at = utcnow()
        db.commit()
        db.refresh(n)
    return n


@router.delete("/{notification_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_notification(
    notification_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    n = _own(db, notification_id, user)
    db.delete(n)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

@router.post("/test", response_model=NotificationOut, status_code=status.HTTP_201_CREATED)
def create_test_notification(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Для проверки: создаёт уведомление себе. Попадёт и в колокольчик, и в push."""
    n = Notification(
        user_id=user.id,
        plant_id=None,
        type="test",
        severity="info",
        title="Тестовое уведомление",
        message="Если вы видите это в колокольчике, связка работает.",
        data={},
    )
    db.add(n)
    db.commit()
    db.refresh(n)
    return n