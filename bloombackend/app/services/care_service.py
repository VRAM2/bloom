import logging
from datetime import date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.models import Plant, PlantCare
from app.services.llm_service import get_care_advice
from app.services.notification_service import notify_care_updated

logger = logging.getLogger(__name__)

# (макс. возраст в днях, подпись). Подпись попадает в промпт и в ключ кэша.
_AGE_BUCKETS = [
    (14, "меньше 2 недель"),
    (30, "2–4 недели"),
    (90, "1–3 месяца"),
    (180, "3–6 месяцев"),
    (365, "6–12 месяцев"),
]


def today_local() -> date:
    return datetime.now(ZoneInfo(settings.scheduler_timezone)).date()


def age_label(planted_at: date, today: date) -> str:
    days = max((today - planted_at).days, 0)
    for limit, label in _AGE_BUCKETS:
        if days <= limit:
            return label
    return "больше года"


def _care_for_date(db: Session, plant_id: int, day: date) -> PlantCare | None:
    return db.scalar(
        select(PlantCare).where(PlantCare.plant_id == plant_id, PlantCare.for_date == day)
    )


def latest_care(db: Session, plant_id: int) -> PlantCare | None:
    return db.scalar(
        select(PlantCare)
        .where(PlantCare.plant_id == plant_id)
        .order_by(PlantCare.for_date.desc())
        .limit(1)
    )


def get_care_for_today(db: Session, plant: Plant) -> PlantCare | None:
    """Запись на сегодня: из БД, а если её нет — запрашивает у нейросети и сохраняет."""
    today = today_local()

    existing = _care_for_date(db, plant.id, today)
    if existing:
        return existing

    advice = get_care_advice(plant.name, plant.species, age_label(plant.planted_at, today), today)
    if advice is None:
        return None

    care = PlantCare(plant_id=plant.id, for_date=today, **advice.model_dump())
    db.add(care)
    notify_care_updated(db, plant, care) 
    try:
        db.commit()
    except IntegrityError:  # параллельный запрос или другой воркер успел раньше
        db.rollback()
        return _care_for_date(db, plant.id, today)
    db.refresh(care)
    return care


def refresh_all_plants() -> None:
    """Ежедневная задача: готовит рекомендации на сегодня для всех растений."""
    today = today_local()
    logger.info("Ежедневное обновление рекомендаций: старт (%s)", today)

    created = failed_in_row = 0
    with SessionLocal() as db:
        done = set(db.scalars(select(PlantCare.plant_id).where(PlantCare.for_date == today)))
        plants = db.scalars(select(Plant)).all()

        for plant in plants:
            if plant.id in done:
                continue
            try:
                care = get_care_for_today(db, plant)
            except Exception:
                logger.exception("Ошибка для растения id=%s", plant.id)
                db.rollback()
                care = None

            if care is None:
                failed_in_row += 1
                if failed_in_row >= 3:
                    logger.error("3 неудачи подряд, прерываю (повтор при следующем запуске/запросе)")
                    break
            else:
                failed_in_row = 0
                created += 1

    logger.info("Ежедневное обновление завершено: создано записей %d", created)