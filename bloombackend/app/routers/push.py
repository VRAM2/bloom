from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.models import PushSubscription, User
from app.schemas_push import (
    PublicKeyOut,
    PushSubscribeIn,
    PushTestOut,
    PushUnsubscribeIn,
    SubscribeOut,
)
from app.services.push_service import push_enabled, send_to_user

router = APIRouter(prefix="/push", tags=["push"])

MAX_SUBSCRIPTIONS_PER_USER = 10


def _require_enabled() -> None:
    if not push_enabled():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Push-уведомления не настроены на сервере"
        )


def _check_endpoint(endpoint: str) -> None:
    """Защита от SSRF: сервер будет обращаться по этому адресу, поэтому принимаем только push-сервисы браузеров."""
    parsed = urlparse(endpoint)
    host = (parsed.hostname or "").lower()
    allowed = any(host == h or host.endswith("." + h) for h in settings.push_allowed_hosts)
    if parsed.scheme != "https" or not allowed:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Недопустимый адрес push-сервиса")


@router.get("/public-key", response_model=PublicKeyOut)
def public_key():
    """Публичный VAPID-ключ: передаётся в pushManager.subscribe как applicationServerKey."""
    _require_enabled()
    return PublicKeyOut(public_key=settings.vapid_public_key)


@router.post("/subscribe", response_model=SubscribeOut, status_code=status.HTTP_201_CREATED)
def subscribe(
    data: PushSubscribeIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Сохраняет подписку браузера. Повторная подписка того же endpoint обновляет запись."""
    _require_enabled()
    _check_endpoint(data.endpoint)

    sub = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == data.endpoint))
    if sub is None:
        sub = PushSubscription(
            user_id=user.id,
            endpoint=data.endpoint,
            p256dh=data.keys.p256dh,
            auth=data.keys.auth,
        )
        db.add(sub)
    else:  # тот же браузер, возможно под другим аккаунтом
        sub.user_id = user.id
        sub.p256dh = data.keys.p256dh
        sub.auth = data.keys.auth
    sub.user_agent = request.headers.get("user-agent", "")[:200]
    sub.failed_count = 0
    db.flush()

    # храним не больше N последних подписок пользователя
    ids = db.scalars(
        select(PushSubscription.id)
        .where(PushSubscription.user_id == user.id)
        .order_by(PushSubscription.id.desc())
    ).all()
    for old_id in ids[MAX_SUBSCRIPTIONS_PER_USER:]:
        db.execute(delete(PushSubscription).where(PushSubscription.id == old_id))

    try:
        db.commit()
    except IntegrityError:  # две одновременные подписки с одним endpoint
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Подписка уже обрабатывается, повторите запрос")

    return SubscribeOut(subscriptions=min(len(ids), MAX_SUBSCRIPTIONS_PER_USER))


@router.post("/unsubscribe", status_code=status.HTTP_204_NO_CONTENT)
def unsubscribe(
    data: PushUnsubscribeIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    db.execute(
        delete(PushSubscription).where(
            PushSubscription.endpoint == data.endpoint, PushSubscription.user_id == user.id
        )
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/test", response_model=PushTestOut)
def test_push(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Отправляет тестовое уведомление на все устройства пользователя."""
    _require_enabled()
    sent, total = send_to_user(
        db,
        user.id,
        {
            "title": "Тестовое уведомление",
            "body": "Push-уведомления работают.",
            "tag": "push-test",
            "severity": "info",
            "data": {"type": "test"},
        },
    )
    if total == 0:
        raise HTTPException(status.HTTP_409_CONFLICT, "Нет ни одной подписки, сначала подпишитесь")
    return PushTestOut(sent=sent, subscriptions=total)