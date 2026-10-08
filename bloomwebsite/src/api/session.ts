const TOKEN_KEY = "greenhouse_token";
const USER_KEY = "greenhouse_user";

export type CachedUser = { username: string };

// Если localStorage недоступен (приватный режим, запрет хранилища), держим данные в памяти
let storageBroken = false;
const memory: Record<string, string> = {};

function get(key: string): string | null {
  if (!storageBroken) {
    try {
      return localStorage.getItem(key);
    } catch {
      storageBroken = true;
    }
  }
  return memory[key] ?? null;
}

function set(key: string, value: string): void {
  memory[key] = value;
  if (storageBroken) return;
  try {
    localStorage.setItem(key, value);
  } catch {
    storageBroken = true;
  }
}

function del(key: string): void {
  delete memory[key];
  if (storageBroken) return;
  try {
    localStorage.removeItem(key);
  } catch {
    storageBroken = true;
  }
}

export const getToken = (): string | null => get(TOKEN_KEY);
export const setToken = (token: string): void => set(TOKEN_KEY, token);

// Имя храним, чтобы PWA могла открыться офлайн и сразу показать профиль
export function getCachedUser(): CachedUser | null {
  const raw = get(USER_KEY);
  if (!raw) return null;
  try {
    const user = JSON.parse(raw);
    return typeof user?.username === "string" ? { username: user.username } : null;
  } catch {
    return null;
  }
}

export const setCachedUser = (user: CachedUser): void => set(USER_KEY, JSON.stringify(user));

export function clearSession(): void {
  del(TOKEN_KEY);
  del(USER_KEY);
}

// ---------- события сессии ----------
type Listener = () => void;
const expiredListeners = new Set<Listener>();

/** Подписка на «сессия закончилась» (401 от сервера или выход в другой вкладке). */
export function onSessionExpired(listener: Listener): () => void {
  expiredListeners.add(listener);
  return () => {
    expiredListeners.delete(listener);
  };
}

export function emitSessionExpired(): void {
  expiredListeners.forEach((listener) => listener());
}

// Выход в соседней вкладке или окне приложения: событие приходит только в другие вкладки
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === TOKEN_KEY && e.newValue === null) emitSessionExpired();
  });
}