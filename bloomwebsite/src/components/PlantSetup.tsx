
import { useRef, useState } from "react";

import { useKeyboardInset } from "../hooks/useKeyboardInset";
import { createPlant } from "../api/plants";
import type { Plant } from "../types";

import "./Registration.css";
import "./PlantSetup.css";

type PlantSetupProps = {
  onContinue?: (plant: Plant) => void;
};

export default function PlantSetup({
  onContinue,
}: PlantSetupProps) {
  const [name, setName] = useState("");
  const [species, setSpecies] = useState("");
  const [plantedAt, setPlantedAt] = useState("");
  const [dateActive, setDateActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const contentRef = useRef<HTMLElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  useKeyboardInset(contentRef);

  const isValid =
    name.trim().length > 0 &&
    species.trim().length > 0 &&
    plantedAt !== "";

  const dateType =
    dateActive || plantedAt ? "date" : "text";

  const handleDateFocus = () => {
    setDateActive(true);

    requestAnimationFrame(() => {
      try {
        dateRef.current?.showPicker?.();
      } catch {
        /* не все браузеры разрешают */
      }
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isValid || loading) return;

    setLoading(true);
    setError("");

    try {
      const plant = await createPlant({
        name: name.trim(),
        species: species.trim(),
        plantedAt,
      });

      onContinue?.(plant);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Не удалось сохранить растение, попробуйте ещё раз",
      );

      setLoading(false);
    }
  };

  return (
    <main className="reg reg--plant">
      <div className="reg__photo" />

      <div className="reg__shade" />

      <section
        className="reg__content"
        ref={contentRef}
      >
        <h1 className="reg__title">
          <span className="plant__line">
            Познакомимся
          </span>

          <span className="plant__line">
            с <span className="reg__accent">растением</span>
          </span>
        </h1>

        <p className="reg__text">
          Несколько деталей — и я буду знать, как лучше о нём заботиться.
        </p>

        <form
          className="reg__form"
          onSubmit={handleSubmit}
          noValidate
        >
          <div className="reg__fields">
            <input
              className="reg__input"
              type="text"
              placeholder="Название растения"
              autoComplete="off"
              autoCapitalize="sentences"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError("");
              }}
              disabled={loading}
            />

            <input
              className="reg__input"
              type="text"
              placeholder="Вид растения"
              autoComplete="off"
              autoCapitalize="sentences"
              value={species}
              onChange={(e) => {
                setSpecies(e.target.value);
                setError("");
              }}
              disabled={loading}
            />

            <input
              ref={dateRef}
              className="reg__input reg__input--date"
              type={dateType}
              placeholder="Дата посадки"
              value={plantedAt}
              onFocus={handleDateFocus}
              onBlur={() => setDateActive(false)}
              onChange={(e) => {
                setPlantedAt(e.target.value);
                setError("");
              }}
              disabled={loading}
            />
          </div>

          {error && (
            <p
              className="reg__text"
              role="alert"
              aria-live="polite"
            >
              {error}
            </p>
          )}

          <button
            className="reg__button"
            type="submit"
            disabled={!isValid || loading}
          >
            {loading ? "Сохраняем…" : "Продолжить"}
          </button>
        </form>
      </section>
    </main>
  );
}

