import { useEffect, useRef, useState } from "react";
import {
  IconAlert,
  IconCamera,
  IconCheck,
  IconClose,
  IconSliders,
  type IconProps,
} from "./icons";
import type { AppNotification, NotificationKind } from "../demoData";
import { dayLabel, formatTime } from "../format";
import "./NotificationsPanel.css";

const KIND: Record<
  NotificationKind,
  { Icon: (p: IconProps) => React.JSX.Element; alert?: boolean }
> = {
  alert: { Icon: IconAlert, alert: true },
  action: { Icon: IconSliders },
  photo: { Icon: IconCamera },
  system: { Icon: IconCheck },
};

type NotificationsPanelProps = {
  open: boolean;
  items: AppNotification[];
  onClose: () => void;
  onRead: (id: string) => void;
  onReadAll: () => void;
};

export default function NotificationsPanel({
  open,
  items,
  onClose,
  onRead,
  onReadAll,
}: NotificationsPanelProps) {
  // render держит панель в DOM на время анимации закрытия
  const [render, setRender] = useState(open);
  const [visible, setVisible] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      setRender(true);
      const id = requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          setVisible(true);
          closeRef.current?.focus();
        }),
      );
      return () => cancelAnimationFrame(id);
    }
    setVisible(false);
    const t = window.setTimeout(() => setRender(false), 400);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!render) return null;

  const unread = items.filter((n) => !n.read).length;

  const sorted = [...items].sort((a, b) => b.at - a.at);
  const groups: { label: string; items: AppNotification[] }[] = [];
  for (const n of sorted) {
    const label = dayLabel(n.at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(n);
    else groups.push({ label, items: [n] });
  }

  return (
    <div className={`np ${visible ? "np--visible" : ""}`}>
      <div className="np__backdrop" onClick={onClose} />

      <section
        className="np__panel glass"
        role="dialog"
        aria-modal="true"
        aria-labelledby="np-title"
      >
        <div className="np__grabber" aria-hidden="true" />

        <header className="np__head">
          <h2 className="np__title" id="np-title">
            Уведомления
          </h2>
          <button
            ref={closeRef}
            className="np__close"
            type="button"
            aria-label="Закрыть"
            onClick={onClose}
          >
            <IconClose size={18} />
          </button>
        </header>

        <div className="np__sub">
          <span>{unread > 0 ? `Новых: ${unread}` : "Всё прочитано"}</span>
          <button
            className="np__all"
            type="button"
            disabled={unread === 0}
            onClick={onReadAll}
          >
            Прочитать все
          </button>
        </div>

        <div className="np__scroll">
          {items.length === 0 && (
            <p className="np__empty">Уведомлений пока нет</p>
          )}

          {groups.map((g) => (
            <section className="np__group" key={g.label}>
              <h3 className="np__group-title">{g.label}</h3>
              <div className="np__list">
                {g.items.map((n) => {
                  const { Icon, alert } = KIND[n.kind];
                  return (
                    <button
                      key={n.id}
                      type="button"
                      className={`np__item ${n.read ? "" : "np__item--unread"}`}
                      onClick={() => onRead(n.id)}
                    >
                      <span
                        className={`np__icon ${alert ? "np__icon--alert" : ""}`}
                      >
                        <Icon size={20} />
                      </span>

                      <span className="np__text">
                        <span className="np__item-title">
                          {!n.read && <span className="np__sr">Новое. </span>}
                          {n.title}
                        </span>
                        <span className="np__item-body">{n.text}</span>
                      </span>

                      <span className="np__meta">
                        <span className="np__time">{formatTime(n.at)}</span>
                        {!n.read && <span className="np__dot" aria-hidden="true" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}