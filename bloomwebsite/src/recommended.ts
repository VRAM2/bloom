import type { Sensors } from "./demoData";

export type Range = { min: number; max: number };
export type Recommended = Record<keyof Sensors, Range>;

/* Ориентировочные значения-заглушки.
   Позже замени данными, которые подберёт нейросеть. */
const DEFAULT_REC: Recommended = {
  airTemp: { min: 20, max: 25 },
  airHumidity: { min: 55, max: 70 },
  soilHumidity: { min: 45, max: 60 },
  soilTemp: { min: 18, max: 23 },
  light: { min: 6000, max: 12000 },
};

const BY_SPECIES: Record<string, Recommended> = {
  томат: {
    airTemp: { min: 22, max: 26 },
    airHumidity: { min: 55, max: 70 },
    soilHumidity: { min: 45, max: 60 },
    soilTemp: { min: 18, max: 23 },
    light: { min: 7000, max: 12000 },
  },
  огурец: {
    airTemp: { min: 24, max: 28 },
    airHumidity: { min: 70, max: 85 },
    soilHumidity: { min: 55, max: 70 },
    soilTemp: { min: 20, max: 25 },
    light: { min: 6000, max: 11000 },
  },
  базилик: {
    airTemp: { min: 20, max: 25 },
    airHumidity: { min: 50, max: 65 },
    soilHumidity: { min: 40, max: 55 },
    soilTemp: { min: 18, max: 23 },
    light: { min: 8000, max: 14000 },
  },
  клубника: {
    airTemp: { min: 18, max: 23 },
    airHumidity: { min: 60, max: 75 },
    soilHumidity: { min: 50, max: 65 },
    soilTemp: { min: 15, max: 20 },
    light: { min: 8000, max: 14000 },
  },
};

/** Подбор по виду растения: «Томат черри» тоже найдёт «томат» */
export function recommendedFor(species: string): Recommended {
  const s = species.trim().toLowerCase();
  const key = Object.keys(BY_SPECIES).find((k) => s.includes(k));
  return key ? BY_SPECIES[key] : DEFAULT_REC;
}

export type Status = "low" | "ok" | "high";

export const statusOf = (v: number, r: Range): Status =>
  v < r.min ? "low" : v > r.max ? "high" : "ok";

/** Шкала для полоски: от и до каких значений она нарисована */
export const SCALE: Record<keyof Sensors, Range> = {
  airTemp: { min: 10, max: 40 },
  soilTemp: { min: 5, max: 35 },
  airHumidity: { min: 0, max: 100 },
  soilHumidity: { min: 0, max: 100 },
  light: { min: 0, max: 20000 },
};

/** Положение значения на шкале, в процентах */
export const pct = (v: number, r: Range) =>
  Math.max(0, Math.min(100, ((v - r.min) / (r.max - r.min)) * 100));

/** «22–26°C» или «7 000–12 000 лк» */
export function formatRec(r: Range, unit: string) {
  const f = (v: number) => Math.round(v).toLocaleString("ru-RU");
  return unit === "лк"
    ? `${f(r.min)}–${f(r.max)} лк`
    : `${f(r.min)}–${f(r.max)}${unit}`;
}