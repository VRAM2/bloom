import type { PlantCare } from "./api/plants";

export type SensorKey =
  | "airTemp"
  | "airHumidity"
  | "soilHumidity"
  | "soilTemp"
  | "light";

export type Range = { min: number; max: number };
export type Recommended = Record<SensorKey, Range>;
export type Status = "low" | "ok" | "high";

/** Ответ бэкенда -> рекомендуемые диапазоны для интерфейса */
export function toRecommended(c: PlantCare): Recommended {
  return {
    airTemp: { min: c.air_temp_min_c, max: c.air_temp_max_c },
    airHumidity: { min: c.air_humidity_min_pct, max: c.air_humidity_max_pct },
    soilHumidity: { min: c.soil_moisture_min_pct, max: c.soil_moisture_max_pct },
    soilTemp: { min: c.soil_temp_min_c, max: c.soil_temp_max_c },
    light: { min: c.light_lux_min, max: c.light_lux_max },
  };
}

export const statusOf = (v: number, r?: Range): Status =>
  !r ? "ok" : v < r.min ? "low" : v > r.max ? "high" : "ok";

/** Базовая шкала полоски */
const SCALE: Record<SensorKey, Range> = {
  airTemp: { min: 10, max: 40 },
  soilTemp: { min: 5, max: 35 },
  airHumidity: { min: 0, max: 100 },
  soilHumidity: { min: 0, max: 100 },
  light: { min: 0, max: 20000 },
};

/** Шкала расширяется, если рекомендуемый диапазон не помещается в базовую */
export function scaleFor(key: SensorKey, r?: Range): Range {
  const s = SCALE[key];
  if (!r) return s;
  return { min: Math.min(s.min, r.min), max: Math.max(s.max, r.max) };
}

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