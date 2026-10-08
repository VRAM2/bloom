from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Device, DeviceCommand, utcnow
from app.schemas_commands import (
    ActuatorReportIn,
    ActuatorStateOut,
    CurtainState,
    FanState,
    LampState,
    PumpState,
    SwitchState,
)

LAMP_COLORS = ("blue", "dark_red", "red", "strip")

def _aware(dt: datetime | None) -> datetime | None:
    # SQLite отдаёт время без часового пояса, а мы храним всё в UTC
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _latest_done(db: Session, plant_id: int, command_type: str, limit: int = 1):
    return db.scalars(
        select(DeviceCommand)
        .where(
            DeviceCommand.plant_id == plant_id,
            DeviceCommand.status == "done",
            DeviceCommand.command_type == command_type,
        )
        .order_by(DeviceCommand.finished_at.desc(), DeviceCommand.id.desc())
        .limit(limit)
    ).all()


def get_actuator_state(db: Session, plant_id: int, now: datetime | None = None) -> ActuatorStateOut:
    now = now or utcnow()

    # --- насос ---
    pump = PumpState()
    rows = _latest_done(db, plant_id, "pump")
    if rows:
        cmd = rows[0]
        started = _aware(cmd.finished_at)
        if cmd.payload.get("action") == "on":
            duration = cmd.payload.get("duration_sec")
            if duration:
                until = started + timedelta(seconds=duration)
                running = now < until
                pump = PumpState(
                    is_on=running,
                    until=until if running else None,
                    updated_at=started if running else until,
                )
            else:
                pump = PumpState(is_on=True, updated_at=started)
        else:
            pump = PumpState(is_on=False, updated_at=started)

    # --- вентиляторы (по каждому номеру отдельно) ---
    fans = {n: FanState(number=n) for n in (1, 2, 3)}
    seen: set[int] = set()
    for cmd in _latest_done(db, plant_id, "fan", limit=50):
        at = _aware(cmd.finished_at)
        is_on = cmd.payload.get("action") == "on"
        for n in cmd.payload.get("fans", [1, 2, 3]):
            if n not in seen:
                seen.add(n)
                fans[n] = FanState(number=n, is_on=is_on, updated_at=at)
        if len(seen) == 3:
            break

    # --- лампа ---
    lamps = {c: LampState(color=c) for c in LAMP_COLORS}
    seen_colors: set[str] = set()
    for cmd in _latest_done(db, plant_id, "lamp", limit=200):
        at = _aware(cmd.finished_at)
        action = cmd.payload.get("action")
        color = cmd.payload.get("color")
        # команда без цвета (старый формат или «выключить все») относится ко всем лампам
        targets = [color] if color else list(LAMP_COLORS)
        for c in targets:
            if c not in lamps or c in seen_colors:
                continue
            seen_colors.add(c)
            if action == "on":
                lamps[c] = LampState(
                    color=c, is_on=True, brightness=cmd.payload.get("brightness"), updated_at=at
                )
            else:
                lamps[c] = LampState(color=c, is_on=False, updated_at=at)
        if len(seen_colors) == len(LAMP_COLORS):
            break

    # --- увлажнитель ---
    humidifier = SwitchState()
    rows = _latest_done(db, plant_id, "humidifier")
    if rows:
        humidifier = SwitchState(
            is_on=rows[0].payload.get("action") == "on",
            updated_at=_aware(rows[0].finished_at),
        )

    # --- штора ---
    curtain = CurtainState()
    rows = _latest_done(db, plant_id, "curtain")
    if rows:
        curtain = CurtainState(
            state="open" if rows[0].payload.get("action") == "open" else "closed",
            updated_at=_aware(rows[0].finished_at),
        )

    pending = db.scalar(
        select(func.count())
        .select_from(DeviceCommand)
        .where(
            DeviceCommand.plant_id == plant_id,
            DeviceCommand.status.in_(("pending", "sent")),
        )
    )

    return ActuatorStateOut(
        pump=pump,
        fans=[fans[1], fans[2], fans[3]],
        lamps=[lamps[c] for c in LAMP_COLORS],
        humidifier=humidifier,
        curtain=curtain,
        pending_commands=pending or 0,
        as_of=now,
    )

def apply_device_report(db: Session, device: Device, data: ActuatorReportIn, now: datetime) -> int:
    """Записывает только то, что отличается от известного серверу состояния. Возвращает число записей."""
    current = get_actuator_state(db, device.plant_id, now)
    changes: list[tuple[str, dict]] = []

    # --- насос ---
    if data.pump is not None and current.pump.is_on != data.pump.is_on:
        payload: dict = {"action": "on" if data.pump.is_on else "off"}
        if data.pump.is_on and data.pump.duration_sec:
            payload["duration_sec"] = data.pump.duration_sec
        changes.append(("pump", payload))

    # --- вентиляторы: отдельные записи для включённых и выключенных ---
    if data.fans:
        known = {f.number: f.is_on for f in current.fans}
        to_on = sorted(f.number for f in data.fans if f.is_on and known[f.number] != True)  # noqa: E712
        to_off = sorted(f.number for f in data.fans if not f.is_on and known[f.number] != False)  # noqa: E712
        if to_on:
            changes.append(("fan", {"action": "on", "fans": to_on}))
        if to_off:
            changes.append(("fan", {"action": "off", "fans": to_off}))

    # --- лампа ---
    current_lamps = {lamp.color: lamp for lamp in current.lamps}
    for new in data.lamp_reports:
        cur = current_lamps[new.color]
        if new.is_on:
            if not (cur.is_on is True and cur.brightness == new.brightness):
                changes.append(
                    ("lamp", {"action": "on", "color": new.color, "brightness": new.brightness})
                )
        elif cur.is_on is not False:
            changes.append(("lamp", {"action": "off", "color": new.color}))

    # --- увлажнитель ---
    if data.humidifier is not None and current.humidifier.is_on != data.humidifier.is_on:
        changes.append(("humidifier", {"action": "on" if data.humidifier.is_on else "off"}))

    # --- штора ---
    if data.curtain is not None and current.curtain.state != data.curtain.state:
        changes.append(
            ("curtain", {"action": "open" if data.curtain.state == "open" else "close"})
        )

    for command_type, payload in changes:
        db.add(
            DeviceCommand(
                plant_id=device.plant_id,
                device_id=device.id,
                command_type=command_type,
                payload={**payload, "origin": "device", "reason": data.reason},
                status="done",
                created_at=now,
                sent_at=now,
                finished_at=now,
            )
        )
    return len(changes)