from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, field_validator


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    plant_id: int | None
    type: str
    severity: Literal["info", "warning", "critical"]
    title: str
    message: str
    data: dict[str, Any]
    is_read: bool
    created_at: datetime
    read_at: datetime | None

    @field_validator("created_at", "read_at")
    @classmethod
    def utc(cls, v: datetime | None):
        # SQLite отдаёт время без часового пояса, а мы храним всё в UTC
        if v is not None and v.tzinfo is None:
            return v.replace(tzinfo=timezone.utc)
        return v


class UnreadCountOut(BaseModel):
    unread: int
    critical: int
    warning: int
    info: int


class MarkedOut(BaseModel):
    updated: int