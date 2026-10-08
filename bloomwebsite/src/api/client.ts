import { clearSession, emitSessionExpired, getToken } from "./session";

export const API_URL: string = (
  import.meta.env.VITE_API_URL ?? "http://localhost:8000"
).replace(/\/$/, "");
const TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  status: number; // 0 = нет связи или таймаут

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function messageFor(status: number, detail: unknown): string {
  if (status === 422) return "Проверьте введённые данные";
  if (typeof detail === "string") return detail; // бэкенд присылает понятный текст на русском
  if (
    detail &&
    typeof detail === "object" &&
    typeof (detail as { message?: unknown }).message === "string"
  ) {
    return (detail as { message: string }).message;
  }
  return "Что-то пошло не так, попробуйте позже";
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  auth?: boolean; // подставлять ли токен (по умолчанию да)
  timeoutMs?: number;
};

export async function request<T>(
  path: string,
  { method = "GET", body, auth = true, timeoutMs = TIMEOUT_MS }: RequestOptions = {},
): Promise<T> {
  const isForm = body instanceof FormData;

  const headers: Record<string, string> = {};
  // для FormData Content-Type ставит сам браузер (вместе с boundary)
  if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    let res: Response;
    try {
      res = await fetch(`${API_URL}${path}`, {
        method,
        headers,
        body:
          body === undefined
            ? undefined
            : isForm
              ? (body as FormData)
              : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      // сервер выключен, нет сети, таймаут или запрос заблокирован CORS
      throw new ApiError(
        0,
        controller.signal.aborted
          ? "Сервер не отвечает, попробуйте позже"
          : "Нет связи с сервером. Проверьте подключение",
      );
    }

    if (res.status === 204) return undefined as T;

    let data: { detail?: unknown } | null = null;
    try {
      data = await res.json();
    } catch {
      /* пустое тело */
    }

    if (!res.ok) {
      if (res.status === 401 && auth) {
        // токен недействителен: чистим сессию и сообщаем приложению
        clearSession();
        emitSessionExpired();
      }
      // для отладки: настоящая причина (например, 422 с loc/type)
      console.error(`[api] ${method} ${path} -> ${res.status}`, data?.detail);
      throw new ApiError(res.status, messageFor(res.status, data?.detail));
    }
    return data as T;
  } finally {
    window.clearTimeout(timer);
  }
}

/** Скачивание файла (например, снимка) с токеном авторизации */
export async function requestBlob(path: string, timeoutMs = TIMEOUT_MS): Promise<Blob> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    let res: Response;
    try {
      res = await fetch(`${API_URL}${path}`, { headers, signal: controller.signal });
    } catch {
      throw new ApiError(
        0,
        controller.signal.aborted
          ? "Сервер не отвечает, попробуйте позже"
          : "Нет связи с сервером. Проверьте подключение",
      );
    }

    if (!res.ok) {
      if (res.status === 401) {
        clearSession();
        emitSessionExpired();
      }
      throw new ApiError(res.status, "Не удалось загрузить снимок");
    }
    return await res.blob();
  } finally {
    window.clearTimeout(timer);
  }
}
