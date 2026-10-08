from datetime import datetime, timezone
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

OnOff = Literal["on", "off"]
LampColor = Literal["blue", "dark_red", "red", "strip"]  # strip = лента (только вкл/выкл, без яркости)


# ---------- Тела запросов от пользователя (тип команды выбирается по полю "type") ----------
class PumpCmd(BaseModel):
    type: Literal["pump"]
    action: OnOff
    duration_sec: int | None = Field(
        default=None, ge=1, le=3600, description="Сколько секунд работать (только для action=on)"
    )

    @model_validator(mode="after")
    def check(self):
        if self.action == "off" and self.duration_sec is not None:
            raise ValueError("duration_sec допустим только при action=on")
        return self


class FanCmd(BaseModel):
    type: Literal["fan"]
    action: OnOff
    fans: list[Annotated[int, Field(ge=1, le=3)]] = Field(
        default_factory=lambda: [1, 2, 3], min_length=1, max_length=3
    )

    @field_validator("fans")
    @classmethod
    def unique_sorted(cls, v: list[int]):
        if len(set(v)) != len(v):
            raise ValueError("Номера вентиляторов не должны повторяться")
        return sorted(v)


class LampCmd(BaseModel):
    type: Literal["lamp"]
    action: OnOff
    color: LampColor | None = None  # при off: None = выключить все каналы, включая ленту
    brightness: int | None = Field(default=None, ge=1, le=100)

    @model_validator(mode="after")
    def check(self):
        if self.action == "on":
            if self.color is None:
                raise ValueError("Для action=on нужен color")
            if self.color == "strip":
                if self.brightness is not None:
                    raise ValueError("У ленты нет регулировки яркости: brightness не нужен")
            elif self.brightness is None:
                raise ValueError("Для ламп blue, dark_red и red нужна brightness")
        elif self.brightness is not None:
            raise ValueError("brightness допустима только при action=on")
        return self


class HumidifierCmd(BaseModel):
    type: Literal["humidifier"]
    action: OnOff


class CurtainCmd(BaseModel):
    type: Literal["curtain"]
    action: Literal["open", "close"]


class CameraCmd(BaseModel):
    type: Literal["camera"]


CommandCreate = Annotated[
    Union[PumpCmd, FanCmd, LampCmd, HumidifierCmd, CurtainCmd, CameraCmd],
    Field(discriminator="type"),
]


# ---------- Ответы ----------
def _utc(v: datetime | None) -> datetime | None:
    # SQLite отдаёт время без часового пояса, а мы храним всё в UTC
    if v is not None and v.tzinfo is None:
        return v.replace(tzinfo=timezone.utc)
    return v


class CommandOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    plant_id: int
    command_type: str
    payload: dict[str, Any]
    status: str
    created_at: datetime
    sent_at: datetime | None
    finished_at: datetime | None
    result_message: str | None

    @field_validator("created_at", "sent_at", "finished_at")
    @classmethod
    def utc(cls, v):
        return _utc(v)


class DeviceCommandOut(BaseModel):
    """Что получает ESP при опросе."""

    id: int
    type: str
    params: dict[str, Any]


class CommandResultIn(BaseModel):
    status: Literal["done", "failed"]
    message: str | None = Field(default=None, max_length=200)


class PhotoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    plant_id: int
    command_id: int | None
    size_bytes: int
    created_at: datetime

    @field_validator("created_at")
    @classmethod
    def utc(cls, v):
        return _utc(v)

# ---------- Состояние исполнителей ----------
class PumpState(BaseModel):
    is_on: bool | None = None  # None = неизвестно (команд ещё не было)
    until: datetime | None = None  # до какого времени работает (если задан duration_sec)
    updated_at: datetime | None = None


class FanState(BaseModel):
    number: int
    is_on: bool | None = None
    updated_at: datetime | None = None


class LampState(BaseModel):
    color: LampColor
    is_on: bool | None = None
    brightness: int | None = None
    updated_at: datetime | None = None


class SwitchState(BaseModel):
    is_on: bool | None = None
    updated_at: datetime | None = None


class CurtainState(BaseModel):
    state: Literal["open", "closed"] | None = None
    updated_at: datetime | None = None


class ActuatorStateOut(BaseModel):
    pump: PumpState
    fans: list[FanState]
    lamps: list[LampState]  # всегда три: blue, dark_red, red
    humidifier: SwitchState
    curtain: CurtainState
    pending_commands: int  # команды, ожидающие выполнения устройством
    as_of: datetime

# ---------- Отчёт ESP о состоянии исполнителей ----------
class PumpReport(BaseModel):
    is_on: bool
    duration_sec: int | None = Field(
        default=None, ge=1, le=3600, description="Если ESP сама запустила насос на заданное время"
    )

    @model_validator(mode="after")
    def check(self):
        if not self.is_on and self.duration_sec is not None:
            raise ValueError("duration_sec допустим только при is_on=true")
        return self


class FanReport(BaseModel):
    number: int = Field(ge=1, le=3)
    is_on: bool


class LampReport(BaseModel):
    color: LampColor
    is_on: bool
    brightness: int | None = Field(default=None, ge=1, le=100)

    @model_validator(mode="after")
    def check(self):
        if self.color == "strip":
            if self.brightness is not None:
                raise ValueError("У ленты нет яркости")
        elif self.is_on and self.brightness is None:
            raise ValueError("Для is_on=true нужна brightness")
        elif not self.is_on and self.brightness is not None:
            raise ValueError("brightness допустима только при is_on=true")
        return self

class SwitchReport(BaseModel):
    is_on: bool


class CurtainReport(BaseModel):
    state: Literal["open", "closed"]

class ActuatorReportIn(BaseModel):
    reason: Literal["sync", "manual", "auto"] = "sync"
    pump: PumpReport | None = None
    fans: list[FanReport] | None = Field(default=None, min_length=1, max_length=3)
    lamp: LampReport | None = None  # одна лампа
    lamps: list[LampReport] | None = Field(default=None, min_length=1, max_length=4)  # несколько каналов
    humidifier: SwitchReport | None = None
    curtain: CurtainReport | None = None

    @property
    def lamp_reports(self) -> list[LampReport]:
        items = list(self.lamps or [])
        if self.lamp is not None:
            items.append(self.lamp)
        return items

    @model_validator(mode="after")
    def check(self):
        if self.fans is not None:
            numbers = [f.number for f in self.fans]
            if len(set(numbers)) != len(numbers):
                raise ValueError("Номера вентиляторов не должны повторяться")
        colors = [lamp.color for lamp in self.lamp_reports]
        if len(set(colors)) != len(colors):
            raise ValueError("Цвета ламп не должны повторяться")
        if all(
            v is None
            for v in (self.pump, self.fans, self.lamp, self.lamps, self.humidifier, self.curtain)
        ):
            raise ValueError("Нужно передать состояние хотя бы одного устройства")
        return self

class ActuatorReportOut(BaseModel):
    recorded: int  # сколько изменений записано (0 = сервер уже знал это состояние)
    state: ActuatorStateOut