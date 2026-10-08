from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent  # корень бэка, рядом с greenhouse.db
UPLOAD_DIR = BASE_DIR / "uploads"
PLANT_PHOTO_DIR = UPLOAD_DIR / "plants"
PLANT_PHOTO_DIR.mkdir(parents=True, exist_ok=True)