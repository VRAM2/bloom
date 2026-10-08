export type Note = {
  id: string;
  text: string;
  createdAt: number; // timestamp
};

export type Plant = {
  id?: number;
  name: string;
  species: string;
  plantedAt: string;

  nameOriginal?: string;
  speciesOriginal?: string;
  aiNormalized?: boolean;
  createdAt?: string;

  photo?: string;
  notes?: Note[];
};