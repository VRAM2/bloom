import { IconCamera, IconSprout } from "./icons";
import type { Plant } from "../types";

type PlantCardProps = {
  plant: Plant;
  onPhoto: (file: File) => void;
  onOpen?: () => void;
};

function daysSince(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / 86_400_000) + 1;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
  });
}

export default function PlantCard({ plant, onPhoto, onOpen }: PlantCardProps) {
  const days = daysSince(plant.plantedAt);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onPhoto(file);
    e.target.value = "";
  };

  return (
    <article className="plant">
      {plant.photo ? (
        <img className="plant__img" src={plant.photo} alt={`Фото: ${plant.name}`} />
      ) : (
        <div className="plant__empty">
          <IconSprout size={44} />
        </div>
      )}

      <button
        className="plant__open"
        type="button"
        aria-label={`Открыть растение ${plant.name}`}
        onClick={onOpen}
      />

      <label
        className={`plant__cam glass ${plant.photo ? "" : "plant__cam--text"}`}
      >
        <IconCamera size={18} />
        {!plant.photo && <span>Добавить фото</span>}
        <input
          type="file"
          accept="image/*"
          aria-label="Изменить фото растения"
          onChange={handleFile}
        />
      </label>

      <div className="plant__caption glass">
        <div className="plant__text">
          <h3 className="plant__name">{plant.name}</h3>
          <p className="plant__sub">
            {plant.species}, {days > 0 ? "посажено" : "посадка"}{" "}
            {formatDate(plant.plantedAt)}
          </p>
        </div>
        <span className="plant__day">{days > 0 ? `День ${days}` : "Скоро"}</span>
      </div>
    </article>
  );
}
