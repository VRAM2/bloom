from fastapi import Depends, HTTPException, Security, status
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Device, User
from app.security import decode_access_token, hash_device_key

bearer_scheme = HTTPBearer()
device_key_header = APIKeyHeader(name="X-Device-Key", auto_error=False)


def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    user_id = decode_access_token(creds.credentials)
    user = db.get(User, user_id) if user_id is not None else None
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Недействительный токен",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def get_current_device(
    key: str | None = Security(device_key_header),
    db: Session = Depends(get_db),
) -> Device:
    device = None
    if key:
        device = db.scalar(select(Device).where(Device.key_hash == hash_device_key(key)))
    if device is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Недействительный ключ устройства")
    return device