import { ApiError, request } from "./client";
import { clearSession, getCachedUser, getToken, setCachedUser, setToken } from "./session";
import { disablePush } from "./push";

type TokenResponse = { access_token: string; token_type: string };
type MeResponse = { id: number; username: string; created_at: string };

// Бэкенд хранит имя без пробелов по краям и в нижнем регистре. Приводим так же,
// чтобы имя на экране не менялось после перезапуска приложения.
const normalize = (name: string): string => name.trim().toLowerCase();

/** Имя для показа на экране: «anna» -> «Anna». */
export function displayName(username: string): string {
  const u = normalize(username);
  return u ? u.charAt(0).toLocaleUpperCase("ru") + u.slice(1) : "";
}

function saveSession(token: string, username: string): void {
  setToken(token);
  setCachedUser({ username: normalize(username) });
}

export async function register(
  username: string,
  password: string,
  passwordConfirm: string,
): Promise<void> {
  const data = await request<TokenResponse>("/auth/register", {
    method: "POST",
    body: { username, password, password_confirm: passwordConfirm },
    auth: false,
  });
  saveSession(data.access_token, username);
}

export async function login(username: string, password: string): Promise<void> {
  const data = await request<TokenResponse>("/auth/login", {
    method: "POST",
    body: { username, password },
    auth: false,
  });
  saveSession(data.access_token, username);
}

export async function logout(): Promise<void> {
  // отписываем устройство, пока токен ещё действителен (но не ждём дольше 3 секунд)
  await Promise.race([disablePush(), new Promise((r) => setTimeout(r, 3000))]).catch(() => {});
  clearSession();
}
/** Синхронно, без сети: есть ли сохранённая сессия. Нужна для мгновенного старта PWA. */
export function restoreSession(): { username: string } | null {
  if (!getToken()) return null;
  return { username: getCachedUser()?.username ?? "" };
}

export type SessionCheck =
  | { status: "valid"; username: string }
  | { status: "invalid" } // сервер ответил 401: сессия уже очищена
  | { status: "unreachable" }; // нет сети или сервер недоступен: сессию не трогаем

export async function verifySession(): Promise<SessionCheck> {
  try {
    const me = await request<MeResponse>("/auth/me");
    if (getToken()) setCachedUser({ username: me.username }); // вдруг пользователь вышел, пока шёл запрос
    return { status: "valid", username: me.username };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return { status: "invalid" };
    return { status: "unreachable" };
  }
}

export async function deleteAccount(password: string): Promise<void> {
  await request<void>("/auth/me", { method: "DELETE", body: { password } });
  clearSession();
}

