import type { Plant } from "../types";
import { API_URL, request } from "./client";

export type PlantData = {
  name: string;
  species: string;
  plantedAt: string;
};

type PlantResponse = {
  id: number;
  name: string;
  species: string;
  name_original: string;
  species_original: string;
  planted_at: string;
  ai_normalized: boolean;
  created_at: string;
  photo_url: string | null;
};

export type PlantCare = {
  id: number;
  plant_id: number;
  for_date: string;
  created_at: string;
  growth_stage: string;
  air_temp_min_c: number;
  air_temp_max_c: number;
  air_humidity_min_pct: number;
  air_humidity_max_pct: number;
  soil_temp_min_c: number;
  soil_temp_max_c: number;
  soil_moisture_min_pct: number;
  soil_moisture_max_pct: number;
  light_lux_min: number;
  light_lux_max: number;
  notes: string;
};

/**
 * input[type="date"] отдаёт дату в формате YYYY-MM-DD,
 * а backend PlantCreate сейчас ожидает MM/DD/YYYY.
 */


function toBackendDate(value: string): string {
  const [year, month, day] = value.split("-");

  if (!year || !month || !day) {
    return value;
  }

  return `${month}/${day}/${year}`;
}

export const photoSrc = (p?: string | null) =>
  !p ? undefined : /^(https?:|blob:)/.test(p) ? p : `${API_URL}${p}`;


function mapPlant(data: PlantResponse): Plant {
  return {
    id: data.id,
    name: data.name,
    species: data.species,
    plantedAt: data.planted_at,
    nameOriginal: data.name_original,
    speciesOriginal: data.species_original,
    aiNormalized: data.ai_normalized,
    createdAt: data.created_at,
    photo: photoSrc(data.photo_url),
  };
}

export async function uploadPlantPhoto(plantId: number, file: File): Promise<Plant> {
  const form = new FormData();
  form.append("file", file);

  const result = await request<PlantResponse>(`/plants/${plantId}/photo`, {
    method: "POST",
    body: form,
    timeoutMs: 60_000,
  });
  return mapPlant(result);
}

export async function createPlant(data: PlantData): Promise<Plant> {
  const result = await request<PlantResponse>("/plants", {
    method: "POST",
    body: {
      name: data.name.trim(),
      species: data.species.trim(),
      planted_at: toBackendDate(data.plantedAt),
    },
  });

  return mapPlant(result);
}

/** Первый запрос за день может идти долго: бэкенд генерирует рекомендации нейросетью */
export async function getPlantCare(plantId: number): Promise<PlantCare> {
  return request<PlantCare>(`/plants/${plantId}/care`, { timeoutMs: 40_000 });
}

export async function getPlants(): Promise<Plant[]> {
  const result = await request<PlantResponse[]>("/plants");
  return result.map(mapPlant);
}