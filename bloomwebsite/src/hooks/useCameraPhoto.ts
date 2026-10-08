import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import {
  getPhotoUrl,
  listPhotos,
  parseUtc,
  sendCommand,
  waitForCommand,
  type PhotoInfo,
} from "../api/commands";

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

export function useCameraPhoto(plantId?: number) {
  const [url, setUrl] = useState<string | null>(null);
  const [takenAt, setTakenAt] = useState<number | null>(null);
  const [shooting, setShooting] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const urlRef = useRef<string | null>(null);

  const show = useCallback(
    async (p: PhotoInfo) => {
      if (plantId === undefined) return;
      const next = await getPhotoUrl(plantId, p.id);
      if (!alive.current) {
        URL.revokeObjectURL(next);
        return;
      }
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = next;
      setUrl(next);
      setTakenAt(parseUtc(p.created_at));
    },
    [plantId],
  );

  // последний снимок при открытии
  useEffect(() => {
    alive.current = true;
    if (plantId !== undefined) {
      listPhotos(plantId, 1)
        .then(([p]) => (p ? show(p) : undefined))
        .catch(() => {});
    }
    return () => {
      alive.current = false;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    };
  }, [plantId, show]);

  // новый снимок: команда -> ждём устройство -> забираем файл
  const shoot = useCallback(async () => {
    if (shooting || plantId === undefined) return;
    setShooting(true);
    setError("");
    try {
      const cmd = await sendCommand(plantId, { type: "camera" });
      const result = await waitForCommand(plantId, cmd.id, () => !alive.current);
      if (!alive.current) return;
      if (result.status !== "done") {
        setError(
          result.status === "timeout"
            ? "Камера не отвечает. Проверьте, что она включена"
            : result.message || "Не удалось сделать снимок",
        );
        return;
      }
      for (let i = 0; i < 6; i++) {
        const [p] = await listPhotos(plantId, 1, cmd.id);
        if (p) {
          await show(p);
          return;
        }
        await sleep(1000);
        if (!alive.current) return;
      }
      setError("Снимок пока не пришёл, попробуйте позже");
    } catch (e) {
      if (alive.current) {
        setError(e instanceof ApiError ? e.message : "Не удалось сделать снимок");
      }
    } finally {
      if (alive.current) setShooting(false);
    }
  }, [plantId, shooting, show]);

  return { url, takenAt, shooting, error, shoot };
}