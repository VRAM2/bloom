from datetime import date, datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    true,
)

from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    plants: Mapped[list["Plant"]] = relationship(
        back_populates="owner", cascade="all, delete-orphan"
    )


class Plant(Base):
    __tablename__ = "plants"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    # Нормализованные значения (то, что показываем в приложении)
    name: Mapped[str] = mapped_column(String(100))
    species: Mapped[str] = mapped_column(String(150))

    # Исходный ввод пользователя
    name_original: Mapped[str] = mapped_column(String(100))
    species_original: Mapped[str] = mapped_column(String(150))

    planted_at: Mapped[date] = mapped_column(Date)
    ai_normalized: Mapped[bool] = mapped_column(Boolean, default=False)
    photo_url: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    owner: Mapped["User"] = relationship(back_populates="plants")
    care_records: Mapped[list["PlantCare"]] = relationship(
        back_populates="plant", cascade="all, delete-orphan"
    )
    # passive_deletes: показаний может быть очень много, удаляет их сама БД (ON DELETE CASCADE)
    devices: Mapped[list["Device"]] = relationship(
        cascade="all, delete-orphan", passive_deletes=True
    )
    sensor_readings: Mapped[list["SensorReading"]] = relationship(
        cascade="all, delete-orphan", passive_deletes=True
    )


class PlantCare(Base):
    """Благоприятные условия для растения на конкретный день (генерирует нейросеть)."""

    __tablename__ = "plant_care"
    __table_args__ = (UniqueConstraint("plant_id", "for_date", name="uq_plant_care_plant_date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    plant_id: Mapped[int] = mapped_column(
        ForeignKey("plants.id", ondelete="CASCADE"), index=True
    )
    for_date: Mapped[date] = mapped_column(Date)

    growth_stage: Mapped[str] = mapped_column(String(100))

    air_temp_min_c: Mapped[float] = mapped_column(Float)
    air_temp_max_c: Mapped[float] = mapped_column(Float)
    air_humidity_min_pct: Mapped[float] = mapped_column(Float)
    air_humidity_max_pct: Mapped[float] = mapped_column(Float)

    soil_temp_min_c: Mapped[float] = mapped_column(Float)
    soil_temp_max_c: Mapped[float] = mapped_column(Float)
    soil_moisture_min_pct: Mapped[float] = mapped_column(Float)
    soil_moisture_max_pct: Mapped[float] = mapped_column(Float)

    light_lux_min: Mapped[float] = mapped_column(Float)
    light_lux_max: Mapped[float] = mapped_column(Float)

    notes: Mapped[str] = mapped_column(Text, default="")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    plant: Mapped["Plant"] = relationship(back_populates="care_records")


class Device(Base):
    """Контроллер с датчиками, привязанный к растению. Аутентификация по ключу."""

    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(primary_key=True)
    plant_id: Mapped[int] = mapped_column(
        ForeignKey("plants.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(100))
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)  # sha256 hex
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SensorReading(Base):
    """Показания датчиков. Все значения необязательные: устройство может слать не всё."""

    __tablename__ = "sensor_readings"
    __table_args__ = (Index("ix_sensor_plant_time", "plant_id", "recorded_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    plant_id: Mapped[int] = mapped_column(ForeignKey("plants.id", ondelete="CASCADE"))
    device_id: Mapped[int | None] = mapped_column(
        ForeignKey("devices.id", ondelete="SET NULL"), nullable=True
    )
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    air_temp_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    air_humidity_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    soil_temp_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    soil_moisture_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    light_lux: Mapped[float | None] = mapped_column(Float, nullable=True)
    water_level_pct: Mapped[float | None] = mapped_column(Float, nullable=True)  # уровень воды в баке, %
    water_flow_l_min: Mapped[float | None] = mapped_column(Float, nullable=True)  # л/мин

class DeviceCommand(Base):
    """Команда исполнительному устройству (насос, вентиляторы, лампа и т.д.)."""

    __tablename__ = "device_commands"
    __table_args__ = (Index("ix_cmd_plant_status", "plant_id", "status"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    plant_id: Mapped[int] = mapped_column(ForeignKey("plants.id", ondelete="CASCADE"))
    device_id: Mapped[int | None] = mapped_column(
        ForeignKey("devices.id", ondelete="SET NULL"), nullable=True
    )

    command_type: Mapped[str] = mapped_column(String(20))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    # pending -> sent -> done | failed ; pending -> expired
    status: Mapped[str] = mapped_column(String(10), default="pending")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    result_message: Mapped[str | None] = mapped_column(String(200), nullable=True)


class Photo(Base):
    """Снимок с камеры. Сам файл лежит на диске: photos/<plant_id>/<id>.jpg."""

    __tablename__ = "photos"
    __table_args__ = (Index("ix_photo_plant", "plant_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    plant_id: Mapped[int] = mapped_column(ForeignKey("plants.id", ondelete="CASCADE"))
    device_id: Mapped[int | None] = mapped_column(
        ForeignKey("devices.id", ondelete="SET NULL"), nullable=True
    )
    command_id: Mapped[int | None] = mapped_column(
        ForeignKey("device_commands.id", ondelete="SET NULL"), nullable=True
    )
    filename: Mapped[str] = mapped_column(String(50))
    size_bytes: Mapped[int]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

class ChatMessage(Base):
    """Сообщение чата с нейросетью (и пользователя, и ИИ) по конкретному растению."""

    __tablename__ = "chat_messages"
    __table_args__ = (Index("ix_chat_plant_id_id", "plant_id", "id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    plant_id: Mapped[int] = mapped_column(ForeignKey("plants.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String(10))  # "user" | "assistant"
    content: Mapped[str] = mapped_column(Text)
    model: Mapped[str | None] = mapped_column(String(100), nullable=True)  # какая модель ответила
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

class Notification(Base):
    """Уведомление для пользователя (показывается на сайте)."""

    __tablename__ = "notifications"
    __table_args__ = (
        Index("ix_notif_user_read_id", "user_id", "is_read", "id"),
        Index("ix_notif_plant_key", "plant_id", "dedup_key"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    plant_id: Mapped[int | None] = mapped_column(
        ForeignKey("plants.id", ondelete="CASCADE"), nullable=True
    )

    type: Mapped[str] = mapped_column(String(30))
    severity: Mapped[str] = mapped_column(String(10))  # info | warning | critical
    title: Mapped[str] = mapped_column(String(150))
    message: Mapped[str] = mapped_column(Text)
    data: Mapped[dict] = mapped_column(JSON, default=dict)  # структурированные детали для UI
    dedup_key: Mapped[str | None] = mapped_column(String(100), nullable=True)

    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    pushed: Mapped[bool] = mapped_column(Boolean, default=False, server_default=true())

class AlertState(Base):
    """Активная тревога по параметру: нужна, чтобы слать «восстановление» и не спамить повторами."""

    __tablename__ = "alert_states"
    __table_args__ = (UniqueConstraint("plant_id", "key", name="uq_alert_plant_key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    plant_id: Mapped[int] = mapped_column(ForeignKey("plants.id", ondelete="CASCADE"))
    key: Mapped[str] = mapped_column(String(60))  # sensor:soil_moisture_pct, water_low, device_offline:3
    severity: Mapped[str] = mapped_column(String(10))
    side: Mapped[str | None] = mapped_column(String(10), nullable=True)  # low | high
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_notified_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PushSubscription(Base):
    """Подписка браузера на Web Push."""

    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    endpoint: Mapped[str] = mapped_column(String(1000), unique=True)
    p256dh: Mapped[str] = mapped_column(String(200))
    auth: Mapped[str] = mapped_column(String(100))
    user_agent: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failed_count: Mapped[int] = mapped_column(default=0)