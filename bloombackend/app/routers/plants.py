from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session
import shutil
from pathlib import Path
import io
import uuid

from fastapi import File, UploadFile
from PIL import Image, ImageOps

from app.paths import PLANT_PHOTO_DIR
from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.models import Plant, User
from app.schemas import PlantCreate, PlantNormalizeIn, PlantNormalizeOut, PlantOut
from app.services.llm_service import normalize_plant

router = APIRouter(prefix="/plants", tags=["plants"])

MAX_PHOTO_BYTES = 15 * 1024 * 1024


@router.post("/normalize", response_model=PlantNormalizeOut)
def preview_normalization(data: PlantNormalizeIn, _: User = Depends(get_current_user)):
    """Предпросмотр: как Mistral исправит название и вид (без сохранения)."""
    result = normalize_plant(data.name, data.species)
    if result is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Сервис распознавания недоступен")
    return PlantNormalizeOut(**result.model_dump())


@router.post("", response_model=PlantOut, status_code=status.HTTP_201_CREATED)
def create_plant(
    data: PlantCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = normalize_plant(data.name, data.species)

    plant = Plant(
        user_id=user.id,
        name_original=data.name,
        species_original=data.species,
        name=result.name if result else data.name,
        species=result.species if result else data.species,
        ai_normalized=bool(result and result.confident),
        planted_at=data.planted_at,
    )
    db.add(plant)
    db.commit()
    db.refresh(plant)
    return plant


@router.get("", response_model=list[PlantOut])
def list_plants(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    stmt = select(Plant).where(Plant.user_id == user.id).order_by(Plant.created_at.desc())
    return db.scalars(stmt).all()

@router.post("/{plant_id}/photo", response_model=PlantOut)
def upload_plant_photo(
    plant_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    plant = db.get(Plant, plant_id)
    if plant is None or plant.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Растение не найдено")

    data = file.file.read(MAX_PHOTO_BYTES + 1)
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Файл слишком большой")

    try:
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img).convert("RGB")  # поворот с телефона
        img.thumbnail((1600, 1600))
    except Exception:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Это не изображение")

    name = f"{plant_id}-{uuid.uuid4().hex}.jpg"
    img.save(PLANT_PHOTO_DIR / name, "JPEG", quality=85)

    old = plant.photo_url
    plant.photo_url = f"/uploads/plants/{name}"
    db.commit()
    db.refresh(plant)

    if old:  # старое удаляем только после успешного коммита
        (PLANT_PHOTO_DIR / Path(old).name).unlink(missing_ok=True)
    return plant

@router.delete("/{plant_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_plant(
    plant_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    plant = db.get(Plant, plant_id)
    if plant is None or plant.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Растение не найдено")
    db.delete(plant)
    db.commit()
    shutil.rmtree(Path(settings.photos_dir) / str(plant_id), ignore_errors=True)
    if plant.photo_url:
        (PLANT_PHOTO_DIR / Path(plant.photo_url).name).unlink(missing_ok=True)
    return Response(status_code=status.HTTP_204_NO_CONTENT)