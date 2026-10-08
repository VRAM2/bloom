import { ApiError, request } from "./client";
import type { SensorKey } from "../care";

type SensorReadingResponse = {
  id: number;
  plant_id: number;
  recorded_at: string; // всегда UTC
  air_temp_c: number | null;
  air_humidity_pct: number | null;
  soil_temp_c: number | null;
  soil_moisture_pct: number | null;
  light_lux: number | null;
  water_level_pct: number | null;
  water_flow_l_min: number | null;
};

/** Любой датчик может не прислать значение, поэтому null */
export type LiveSensors = Record<SensorKey, number | null>;

/** Датчики воды: без рекомендуемых диапазонов */
export type WaterSensors = {
  waterLevel: number | null; // % в баке
  waterFlow: number | null; // л/мин
};

export type MetricKey = SensorKey | keyof WaterSensors;

export type LatestReading = {
  sensors: LiveSensors;
  water: WaterSensors;
  recordedAt: number; // мс, как в formatStamp
};

/** Одна точка истории: время и все значения */
export type HistoryPoint = {
  at: number; // мс
  values: Record<MetricKey, number | null>;
};

function mapReading(r: SensorReadingResponse): LatestReading {
  return {
    recordedAt: Date.parse(r.recorded_at),
    sensors: {
      airTemp: r.air_temp_c,
      airHumidity: r.air_humidity_pct,
      soilTemp: r.soil_temp_c,
      soilHumidity: r.soil_moisture_pct,
      light: r.light_lux,
    },
    water: {
      waterLevel: r.water_level_pct,
      waterFlow: r.water_flow_l_min,
    },
  };
}

/** Последние показания. Если датчики ещё ничего не присылали, вернёт null. */
export async function getLatestReading(
  plantId: number,
): Promise<LatestReading | null> {
  try {
    const r = await request<SensorReadingResponse>(
      `/plants/${plantId}/sensors/latest`,
    );
    return mapReading(r);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** Показания за последние N часов (бэкенд: от 1 до 168), от старых к новым. */
export async function getSensorHistory(
  plantId: number,
  hours = 24,
): Promise<HistoryPoint[]> {
  const rows = await request<SensorReadingResponse[]>(
    `/plants/${plantId}/sensors/history?hours=${hours}`,
  );
  return rows.map((row) => {
    const r = mapReading(row);
    return { at: r.recordedAt, values: { ...r.sensors, ...r.water } };
  });
}