import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.models import (
    AlertState,
    Device,
    DeviceCommand,
    Notification,
    Plant,
    PlantCare,
    SensorReading,
    utcnow,
)
from app.schemas import CareAdvice
from app.services.actuator_service import get_actuator_state

logger = logging.getLogger(__name__)

SEVERITY_RANK = {"info": 0, "warning": 1, "critical": 2}

# (поле показаний, мин и макс в PlantCare, название, единица, минимальный абсолютный запас)
SENSOR_RULES = [
    ("air_temp_c", "air_temp_min_c", "air_temp_max_c", "температура воздуха", "°C", 1.5),
    ("air_humidity_pct", "air_humidity_min_pct", "air_humidity_max_pct", "влажность воздуха", "%", 3.0),
    ("soil_temp_c", "soil_temp_min_c", "soil_temp_max_c", "температура почвы", "°C", 1.5),
    ("soil_moisture_pct", "soil_moisture_min_pct", "soil_moisture_max_pct", "влажность почвы", "%", 3.0),
    ("light_lux", "light_lux_min", "light_lux_max", "освещённость", "лк", 500.0),
]

COMMAND_LABELS = {
    "pump": "Насос",
    "fan": "Вентиляторы",
    "lamp": "Лампа",
    "humidifier": "Увлажнитель",
    "camera": "Камера",
    "curtain": "Штора",
}


def _aware(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def _ago(minutes: int) -> str:
    minutes = max(minutes, 1)
    days, rest = divmod(minutes, 1440)
    hours, mins = divmod(rest, 60)
    parts = []
    if days:
        parts.append(f"{days} д")
    if hours:
        parts.append(f"{hours} ч")
    if mins and not days:
        parts.append(f"{mins} мин")
    return " ".join(parts)


def add_notification(
    db: Session,
    plant: Plant,
    *,
    kind: str,
    severity: str,
    title: str,
    message: str,
    data: dict | None = None,
    dedup_key: str | None = None,
    cooldown_minutes: int = 0,
) -> Notification | None:
    """Добавляет уведомление в сессию (commit делает вызывающий код).

    Push отсюда не отправляется: уведомление помечено pushed=False, его заберёт фоновая задача
    send_pending_push уже после коммита транзакции.
    Если задан dedup_key и cooldown_minutes, одинаковое уведомление не создаётся чаще, чем раз в cooldown.
    """
    if dedup_key and cooldown_minutes > 0:
        last = db.scalar(
            select(Notification.created_at)
            .where(Notification.plant_id == plant.id, Notification.dedup_key == dedup_key)
            .order_by(Notification.id.desc())
            .limit(1)
        )
        if last is not None and utcnow() - _aware(last) < timedelta(minutes=cooldown_minutes):
            return None

    notification = Notification(
        user_id=plant.user_id,
        plant_id=plant.id,
        type=kind,
        severity=severity,
        title=title[:150],
        message=message,
        data=data or {},
        dedup_key=dedup_key,
    )
    db.add(notification)
    return notification


# ------------------------------------------------------- благоприятные условия
def _rng(lo: float, hi: float, unit: str) -> str:
    return f"{lo:g}–{hi:g} {unit}"


def notify_care_updated(db: Session, plant: Plant, care: PlantCare) -> None:
    """Два отдельных уведомления: «условия обновлены» и заметка нейросети."""
    data = {k: getattr(care, k) for k in CareAdvice.model_fields if k != "notes"}
    data["for_date"] = care.for_date.isoformat()

    message = (
        f"Стадия: {care.growth_stage}. "
        f"Температура воздуха {_rng(care.air_temp_min_c, care.air_temp_max_c, '°C')}, "
        f"влажность воздуха {_rng(care.air_humidity_min_pct, care.air_humidity_max_pct, '%')}, "
        f"температура почвы {_rng(care.soil_temp_min_c, care.soil_temp_max_c, '°C')}, "
        f"влажность почвы {_rng(care.soil_moisture_min_pct, care.soil_moisture_max_pct, '%')}, "
        f"освещённость {_rng(care.light_lux_min, care.light_lux_max, 'лк')}."
    )
    add_notification(
        db,
        plant,
        kind="care_updated",
        severity="info",
        title=f"{plant.name}: условия на сегодня обновлены",
        message=message,
        data=data,
    )

    notes = (care.notes or "").strip()
    if notes:
        add_notification(
            db,
            plant,
            kind="care_notes",
            severity="info",
            title=f"{plant.name}: заметка на сегодня",
            message=notes,
            data={"for_date": care.for_date.isoformat()},
        )


# ------------------------------------------- состояния тревог и восстановление
Status = tuple[str, str | None]  # (severity, side)


def _update_alert(
    db: Session,
    plant: Plant,
    key: str,
    status: Status | None,
    *,
    can_recover: bool,
    reminder_minutes: int,
    alert: dict | None,
    recovery: dict,
) -> None:
    """Единая логика для датчиков, воды и устройств.

    status: текущий уровень тревоги или None, если тревоги нет.
    can_recover: значение вернулось в норму настолько, что тревогу можно закрыть.
    alert / recovery: готовые аргументы для add_notification. В message восстановления
    плейсхолдер {duration} заменяется на длительность проблемы.
    """
    now = utcnow()
    state = db.scalar(
        select(AlertState).where(AlertState.plant_id == plant.id, AlertState.key == key)
    )

    if status is not None and alert is not None:
        severity, side = status

        if state is None:
            db.add(
                AlertState(
                    plant_id=plant.id,
                    key=key,
                    severity=severity,
                    side=side,
                    started_at=now,
                    last_notified_at=now,
                )
            )
            add_notification(db, plant, **alert)
            return

        since_last = now - _aware(state.last_notified_at)
        escalated = side != state.side or SEVERITY_RANK[severity] > SEVERITY_RANK[state.severity]
        reminder_due = reminder_minutes > 0 and since_last >= timedelta(minutes=reminder_minutes)

        if escalated:
            # слишком частые повышения (дребезг у границы) пропускаем; запись не трогаем,
            # поэтому следующее показание повторит попытку
            if since_last >= timedelta(minutes=settings.alert_escalation_gap_minutes):
                state.severity, state.side, state.last_notified_at = severity, side, now
                add_notification(db, plant, **alert)
        elif reminder_due:
            state.severity, state.last_notified_at = severity, now
            add_notification(db, plant, **alert)
        else:
            state.severity = severity  # снижение критичности без уведомления
        return

    if state is not None and can_recover:
        minutes = int((now - _aware(state.started_at)).total_seconds() // 60)
        message = recovery["message"].replace("{duration}", f" Проблема длилась {_ago(minutes)}.")
        add_notification(db, plant, **{**recovery, "message": message})
        db.delete(state)


def _evaluate(value: float, lo: float, hi: float, floor: float) -> tuple[Status | None, bool]:
    """Возвращает (статус тревоги или None, вернулось ли значение внутрь диапазона)."""
    if lo <= value <= hi:
        return None, True

    side, bound, dist = ("low", lo, lo - value) if value < lo else ("high", hi, value - hi)

    def margin(pct: float) -> float:
        return max(abs(bound) * pct / 100, floor)

    if dist > margin(settings.alert_critical_margin_pct):
        return ("critical", side), False
    if dist > margin(settings.alert_warning_margin_pct):
        return ("warning", side), False
    return None, False  # чуть вне диапазона: тревоги ещё нет, но и «восстановления» тоже


# ------------------------------------------------------------ показания датчиков
def check_reading(db: Session, plant_id: int, reading: SensorReading) -> None:
    """Проверяет новые показания: вода в баке и отклонения от благоприятных условий."""
    plant = db.get(Plant, plant_id)
    if plant is None:
        return

    # --- вода в баке ---
    level = reading.water_level_pct
    if level is not None:
        status: Status | None = None
        text = ""
        if level < settings.water_low_critical_pct:
            status = ("critical", None)
            text = f"Бак для полива почти пуст: осталось {level:g}%. Долейте воду, иначе полив невозможен."
        elif level < settings.water_low_warning_pct:
            status = ("warning", None)
            text = f"В баке для полива осталось {level:g}% воды. Пора долить."

        _update_alert(
            db,
            plant,
            "water_low",
            status,
            can_recover=level >= settings.water_low_warning_pct + settings.water_recovery_hysteresis_pct,
            reminder_minutes=settings.water_alert_cooldown_minutes,
            alert=(
                dict(
                    kind="water_low",
                    severity=status[0],
                    title=f"{plant.name}: мало воды в баке",
                    message=text,
                    data={"water_level_pct": level},
                    dedup_key="water_low",
                )
                if status
                else None
            ),
            recovery=dict(
                kind="water_recovered",
                severity="info",
                title=f"{plant.name}: бак пополнен",
                message=f"Уровень воды в баке: {level:g}%. Всё в порядке." + "{duration}",
                data={"water_level_pct": level},
                dedup_key="water_low",
            ),
        )

    # --- сравнение с благоприятными условиями ---
    care = db.scalar(
        select(PlantCare)
        .where(PlantCare.plant_id == plant_id)
        .order_by(PlantCare.for_date.desc())
        .limit(1)
    )
    if care is not None:
        lamp_on: bool | None = None  # считаем лениво и только при необходимости

        for field, lo_f, hi_f, label, unit, floor in SENSOR_RULES:
            value = getattr(reading, field)
            if value is None:
                continue
            lo, hi = getattr(care, lo_f), getattr(care, hi_f)
            status, in_range = _evaluate(value, lo, hi, floor)

            # низкая освещённость нормальна без света: проверяем, только если включена лампа
            if field == "light_lux" and status and status[1] == "low":
                if lamp_on is None:
                    lamp_on = any(lamp.is_on for lamp in get_actuator_state(db, plant_id).lamps)
                if not lamp_on:
                    continue

            key = f"sensor:{field}"
            details = {"metric": field, "value": value, "min": lo, "max": hi, "unit": unit}

            alert = None
            if status:
                severity, side = status
                adjective = "низкая" if side == "low" else "высокая"
                comparison = "ниже" if side == "low" else "выше"
                alert = dict(
                    kind="sensor_alert",
                    severity=severity,
                    title=f"{plant.name}: слишком {adjective} {label}",
                    message=(
                        f"{label.capitalize()}: {value:g} {unit}, это {comparison} благоприятного "
                        f"диапазона {_rng(lo, hi, unit)}."
                    ),
                    data={**details, "side": side},
                    dedup_key=key,
                )

            _update_alert(
                db,
                plant,
                key,
                status,
                can_recover=in_range,
                reminder_minutes=settings.alert_cooldown_minutes,
                alert=alert,
                recovery=dict(
                    kind="sensor_recovered",
                    severity="info",
                    title=f"{plant.name}: {label} снова в норме",
                    message=(
                        f"{label.capitalize()}: {value:g} {unit}, в благоприятном диапазоне "
                        f"{_rng(lo, hi, unit)}." + "{duration}"
                    ),
                    data=details,
                    dedup_key=key,
                ),
            )

    db.commit()


# ------------------------------------------------------------------- команды
def notify_command_failed(db: Session, cmd: DeviceCommand) -> None:
    plant = db.get(Plant, cmd.plant_id)
    if plant is None:
        return
    label = COMMAND_LABELS.get(cmd.command_type, cmd.command_type)
    text = f"{label}: устройство не смогло выполнить команду."
    if cmd.result_message:
        text += f" Причина: {cmd.result_message}"
    add_notification(
        db,
        plant,
        kind="command_failed",
        severity="warning",
        title=f"{plant.name}: команда не выполнена",
        message=text,
        data={"command_id": cmd.id, "command_type": cmd.command_type},
        dedup_key=f"cmd_failed:{cmd.id}",
    )


# --------------------------------------------------------- фоновые задачи
def check_offline_devices() -> None:
    """Запускается планировщиком: тревога «устройство пропало» и восстановление связи."""
    now = utcnow()
    threshold = now - timedelta(minutes=settings.device_offline_minutes)
    prefix = "device_offline:"

    with SessionLocal() as db:
        states = db.scalars(select(AlertState).where(AlertState.key.startswith(prefix))).all()
        active_ids = {int(s.key[len(prefix):]) for s in states}

        condition = Device.last_seen_at < threshold
        if active_ids:
            condition = or_(condition, Device.id.in_(active_ids))
        devices = db.scalars(
            select(Device).where(Device.last_seen_at.is_not(None), condition)
        ).all()

        # устройство удалено: тревога больше не нужна
        found_ids = {d.id for d in devices}
        for state in states:
            if int(state.key[len(prefix):]) not in found_ids:
                db.delete(state)

        for device in devices:
            plant = db.get(Plant, device.plant_id)
            if plant is None:
                continue

            last_seen = _aware(device.last_seen_at)
            offline = last_seen < threshold
            minutes = int((now - last_seen).total_seconds() // 60)
            key = f"{prefix}{device.id}"

            _update_alert(
                db,
                plant,
                key,
                ("warning", None) if offline else None,
                can_recover=not offline,
                reminder_minutes=settings.device_offline_cooldown_minutes,
                alert=(
                    dict(
                        kind="device_offline",
                        severity="warning",
                        title=f"{plant.name}: устройство «{device.name}» не выходит на связь",
                        message=f"Последний сигнал был {_ago(minutes)} назад. Проверьте питание и Wi-Fi.",
                        data={"device_id": device.id, "minutes_offline": minutes},
                        dedup_key=key,
                    )
                    if offline
                    else None
                ),
                recovery=dict(
                    kind="device_online",
                    severity="info",
                    title=f"{plant.name}: устройство «{device.name}» снова на связи",
                    message="Связь восстановлена." + "{duration}",
                    data={"device_id": device.id},
                    dedup_key=key,
                ),
            )
        db.commit()


def cleanup_old_notifications() -> None:
    cutoff = utcnow() - timedelta(days=settings.notifications_retention_days)
    with SessionLocal() as db:
        db.execute(delete(Notification).where(Notification.created_at < cutoff))
        db.commit()