import { ApiError, request, requestBlob } from "./client";

export type LampColor = "blue" | "dark_red" | "red" | "strip";

/** Ответ GET /plants/{id}/actuators/state */
export type ActuatorState = {
  pump: { is_on: boolean | null; until: string | null; updated_at: string | null };
  fans: { number: number; is_on: boolean | null; updated_at: string | null }[];
  lamps: {
    color: LampColor;
    is_on: boolean | null;
    brightness: number | null;
    updated_at: string | null;
  }[];
  humidifier: { is_on: boolean | null; updated_at: string | null };
  curtain: { state: "open" | "closed" | null; updated_at: string | null };
  pending_commands: number;
  as_of: string;
};

/** Тела команд: совпадают с CommandCreate на бэкенде */
export type CommandBody =
  | { type: "pump"; action: "on"; duration_sec: number }
  | { type: "pump"; action: "off" }
  | { type: "fan"; action: "on" | "off"; fans: number[] }
  | { type: "lamp"; action: "on"; color: Exclude<LampColor, "strip">; brightness: number }
  | { type: "lamp"; action: "on"; color: "strip" }
  | { type: "lamp"; action: "off"; color: LampColor }
  | { type: "humidifier"; action: "on" | "off" }
  | { type: "curtain"; action: "open" | "close" }
  | { type: "camera" };

type CommandStatus = "pending" | "sent" | "done" | "failed" | "expired";

type CommandResponse = {
  id: number;
  status: CommandStatus;
  result_message: string | null;
};

export type CommandResult = {
  status: "done" | "failed" | "expired" | "timeout";
  message: string | null;
};

export type PhotoInfo = {
  id: number;
  plant_id: number;
  command_id: number | null;
  size_bytes: number;
  created_at: string;
};

/** Запись из истории команд (GET /plants/{id}/commands) */
export type CommandRecord = {
  id: number;
  plant_id: number;
  command_type: string;
  payload: Record<string, unknown>;
  status: "pending" | "sent" | "done" | "failed" | "expired";
  created_at: string;
  sent_at: string | null;
  finished_at: string | null;
  result_message: string | null;
};

/** Бэкенд может отдать время без часового пояса (SQLite), считаем такое время UTC */
export function parseUtc(value: string): number {
  return Date.parse(/(?:[zZ]|[+-]\d\d:?\d\d)$/.test(value) ? value : `${value}Z`);
}

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

export function getActuatorState(plantId: number): Promise<ActuatorState> {
  return request<ActuatorState>(`/plants/${plantId}/actuators/state`);
}

/** История команд, новые первыми (бэкенд: от 1 до 200) */
export function listCommands(plantId: number, limit = 100): Promise<CommandRecord[]> {
  return request<CommandRecord[]>(`/plants/${plantId}/commands?limit=${limit}`);
}

/** Поставить команду в очередь. Устройство заберёт её при очередном опросе. */
export function sendCommand(plantId: number, body: CommandBody): Promise<CommandResponse> {
  return request<CommandResponse>(`/plants/${plantId}/commands`, {
    method: "POST",
    body,
  });
}

/**
 * Ждём, пока устройство выполнит команду (done / failed / expired).
 * Если за timeoutMs ответа нет, вернёт "timeout".
 */
export async function waitForCommand(
  plantId: number,
  commandId: number,
  cancelled: () => boolean,
  timeoutMs = 60_000,
): Promise<CommandResult> {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    await sleep(1000);
    if (cancelled()) break;
    try {
      const c = await request<CommandResponse>(`/plants/${plantId}/commands/${commandId}`);
      if (c.status === "done" || c.status === "failed" || c.status === "expired") {
        return { status: c.status, message: c.result_message };
      }
    } catch (err) {
      // нет связи: пробуем ещё раз, остальные ошибки пробрасываем
      if (err instanceof ApiError && err.status !== 0) throw err;
    }
  }
  return { status: "timeout", message: null };
}

export function listPhotos(
  plantId: number,
  limit = 1,
  commandId?: number,
): Promise<PhotoInfo[]> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (commandId !== undefined) q.set("command_id", String(commandId));
  return request<PhotoInfo[]>(`/plants/${plantId}/photos?${q}`);
}

/** Возвращает временную ссылку на снимок; когда она не нужна, вызови URL.revokeObjectURL */
export async function getPhotoUrl(plantId: number, photoId: number): Promise<string> {
  const blob = await requestBlob(`/plants/${plantId}/photos/${photoId}/image`);
  return URL.createObjectURL(blob);
}
