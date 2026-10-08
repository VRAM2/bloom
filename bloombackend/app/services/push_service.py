import json
import logging
from datetime import datetime, timedelta, timezone

from pywebpush import WebPushException, webpush
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.models import Notification, PushSubscription, utcnow

logger = logging.getLogger(__name__)

SEVERITY_RANK = {"info": 0, "warning": 1, "critical": 2}
MAX_FAILURES = 10  # подряд неудачных отправок, после чего подписка удаляется
BATCH = 50


def push_enabled() -> bool:
    return bool(settings.vapid_private_key and settings.vapid_public_key)


def _aware(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def _send(sub: PushSubscription, payload: dict) -> str:
    """Возвращает 'ok', 'gone' (подписка мертва) или 'error' (временный сбой)."""
    try:
        webpush(
            subscription_info={
                "endpoint": sub.endpoint,
                "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
            },
            data=json.dumps(payload, ensure_ascii=False),
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": settings.vapid_subject},  # словарь создаётся заново: библиотека его изменяет
            ttl=settings.push_ttl_sec,
            timeout=10,
        )
        return "ok"
    except WebPushException as e:
        status = getattr(getattr(e, "response", None), "status_code", None)
        if status in (404, 410):
            return "gone"
        logger.warning("Web Push: ошибка (status=%s): %s", status, str(e)[:200])
        return "error"
    except Exception:
        logger.exception("Web Push: непредвиденная ошибка")
        return "error"


def _deliver(db: Session, sub: PushSubscription, payload: dict) -> bool:
    result = _send(sub, payload)
    if result == "ok":
        sub.last_success_at = utcnow()
        sub.failed_count = 0
        return True
    if result == "gone":
        db.delete(sub)
    else:
        sub.failed_count += 1
        if sub.failed_count >= MAX_FAILURES:
            db.delete(sub)
    return False


def send_to_user(db: Session, user_id: int, payload: dict) -> tuple[int, int]:
    """Отправляет payload на все устройства пользователя. Возвращает (успешно, всего)."""
    subs = db.scalars(select(PushSubscription).where(PushSubscription.user_id == user_id)).all()
    sent = 0
    for sub in subs:
        if _deliver(db, sub, payload):
            sent += 1
    db.commit()
    return sent, len(subs)


def build_payload(n: Notification) -> dict:
    return {
        "title": n.title,
        "body": n.message[:300],
        # одинаковый tag заменяет предыдущее уведомление на устройстве (тревога -> «снова в норме»)
        "tag": n.dedup_key or f"n-{n.id}",
        "severity": n.severity,
        "data": {"notification_id": n.id, "plant_id": n.plant_id, "type": n.type},
    }


def send_pending_push() -> None:
    """Фоновая задача: отправляет push по новым уведомлениям (pushed = false)."""
    if not push_enabled():
        return

    min_rank = SEVERITY_RANK[settings.push_min_severity]
    fresh_after = utcnow() - timedelta(minutes=settings.push_max_age_minutes)

    with SessionLocal() as db:
        items = db.scalars(
            select(Notification)
            .where(Notification.pushed.is_(False))
            .order_by(Notification.id)
            .limit(BATCH)
        ).all()

        for n in items:
            skip = (
                _aware(n.created_at) < fresh_after
                or SEVERITY_RANK.get(n.severity, 0) < min_rank
                or n.type in settings.push_skip_types
            )
            if not skip:
                try:
                    send_to_user(db, n.user_id, build_payload(n))
                except Exception:
                    db.rollback()
                    logger.exception("Не удалось отправить push по уведомлению id=%s", n.id)
            n.pushed = True
            db.commit()