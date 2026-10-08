from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Plant, User
from app.schemas import PlantCareOut
from app.services.care_service import get_care_for_today, latest_care

router = APIRouter(prefix="/plants", tags=["care"])


@router.get("/{plant_id}/care", response_model=PlantCareOut)
def get_plant_care(
    plant_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Благоприятные условия для растения на сегодня.

    Если запись на сегодня ещё не создана, она генерируется нейросетью по запросу.
    Если нейросеть недоступна, возвращается последняя сохранённая запись (смотри for_date).
    """
    plant = db.get(Plant, plant_id)
    if plant is None or plant.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Растение не найдено")

    care = get_care_for_today(db, plant)
    if care is None:
        care = latest_care(db, plant.id)
    if care is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Не удалось получить рекомендации, попробуйте позже",
        )
    return care