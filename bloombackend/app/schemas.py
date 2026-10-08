from datetime import date, datetime, timezone

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# ---------- Auth ----------
def _clean_username(v):
    return v.strip().lower() if isinstance(v, str) else v


class UserRegister(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=8, max_length=72)
    password_confirm: str

    _norm_username = field_validator("username", mode="before")(_clean_username)

    @field_validator("password")
    @classmethod
    def password_bcrypt_limit(cls, v: str) -> str:
        if len(v.encode("utf-8")) > 72:
            raise ValueError("Пароль слишком длинный (максимум 72 байта)")
        return v

    @model_validator(mode="after")
    def passwords_match(self):
        if self.password != self.password_confirm:
            raise ValueError("Пароли не совпадают")
        return self


class UserLogin(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1, max_length=72)

    _norm_username = field_validator("username", mode="before")(_clean_username)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ---------- Plants ----------
class PlantNormalizeIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    species: str = Field(min_length=1, max_length=150)

    @field_validator("name", "species", mode="before")
    @classmethod
    def strip(cls, v):
        return v.strip() if isinstance(v, str) else v


class PlantNormalizeOut(BaseModel):
    name: str
    species: str
    confident: bool


class PlantCreate(PlantNormalizeIn):
    planted_at: date = Field(examples=["03/25/2025"])

    @field_validator("planted_at", mode="before")
    @classmethod
    def parse_planted_at(cls, v):
        if isinstance(v, str):
            try:
                return datetime.strptime(v.strip(), "%m/%d/%Y").date()
            except ValueError:
                raise ValueError("Дата должна быть в формате ММ/ДД/ГГГГ")
        return v

    @field_validator("planted_at")
    @classmethod
    def not_in_future(cls, v: date) -> date:
        if v > date.today():
            raise ValueError("Дата посадки не может быть в будущем")
        return v


class PlantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    species: str
    name_original: str
    species_original: str
    planted_at: date  # в ответе ISO: 2025-03-25, форматируй на фронте в ММ/ДД/ГГГГ
    ai_normalized: bool
    photo_url: str | None = None
    created_at: datetime

class CareAdvice(BaseModel):
    """Структура, которую возвращает нейросеть."""

    growth_stage: str

    air_temp_min_c: float = Field(ge=-10, le=60)
    air_temp_max_c: float = Field(ge=-10, le=60)
    air_humidity_min_pct: float = Field(ge=0, le=100)
    air_humidity_max_pct: float = Field(ge=0, le=100)

    soil_temp_min_c: float = Field(ge=-5, le=50)
    soil_temp_max_c: float = Field(ge=-5, le=50)
    soil_moisture_min_pct: float = Field(ge=0, le=100)
    soil_moisture_max_pct: float = Field(ge=0, le=100)

    light_lux_min: float = Field(ge=0, le=200000)
    light_lux_max: float = Field(ge=0, le=200000)

    notes: str = ""

    @model_validator(mode="after")
    def check_ranges(self):
        pairs = [
            ("air_temp_min_c", "air_temp_max_c"),
            ("air_humidity_min_pct", "air_humidity_max_pct"),
            ("soil_temp_min_c", "soil_temp_max_c"),
            ("soil_moisture_min_pct", "soil_moisture_max_pct"),
            ("light_lux_min", "light_lux_max"),
        ]
        for lo, hi in pairs:
            if getattr(self, lo) > getattr(self, hi):
                raise ValueError(f"{lo} > {hi}")
        return self

class PlantCareOut(CareAdvice):
    model_config = ConfigDict(from_attributes=True)

    id: int
    plant_id: int
    for_date: date
    created_at: datetime

# ---------- Devices & sensors ----------
class DeviceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)

    @field_validator("name", mode="before")
    @classmethod
    def strip(cls, v):
        return v.strip() if isinstance(v, str) else v


class DeviceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    plant_id: int
    name: str
    created_at: datetime
    last_seen_at: datetime | None = None


class DeviceCreatedOut(DeviceOut):
    api_key: str  # показывается только один раз, при создании


class SensorReadingIn(BaseModel):
    air_temp_c: float | None = Field(default=None, ge=-40, le=85)
    air_humidity_pct: float | None = Field(default=None, ge=0, le=100)
    soil_temp_c: float | None = Field(default=None, ge=-20, le=80)
    soil_moisture_pct: float | None = Field(default=None, ge=0, le=100)
    light_lux: float | None = Field(default=None, ge=0, le=200000)
    water_level_pct: float | None = Field(default=None, ge=0, le=100)
    water_flow_l_min: float | None = Field(default=None, ge=0, le=1000)
    recorded_at: datetime | None = None  # если не передано, ставится время сервера

    @field_validator("recorded_at")
    @classmethod
    def to_utc(cls, v: datetime | None):
        if v is None:
            return v
        if v.tzinfo is None:  # без часового пояса считаем, что это UTC
            v = v.replace(tzinfo=timezone.utc)
        return v.astimezone(timezone.utc)

    @model_validator(mode="after")
    def at_least_one_value(self):
        values = (
            self.air_temp_c,
            self.air_humidity_pct,
            self.soil_temp_c,
            self.soil_moisture_pct,
            self.light_lux,
            self.water_level_pct,
            self.water_flow_l_min,
        )
        if all(v is None for v in values):
            raise ValueError("Нужно передать хотя бы одно значение датчика")
        return self


class SensorReadingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    plant_id: int
    recorded_at: datetime  # всегда UTC
    air_temp_c: float | None
    air_humidity_pct: float | None
    soil_temp_c: float | None
    soil_moisture_pct: float | None
    light_lux: float | None
    water_level_pct: float | None
    water_flow_l_min: float | None

    @field_validator("recorded_at")
    @classmethod
    def ensure_utc(cls, v: datetime):
        # SQLite возвращает время без часового пояса, а мы храним всё в UTC
        return v.replace(tzinfo=timezone.utc) if v.tzinfo is None else v

# ---------- Удаление аккаунта ----------
class AccountDelete(BaseModel):
    password: str = Field(min_length=1, max_length=72)

# ---------- Профиль ----------
class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    created_at: datetime

    @field_validator("created_at")
    @classmethod
    def utc(cls, v: datetime):
        return v.replace(tzinfo=timezone.utc) if v.tzinfo is None else v