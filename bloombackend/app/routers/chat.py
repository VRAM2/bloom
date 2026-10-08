from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import ChatMessage, Plant, User, utcnow
from app.schemas_chat import ChatMessageOut, ChatReplyOut, ChatSend
from app.services.chat_service import generate_reply

router = APIRouter(tags=["chat"])

MAX_USER_MESSAGES_PER_MINUTE = 10  # защита квоты нейросети


def _own_plant(db: Session, plant_id: int, user: User) -> Plant:
    plant = db.get(Plant, plant_id)
    if plant is None or plant.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Растение не найдено")
    return plant


@router.post(
    "/plants/{plant_id}/chat",
    response_model=ChatReplyOut,
    status_code=status.HTTP_201_CREATED,
)
def send_message(
    plant_id: int,
    data: ChatSend,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Отправить сообщение нейросети. Сообщение пользователя сохраняется всегда."""
    plant = _own_plant(db, plant_id, user)

    recent = db.scalar(
        select(func.count())
        .select_from(ChatMessage)
        .where(
            ChatMessage.plant_id == plant.id,
            ChatMessage.role == "user",
            ChatMessage.created_at >= utcnow() - timedelta(minutes=1),
        )
    )
    if recent >= MAX_USER_MESSAGES_PER_MINUTE:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Слишком много сообщений, подождите минуту")

    user_msg = ChatMessage(plant_id=plant.id, role="user", content=data.message)
    db.add(user_msg)
    db.commit()
    db.refresh(user_msg)

    assistant_msg = generate_reply(db, plant)
    if assistant_msg is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "message": "Нейросеть недоступна. Сообщение сохранено, повторите ответ позже (POST /chat/retry).",
                "user_message_id": user_msg.id,
            },
        )
    return ChatReplyOut(user_message=user_msg, assistant_message=assistant_msg)


@router.post(
    "/plants/{plant_id}/chat/retry",
    response_model=ChatMessageOut,
    status_code=status.HTTP_201_CREATED,
)
def retry_reply(
    plant_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Повторить ответ, если последнее сообщение в чате от пользователя и ответа на него нет."""
    plant = _own_plant(db, plant_id, user)
    last = db.scalar(
        select(ChatMessage)
        .where(ChatMessage.plant_id == plant.id)
        .order_by(ChatMessage.id.desc())
        .limit(1)
    )
    if last is None or last.role != "user":
        raise HTTPException(status.HTTP_409_CONFLICT, "Нет сообщения, на которое нужно ответить")

    msg = generate_reply(db, plant)
    if msg is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Нейросеть недоступна, попробуйте позже")
    return msg


@router.get("/plants/{plant_id}/chat", response_model=list[ChatMessageOut])
def chat_history(
    plant_id: int,
    limit: int = Query(50, ge=1, le=200),
    before_id: int | None = Query(None, description="Вернуть сообщения старше этого id (для подгрузки)"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """История чата, от старых к новым."""
    plant = _own_plant(db, plant_id, user)
    stmt = select(ChatMessage).where(ChatMessage.plant_id == plant.id)
    if before_id is not None:
        stmt = stmt.where(ChatMessage.id < before_id)
    rows = db.scalars(stmt.order_by(ChatMessage.id.desc()).limit(limit)).all()
    rows.reverse()
    return rows