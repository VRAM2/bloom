from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Literal


class Settings(BaseSettings):
    database_url: str = "sqlite:///./greenhouse.db"

    secret_key: str
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7  # 7 дней

    google_api_key: str
    google_models: list[str] = ["gemini-3.5-flash-lite", "gemini-2.5-flash-lite"]
    google_api_base: str = "https://generativelanguage.googleapis.com/v1beta"
    google_timeout_sec: float = 30.0

    # Ежедневное обновление рекомендаций
    scheduler_enabled: bool = True
    scheduler_timezone: str = "UTC"
    scheduler_hour: int = 3
    scheduler_minute: int = 0
    scheduler_run_on_startup: bool = True  # догнать пропущенное, если сервер был выключен

    cors_origins: list[str] = ["http://localhost:5173"]

    model_config = SettingsConfigDict(env_file=".env")

    # Команды устройствам и фото
    command_ttl_sec: int = 120              # через сколько «невзятая» команда протухает
    command_result_timeout_sec: int = 300   # через сколько «взятая» без ответа считается неудачной
    photos_dir: str = "photos"
    max_photo_bytes: int = 2_000_000
    max_photos_per_plant: int = 50          # старые снимки удаляются
    # Уведомления
    alert_warning_margin_pct: float = 20.0    # выход за границу диапазона -> warning
    alert_critical_margin_pct: float = 40.0   # -> critical
    alert_cooldown_minutes: int = 180         # повтор одинакового предупреждения по датчику
    water_low_warning_pct: float = 20.0
    water_low_critical_pct: float = 10.0
    water_alert_cooldown_minutes: int = 360
    device_offline_minutes: int = 10          # сколько молчит устройство до тревоги
    device_offline_cooldown_minutes: int = 720
    notifications_retention_days: int = 30
        # Восстановления и тревоги
    water_recovery_hysteresis_pct: float = 5.0  # «бак пополнен» при уровне >= порог warning + это значение
    alert_escalation_gap_minutes: int = 10      # не чаще, чем раз в N минут повышать тревогу по одному параметру

    # Web Push
    vapid_private_key: str = ""
    vapid_public_key: str = ""
    vapid_subject: str = "mailto:vadimram8@gmail.com"
    push_ttl_sec: int = 3600           # сколько push-сервис хранит сообщение, если устройство офлайн
    push_max_age_minutes: int = 30     # более старые уведомления как push не отправляем
    push_min_severity: Literal["info", "warning", "critical"] = "info"
    push_skip_types: list[str] = []    # типы, которые не нужно слать как push, например ["care_updated"]
    push_allowed_hosts: list[str] = [
        "fcm.googleapis.com",
        "push.services.mozilla.com",
        "push.apple.com",
        "notify.windows.com",
    ]


settings = Settings()