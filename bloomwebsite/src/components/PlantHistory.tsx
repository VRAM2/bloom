import { useEffect, useState, type CSSProperties } from "react";
import {
  IconBlinds,
  IconBulb,
  IconCamera,
  IconClose,
  IconCloudDrizzle,
  IconDrop,
  IconSliders,
  IconSoil,
  IconSoilTemp,
  IconSun,
  IconThermo,
  IconTrash,
  IconWind,
  type IconProps,
} from "./icons";
import type { Note } from "../types";
import { formatRec, type Range, type Recommended } from "../care";
import {
  getSensorHistory,
  type HistoryPoint,
  type MetricKey,
} from "../api/sensors";
import { dayLabel, formatStamp, formatTime } from "../format";
import "./PlantHistory.css";
import {
  getPhotoUrl,
  listCommands,
  listPhotos,
  parseUtc,
  type CommandRecord,
} from "../api/commands";

type TabId = "sensors" | "notes" | "actions" | "photos";

const TABS: { id: TabId; label: string }[] = [
  { id: "sensors", label: "Показания" },
  { id: "notes", label: "Заметки" },
  { id: "actions", label: "Действия" },
  { id: "photos", label: "Фото" },
];

type PlantHistoryProps = {
  plantId?: number;
  notes: Note[];
  onNotesChange: (notes: Note[]) => void;
  recommended: Recommended | null;
  photos?: unknown; // больше не используется, фото грузятся с сервера
};

export default function PlantHistory({
  plantId,
  notes,
  onNotesChange,
  recommended,
}: PlantHistoryProps) {
  const [tab, setTab] = useState<TabId>("sensors");
  const index = TABS.findIndex((t) => t.id === tab);

  return (
    <div className="ph">
      <div
        className="ph__seg glass"
        role="tablist"
        aria-label="Разделы истории"
        style={{ "--i": index, "--n": TABS.length } as CSSProperties}
      >
        <span className="ph__seg-indicator glass" aria-hidden="true" />
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`ph-tab-${t.id}`}
            aria-selected={t.id === tab}
            aria-controls="ph-panel"
            className={`ph__seg-btn ${t.id === tab ? "ph__seg-btn--active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        className="ph__panel"
        id="ph-panel"
        role="tabpanel"
        aria-labelledby={`ph-tab-${tab}`}
        key={tab}
      >
        {tab === "sensors" && (
          <SensorsPanel plantId={plantId} recommended={recommended} />
        )}
        {tab === "notes" && <NotesPanel notes={notes} onChange={onNotesChange} />}
        {tab === "actions" && <ActionsPanel plantId={plantId} />}
        {tab === "photos" && <PhotosPanel plantId={plantId} />}
      </div>
    </div>
  );
}

/* ================= Показания ================= */

const HOURS = 24;
const WINDOW_MS = HOURS * 3_600_000;
const BUCKETS = 96; // одна точка на 15 минут
const GAP = 0.1; // разрыв линии, если нет данных дольше ~2,4 часа
const POLL_MS = 60_000;

const SENSOR_META: {
  key: MetricKey;
  label: string;
  unit: string;
  Icon: (p: IconProps) => React.JSX.Element;
  hasRec: boolean;
}[] = [
  { key: "airHumidity", label: "Влажность воздуха", unit: "%", Icon: IconDrop, hasRec: true },
  { key: "soilHumidity", label: "Влажность почвы", unit: "%", Icon: IconSoil, hasRec: true },
  { key: "airTemp", label: "Температура воздуха", unit: "°C", Icon: IconThermo, hasRec: true },
  { key: "soilTemp", label: "Температура почвы", unit: "°C", Icon: IconSoilTemp, hasRec: true },
  { key: "light", label: "Освещённость", unit: "лк", Icon: IconSun, hasRec: true },
  { key: "waterLevel", label: "Уровень воды в баке", unit: "%", Icon: IconDrop, hasRec: false },
  { key: "waterFlow", label: "Расход воды", unit: "л/мин", Icon: IconDrop, hasRec: false },
];

/** Точка графика: x от 0 (24 ч назад) до 1 (сейчас) */
type Pt = { x: number; v: number };

/** Усредняем показания по 15-минутным отрезкам, чтобы график был лёгким и ровным */
function buildSeries(points: HistoryPoint[], key: MetricKey, until: number): Pt[] {
  const from = until - WINDOW_MS;
  const sums = new Map<number, { t: number; v: number; n: number }>();

  for (const p of points) {
    const v = p.values[key];
    if (v === null || p.at < from || p.at > until) continue;
    const b = Math.min(BUCKETS - 1, Math.floor(((p.at - from) / WINDOW_MS) * BUCKETS));
    const s = sums.get(b) ?? { t: 0, v: 0, n: 0 };
    s.t += p.at;
    s.v += v;
    s.n += 1;
    sums.set(b, s);
  }

  return [...sums.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, s]) => ({ x: (s.t / s.n - from) / WINDOW_MS, v: s.v / s.n }));
}

/** Текущее значение: последняя не пустая точка */
function lastValue(points: HistoryPoint[], key: MetricKey): number | null {
  for (let i = points.length - 1; i >= 0; i--) {
    const v = points[i].values[key];
    if (v !== null) return v;
  }
  return null;
}

function formatValue(key: MetricKey, v: number) {
  if (key === "light") return Math.round(v).toLocaleString("ru-RU");
  return (Math.round(v * 10) / 10).toLocaleString("ru-RU");
}

function Sparkline({ pts, rec }: { pts: Pt[]; rec?: Range }) {
  const W = 300;
  const H = 76;
  const P = 8;

  let min = Math.min(...pts.map((p) => p.v), ...(rec ? [rec.min] : []));
  let max = Math.max(...pts.map((p) => p.v), ...(rec ? [rec.max] : []));
  if (max === min) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  const y = (v: number) => P + (1 - (v - min) / span) * (H - 2 * P);

  // делим на отрезки: при пропуске данных линия прерывается
  const segments: Pt[][] = [];
  for (const p of pts) {
    const seg = segments[segments.length - 1];
    if (seg && p.x - seg[seg.length - 1].x <= GAP) seg.push(p);
    else segments.push([p]);
  }

  const toPath = (seg: Pt[]) =>
    seg
      .map((p, i) => `${i ? "L" : "M"}${(p.x * W).toFixed(1)} ${y(p.v).toFixed(1)}`)
      .join(" ");

  const last = pts[pts.length - 1];
  const lx = last.x * W;
  const ly = y(last.v);

  const bandTop = rec ? y(rec.max) : 0;
  const bandBottom = rec ? y(rec.min) : 0;

  return (
    <svg
      className="ph__chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="График за последние 24 часа"
    >
      {rec && (
        <>
          <rect
            className="ph__band"
            x="0"
            y={bandTop}
            width={W}
            height={Math.max(bandBottom - bandTop, 1)}
            rx="4"
          />
          <path
            className="ph__band-line"
            d={`M0 ${bandTop}H${W}M0 ${bandBottom}H${W}`}
          />
        </>
      )}
      {segments.map((seg, i) => {
        const line = toPath(seg);
        const first = seg[0].x * W;
        const end = seg[seg.length - 1].x * W;
        return (
          <g key={i}>
            {seg.length > 1 && (
              <path className="ph__area" d={`${line} L${end} ${H} L${first} ${H} Z`} />
            )}
            <path className="ph__line" d={line} />
          </g>
        );
      })}
      <circle className="ph__dot-ring" cx={lx} cy={ly} r="7" />
      <circle className="ph__dot" cx={lx} cy={ly} r="3.5" />
    </svg>
  );
}

function SensorsPanel({
  plantId,
  recommended,
}: {
  plantId?: number;
  recommended: Recommended | null;
}) {
  const [points, setPoints] = useState<HistoryPoint[]>([]);
  const [until, setUntil] = useState(() => Date.now());
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (plantId === undefined) {
      setState("error");
      return;
    }

    let cancelled = false;
    setState("loading");

    const load = async () => {
      try {
        const p = await getSensorHistory(plantId, HOURS);
        if (cancelled) return;
        setPoints(p);
        setUntil(Date.now());
        setState("ok");
      } catch {
        // при сбое оставляем уже загруженный график
        if (!cancelled) setState((s) => (s === "ok" ? "ok" : "error"));
      }
    };

    void load();
    const id = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [plantId, reload]);

  if (state === "loading") {
    return <p className="ph__empty">Загружаем историю…</p>;
  }

  if (state === "error") {
    return (
      <p className="ph__empty">
        Не удалось загрузить историю
        <button className="ph__retry" type="button" onClick={() => setReload((n) => n + 1)}>
          Повторить
        </button>
      </p>
    );
  }

  if (points.length === 0) {
    return (
      <p className="ph__empty">За последние 24 часа датчики ничего не присылали.</p>
    );
  }

  return (
    <div className="ph__sensors">
      {SENSOR_META.map(({ key, label, unit, Icon, hasRec }) => {
        const rec = hasRec && key !== "waterLevel" && key !== "waterFlow"
          ? recommended?.[key]
          : undefined;
        const pts = buildSeries(points, key, until);
        const now = lastValue(points, key);

        const sub = !hasRec
          ? "За последние 24 часа"
          : rec
            ? `Рекомендуется ${formatRec(rec, unit)}`
            : "Рекомендации недоступны";

        return (
          <div className="ph__card" key={key}>
            <div className="ph__card-top">
              <span className="ph__icon">
                <Icon size={20} />
              </span>
              <div className="ph__card-text">
                <div className="ph__card-label">{label}</div>
                <div className="ph__card-range">{sub}</div>
              </div>
              <div className="ph__card-now">
                {now === null ? "—" : formatValue(key, now)}
                {now !== null && <span className="ph__unit">{unit}</span>}
              </div>
            </div>

            {pts.length > 0 ? (
              <>
                <Sparkline pts={pts} rec={rec} />
                <div className="ph__axis">
                  <span>24 ч назад</span>
                  <span>сейчас</span>
                </div>
              </>
            ) : (
              <p className="ph__nodata">Нет данных за последние 24 часа</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ================= Заметки ================= */

function NotesPanel({
  notes,
  onChange,
}: {
  notes: Note[];
  onChange: (notes: Note[]) => void;
}) {
  const [text, setText] = useState("");
  const canSave = text.trim().length > 0;

  const add = () => {
    const t = text.trim();
    if (!t) return;
    const note: Note = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text: t,
      createdAt: Date.now(),
    };
    onChange([note, ...notes]);
    setText("");
  };

  const remove = (id: string) => onChange(notes.filter((n) => n.id !== id));

  return (
    <div className="ph__notes">
      <div className="ph__compose">
        <textarea
          className="ph__input"
          rows={3}
          maxLength={1000}
          placeholder="Новая заметка"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) add();
          }}
        />
        <div className="ph__compose-foot">
          <button
            className="ph__save"
            type="button"
            disabled={!canSave}
            onClick={add}
          >
            Сохранить
          </button>
        </div>
      </div>

      {notes.length === 0 ? (
        <p className="ph__empty">
          Заметок пока нет. Записывай, что заметил: подкормка, пересадка, обрезка.
        </p>
      ) : (
        <ul className="ph__note-list">
          {notes.map((n) => (
            <li className="ph__note" key={n.id}>
              <p className="ph__note-text">{n.text}</p>
              <div className="ph__note-foot">
                <span>{formatStamp(n.createdAt)}</span>
                <button
                  className="ph__note-del"
                  type="button"
                  aria-label="Удалить заметку"
                  onClick={() => remove(n.id)}
                >
                  <IconTrash size={18} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ================= Действия ================= */

const ACTIONS_LIMIT = 100;
const ACTIONS_POLL_MS = 15_000;

type ActionKind = "pump" | "fan" | "lamp" | "humidifier" | "curtain" | "camera" | "other";

type ActionItem = {
  id: number;
  at: number;
  kind: ActionKind;
  title: string;
  detail: string;
  bad: boolean; // команда не выполнена
};

const ACTION_ICON: Record<ActionKind, (p: IconProps) => React.JSX.Element> = {
  pump: IconDrop,
  fan: IconWind,
  lamp: IconBulb,
  humidifier: IconCloudDrizzle,
  curtain: IconBlinds,
  camera: IconCamera,
  other: IconSliders,
};

const LAMP_NAME: Record<string, string> = {
  red: "Красный свет",
  dark_red: "Тёмно-красный свет",
  blue: "Синий свет",
  strip: "Светодиодная лента",
};

const REASON_TEXT: Record<string, string> = {
  manual: "Вручную на устройстве",
  auto: "Автоматически",
  sync: "Синхронизация с устройством",
};

const onOff = (on: boolean, fem = false) =>
  on ? (fem ? "включена" : "включён") : fem ? "выключена" : "выключен";

/** Превращаем запись команды в строку для списка */
function describeCommand(c: CommandRecord): ActionItem {
  const p = c.payload as {
    action?: string;
    fans?: number[];
    color?: string;
    brightness?: number;
    duration_sec?: number;
    origin?: string;
    reason?: string;
  };
  const on = p.action === "on";

  let kind: ActionKind = "other";
  let title = c.command_type;
  let extra = "";

  switch (c.command_type) {
    case "pump": {
      kind = "pump";
      title = `Насос ${onOff(on)}`;
      if (on && p.duration_sec) {
        extra =
          p.duration_sec >= 60
            ? `На ${Math.round(p.duration_sec / 60)} мин`
            : `На ${p.duration_sec} сек`;
      }
      break;
    }
    case "fan": {
      kind = "fan";
      const fans = p.fans && p.fans.length ? p.fans : [1, 2, 3];
      const plural = on ? "включены" : "выключены";
      title =
        fans.length === 3
          ? `Все вентиляторы ${plural}`
          : fans.length === 1
            ? `Вентилятор ${fans[0]} ${onOff(on)}`
            : `Вентиляторы ${fans.join(", ")} ${plural}`;
      break;
    }
    case "lamp": {
      kind = "lamp";
      const name = p.color ? LAMP_NAME[p.color] ?? "Освещение" : "Освещение";
      title = p.color
        ? `${name} ${onOff(on, p.color === "strip")}`
        : `Освещение ${on ? "включено" : "выключено"}`;
      if (on && p.brightness !== undefined && p.brightness !== null) {
        extra = `Яркость ${p.brightness}%`;
      }
      break;
    }
    case "humidifier":
      kind = "humidifier";
      title = `Увлажнитель ${onOff(on)}`;
      break;
    case "curtain":
      kind = "curtain";
      title = p.action === "open" ? "Штора открыта" : "Штора закрыта";
      break;
    case "camera":
      kind = "camera";
      title = "Сделан снимок";
      break;
  }

  const source =
    p.origin === "device"
      ? (p.reason && REASON_TEXT[p.reason]) || "Устройство"
      : "С приложения";

  let detail: string;
  let bad = false;
  switch (c.status) {
    case "pending":
      detail = "Ждёт устройство";
      break;
    case "sent":
      detail = "Выполняется";
      break;
    case "failed":
      bad = true;
      detail = `Ошибка: ${c.result_message || "устройство не смогло выполнить команду"}`;
      break;
    case "expired":
      bad = true;
      detail = c.result_message || "Устройство не забрало команду";
      break;
    default:
      detail = [extra, source].filter(Boolean).join(" · ");
  }

  return {
    id: c.id,
    at: parseUtc(c.finished_at ?? c.created_at),
    kind,
    title,
    detail,
    bad,
  };
}

function ActionsPanel({ plantId }: { plantId?: number }) {
  const [items, setItems] = useState<ActionItem[]>([]);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (plantId === undefined) {
      setState("error");
      return;
    }

    let cancelled = false;
    setState("loading");

    const load = async () => {
      try {
        const rows = await listCommands(plantId, ACTIONS_LIMIT);
        if (cancelled) return;
        setItems(rows.map(describeCommand));
        setState("ok");
      } catch {
        // при сбое оставляем уже загруженный список
        if (!cancelled) setState((s) => (s === "ok" ? "ok" : "error"));
      }
    };

    void load();
    const id = window.setInterval(load, ACTIONS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [plantId, reload]);

  if (state === "loading") {
    return <p className="ph__empty">Загружаем действия…</p>;
  }

  if (state === "error") {
    return (
      <p className="ph__empty">
        Не удалось загрузить действия
        <button className="ph__retry" type="button" onClick={() => setReload((n) => n + 1)}>
          Повторить
        </button>
      </p>
    );
  }

  if (items.length === 0) {
    return <p className="ph__empty">Теплица пока ничего не делала.</p>;
  }

  const sorted = [...items].sort((a, b) => b.at - a.at);
  const groups: { label: string; items: ActionItem[] }[] = [];
  for (const a of sorted) {
    const label = dayLabel(a.at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(a);
    else groups.push({ label, items: [a] });
  }

  return (
    <div className="ph__actions">
      {groups.map((g) => (
        <section className="ph__group" key={g.label}>
          <h2 className="ph__group-title">{g.label}</h2>
          <div className="ph__list">
            {g.items.map((a) => {
              const Icon = ACTION_ICON[a.kind];
              return (
                <div className="ph__row" key={a.id}>
                  <span className={`ph__icon ${a.bad ? "ph__icon--bad" : ""}`}>
                    <Icon size={20} />
                  </span>
                  <span className="ph__row-text">
                    <span className="ph__row-title">{a.title}</span>
                    <span className={`ph__row-sub ${a.bad ? "ph__row-sub--bad" : ""}`}>
                      {a.detail}
                    </span>
                  </span>
                  <span className="ph__row-time">{formatTime(a.at)}</span>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ================= Фото ================= */

/* ================= Фото ================= */

const PHOTOS_LIMIT = 30;
const PHOTOS_POLL_MS = 30_000;

type Shot = { id: number; at: number; src: string };

function PhotosPanel({ plantId }: { plantId?: number }) {
  const [shots, setShots] = useState<Shot[]>([]);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [reload, setReload] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    if (plantId === undefined) {
      setState("error");
      return;
    }

    let cancelled = false;
    const urls = new Map<number, string>(); // id -> blob-ссылка
    setState("loading");
    setShots([]);

    const load = async () => {
      try {
        const list = await listPhotos(plantId, PHOTOS_LIMIT);
        // скачиваем только новые снимки, уже загруженные не трогаем
        const fresh = list.filter((p) => !urls.has(p.id));
        const loaded = await Promise.all(
          fresh.map(async (p) => [p.id, await getPhotoUrl(plantId, p.id)] as const),
        );
        if (cancelled) {
          loaded.forEach(([, u]) => URL.revokeObjectURL(u));
          return;
        }
        loaded.forEach(([id, u]) => urls.set(id, u));

        // сервер хранит только последние N снимков: старые убираем
        const ids = new Set(list.map((p) => p.id));
        for (const [id, u] of urls) {
          if (!ids.has(id)) {
            URL.revokeObjectURL(u);
            urls.delete(id);
          }
        }

        setShots(
          list.map((p) => ({
            id: p.id,
            at: parseUtc(p.created_at),
            src: urls.get(p.id)!,
          })),
        );
        setState("ok");
      } catch {
        // при сбое оставляем уже загруженные снимки
        if (!cancelled) setState((s) => (s === "ok" ? "ok" : "error"));
      }
    };

    void load();
    const timer = window.setInterval(load, PHOTOS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [plantId, reload]);

  const open = shots.find((p) => p.id === openId);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (state === "loading") {
    return <p className="ph__empty">Загружаем снимки…</p>;
  }

  if (state === "error") {
    return (
      <p className="ph__empty">
        Не удалось загрузить снимки
        <button className="ph__retry" type="button" onClick={() => setReload((n) => n + 1)}>
          Повторить
        </button>
      </p>
    );
  }

  if (shots.length === 0) {
    return <p className="ph__empty">Камера пока не сделала ни одного снимка.</p>;
  }

  return (
    <>
      <div className="ph__gallery">
        {shots.map((p) => (
          <button
            className="ph__photo"
            type="button"
            key={p.id}
            aria-label={`Снимок: ${formatStamp(p.at)}`}
            onClick={() => setOpenId(p.id)}
          >
            <img src={p.src} alt="" loading="lazy" />
            <span className="ph__photo-time glass">{formatStamp(p.at)}</span>
          </button>
        ))}
      </div>

      {open && (
        <div
          className="ph__lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Снимок с камеры"
          onClick={() => setOpenId(null)}
        >
          <img
            className="ph__lightbox-img"
            src={open.src}
            alt={`Снимок: ${formatStamp(open.at)}`}
          />
          <button
            className="ph__lightbox-close glass"
            type="button"
            aria-label="Закрыть"
            autoFocus
            onClick={() => setOpenId(null)}
          >
            <IconClose size={22} />
          </button>
          <span className="ph__lightbox-time glass">{formatStamp(open.at)}</span>
        </div>
      )}
    </>
  );
}