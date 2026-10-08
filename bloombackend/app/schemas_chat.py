from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ChatSend(BaseModel):
    message: str = Field(min_length=1, max_length=2000)

    @field_validator("message", mode="before")
    @classmethod
    def strip(cls, v):
        return v.strip() if isinstance(v, str) else v


class ChatMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    role: Literal["user", "assistant"]
    content: str
    model: str | None
    created_at: datetime

    @field_validator("created_at")
    @classmethod
    def utc(cls, v: datetime):
        return v.replace(tzinfo=timezone.utc) if v.tzinfo is None else v


class ChatReplyOut(BaseModel):
    user_message: ChatMessageOut
    assistant_message: ChatMessageOut