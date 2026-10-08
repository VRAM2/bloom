from pydantic import BaseModel, Field


class PushKeys(BaseModel):
    p256dh: str = Field(min_length=10, max_length=200)
    auth: str = Field(min_length=10, max_length=100)


class PushSubscribeIn(BaseModel):
    """Формат совпадает с subscription.toJSON() в браузере (лишнее поле expirationTime игнорируется)."""

    endpoint: str = Field(min_length=10, max_length=1000)
    keys: PushKeys


class PushUnsubscribeIn(BaseModel):
    endpoint: str = Field(min_length=10, max_length=1000)


class PublicKeyOut(BaseModel):
    public_key: str


class SubscribeOut(BaseModel):
    subscriptions: int  # сколько устройств подписано у этого пользователя


class PushTestOut(BaseModel):
    sent: int
    subscriptions: int