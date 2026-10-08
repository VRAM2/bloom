from app.deps import get_current_device, get_db
from app.models import Device, Plant
from app.schemas import PlantCareOut
from app.services.care_service import latest_care, get_care_for_today
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

router = APIRouter(tags=["care"])


@router.get("/device/care", response_model=PlantCareOut)
def device_care(
    db: Session = Depends(get_db),
    device: Device = Depends(get_current_device),
):
    """Благоприятные условия для растения устройства. Заголовок: X-Device-Key."""
    # сначала последняя сохранённая запись, чтобы не ждать нейросеть
    care = latest_care(db, device.plant_id)
    if care is None:
        plant = db.get(Plant, device.plant_id)
        care = get_care_for_today(db, plant) if plant else None
    if care is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Рекомендации пока недоступны"
        )
    return care