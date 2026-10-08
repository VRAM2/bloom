from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import Base, engine
from app.routers import auth, care, chat, commands, notifications, plants, push, sensors, device
from app.scheduler import start_scheduler, stop_scheduler
from app.paths import UPLOAD_DIR


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)  # создаёт недостающие таблицы
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title="Smart Greenhouse API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(auth.router)
app.include_router(plants.router)
app.include_router(care.router)
app.include_router(sensors.router)
app.include_router(commands.router)
app.include_router(chat.router)
app.include_router(notifications.router)
app.include_router(push.router)
app.include_router(device.router)

app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


@app.get("/health")
def health():
    return {"status": "ok"}