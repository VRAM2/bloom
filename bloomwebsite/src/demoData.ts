import welcome from "./assets/welcome-background-phone.jpg";
import registration from "./assets/registration-background-phone.jpg";
import plantBg from "./assets/plant-background-phone.jpg";
import analyzing from "./assets/analyzing-background-phone.jpg";
import ready from "./assets/ready-background-phone.jpg";

/* ---------- Показания датчиков ---------- */
export const DEMO_SENSORS = {
  airHumidity: 62,
  soilHumidity: 48,
  airTemp: 24,
  soilTemp: 21,
  light: 8400,
};

export type Sensors = typeof DEMO_SENSORS;

/** Когда данные обновились (в демо: 2 минуты назад) */
export const DEMO_UPDATED_AT = Date.now() - 2 * 60_000;

/* Графики за 24 часа: в демо «сейчас» = 14:00 */
const POINTS = 24;
const DEMO_HOUR_NOW = 14;

const hourOf = (i: number) => (DEMO_HOUR_NOW - (POINTS - 1 - i) + 48) % 24;
const cycle = (h: number, peak: number) =>
  Math.cos(((h - peak) / 24) * 2 * Math.PI);

function fit(values: number[], current: number, mode: "shift" | "scale") {
  const last = values[values.length - 1];
  return mode === "shift"
    ? values.map((v) => v + current - last)
    : values.map((v) => (v * current) / last);
}

export function demoSeries(s: Sensors): Record<keyof Sensors, number[]> {
  const idx = Array.from({ length: POINTS }, (_, i) => i);
  return {
    airTemp: fit(idx.map((i) => 23 + 3 * cycle(hourOf(i), 15)), s.airTemp, "shift"),
    soilTemp: fit(idx.map((i) => 21 + 1.2 * cycle(hourOf(i), 17)), s.soilTemp, "shift"),
    airHumidity: fit(idx.map((i) => 62 - 9 * cycle(hourOf(i), 15)), s.airHumidity, "shift"),
    soilHumidity: fit(idx.map((i) => 55 - 0.7 * (i % 15)), s.soilHumidity, "shift"),
    light: fit(
      idx.map((i) => {
        const h = hourOf(i);
        return h >= 6 && h <= 20 ? 12000 * Math.sin(((h - 6) / 14) * Math.PI) : 0;
      }),
      s.light,
      "scale",
    ),
  };
}

/* ---------- Действия теплицы ---------- */
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const now = Date.now();

export type ActionKind = "water" | "light" | "vent" | "heat";

export type GreenhouseAction = {
  id: string;
  kind: ActionKind;
  title: string;
  detail: string;
  at: number;
};

export const DEMO_ACTIONS: GreenhouseAction[] = [
  { id: "a1", kind: "vent", title: "Проветривание", detail: "Вентиляция работала 15 минут", at: now - 35 * MIN },
  { id: "a2", kind: "light", title: "Освещение включено", detail: "Досветка по расписанию", at: now - 3 * HOUR },
  { id: "a3", kind: "water", title: "Полив", detail: "Влажность почвы была ниже нормы", at: now - 7 * HOUR },
  { id: "a4", kind: "heat", title: "Обогрев", detail: "Температура воздуха была ниже нормы", at: now - 14 * HOUR },
  { id: "a5", kind: "light", title: "Освещение выключено", detail: "Конец светового дня", at: now - DAY - 2 * HOUR },
  { id: "a6", kind: "water", title: "Полив", detail: "Плановый полив", at: now - DAY - 9 * HOUR },
  { id: "a7", kind: "vent", title: "Проветривание", detail: "Влажность воздуха была выше нормы", at: now - 2 * DAY - 5 * HOUR },
  { id: "a8", kind: "water", title: "Полив", detail: "Плановый полив", at: now - 2 * DAY - 9 * HOUR },
];

/* ---------- Фото с камеры (в демо используются фото из онбординга) ---------- */
export type CameraPhoto = {
  id: string;
  src: string;
  at: number;
};

const SOURCES = [welcome, registration, plantBg, analyzing, ready];
const OFFSETS = [HOUR, 6 * HOUR, 12 * HOUR, DAY + HOUR, DAY + 13 * HOUR, 2 * DAY + 2 * HOUR];

export const DEMO_PHOTOS: CameraPhoto[] = OFFSETS.map((offset, i) => ({
  id: `p${i}`,
  src: SOURCES[i % SOURCES.length],
  at: now - offset,
}));

/** Имитация нового снимка камеры (по кругу берёт демо-фото) */
export function demoShot(n: number): CameraPhoto {
  return {
    id: `shot-${Date.now()}`,
    src: SOURCES[n % SOURCES.length],
    at: Date.now(),
  };
}

/* ---------- Уведомления ---------- */
export type NotificationKind = "alert" | "action" | "photo" | "system";

export type AppNotification = {
  id: string;
  kind: NotificationKind;
  title: string;
  text: string;
  at: number;
  read: boolean;
};

export const DEMO_NOTIFICATIONS: AppNotification[] = [
  {
    id: "n1",
    kind: "photo",
    title: "Камера сделала снимок",
    text: "Новый снимок добавлен в историю растения.",
    at: now - HOUR,
    read: false,
  },
  {
    id: "n2",
    kind: "action",
    title: "Включено освещение",
    text: "Досветка по расписанию.",
    at: now - 3 * HOUR,
    read: false,
  },
  {
    id: "n3",
    kind: "alert",
    title: "Влажность почвы была ниже нормы",
    text: "Опустилась до 41%, рекомендуется 45–60%. Оранжерея выполнила полив.",
    at: now - 7 * HOUR,
    read: true,
  },
  {
    id: "n4",
    kind: "alert",
    title: "Температура воздуха была ниже нормы",
    text: "Опускалась до 19°C. Был включён обогрев.",
    at: now - 14 * HOUR,
    read: true,
  },
  {
    id: "n5",
    kind: "system",
    title: "Оранжерея на связи",
    text: "Связь восстановлена после короткого перерыва.",
    at: now - DAY - 3 * HOUR,
    read: true,
  },
];