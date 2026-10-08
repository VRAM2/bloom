import { useCallback, useEffect, useRef, useState } from "react";
import type { AppNotification } from "../demoData";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../api/notifications";

const POLL_MS = 30_000;

export function useNotifications(loggedIn: boolean) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const loadRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    if (!loggedIn) {
      setItems([]);
      loadRef.current = async () => {};
      return;
    }

    let alive = true;
    const load = async () => {
      try {
        const list = await fetchNotifications();
        if (alive) setItems(list);
      } catch {
        /* офлайн или 401: оставляем что есть */
      }
    };
    loadRef.current = load;

    void load();
    const visible = () => document.visibilityState === "visible";
    const timer = window.setInterval(() => visible() && void load(), POLL_MS);
    const onVis = () => visible() && void load();
    const onOnline = () => void load();
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "push-received") void load();
    };

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onOnline);
    navigator.serviceWorker?.addEventListener("message", onMsg);

    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onOnline);
      navigator.serviceWorker?.removeEventListener("message", onMsg);
    };
  }, [loggedIn]);

  const read = useCallback((id: string) => {
    setItems((p) => p.map((n) => (n.id === id ? { ...n, read: true } : n)));
    markNotificationRead(Number(id)).catch(() => void loadRef.current());
  }, []);

  const readAll = useCallback(() => {
    setItems((p) => p.map((n) => ({ ...n, read: true })));
    markAllNotificationsRead().catch(() => void loadRef.current());
  }, []);

  return { items, read, readAll };
}