
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Plant
from app.schemas import PlantCareOut
from app.services.care_service import latest_care, get_care_for_today

router = APIRouter(tags=["care"])


@router.get(
    "/plants/{plant_id}/device/care",
    response_model=PlantCareOut,
)
def device_care(
    plant_id: int,
    db: Session = Depends(get_db),
):
    plant = db.get(Plant, plant_id)
    if plant is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "Растение не найдено",
        )

    care = latest_care(db, plant.id)
    if care is None:
        care = get_care_for_today(db, plant)

    if care is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Рекомендации пока недоступны",
        )

    return care
