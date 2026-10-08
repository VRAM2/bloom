import httpx
from app.config import settings

resp = httpx.get(
    f"{settings.google_api_base}/models",
    headers={"x-goog-api-key": settings.google_api_key},
    params={"pageSize": 100},
    timeout=30,
)
resp.raise_for_status()
for m in resp.json()["models"]:
    if "generateContent" in m.get("supportedGenerationMethods", []):
        print(m["name"].removeprefix("models/"))