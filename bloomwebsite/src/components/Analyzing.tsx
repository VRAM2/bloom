import { useEffect, useRef, useState } from "react";

import { getPlantCare, type PlantCare } from "../api/plants";

import "./Registration.css";
import "./Analyzing.css";

type AnalyzingProps = {
  plantId: number;
  onDone?: (care: PlantCare) => void;
};

export default function Analyzing({
  plantId,
  onDone,
}: AnalyzingProps) {
  const timer = useRef<number | undefined>(undefined);
  const pauseTimer = useRef<number | undefined>(undefined);
  const fillRef = useRef<HTMLDivElement>(null);

  const [care, setCare] = useState<PlantCare | null>(null);
  const [error, setError] = useState("");
  const [animationReady, setAnimationReady] = useState(false);
  const [careReady, setCareReady] = useState(false);

  /*
   * Получаем рекомендации с backend.
   *
   * Если backend уже вернул данные — careReady становится true.
   */
  useEffect(() => {
    let cancelled = false;

    const loadCare = async () => {
      setError("");
      setCare(null);
      setCareReady(false);
      setAnimationReady(false);

      try {
        const result = await getPlantCare(plantId);

        if (cancelled) return;

        setCare(result);
        setCareReady(true);
      } catch (err) {
        if (cancelled) return;

        setError(
          err instanceof Error
            ? err.message
            : "Не удалось подобрать условия для растения, попробуйте ещё раз",
        );
      }
    };

    void loadCare();

    return () => {
      cancelled = true;

      if (timer.current !== undefined) {
        window.clearTimeout(timer.current);
        timer.current = undefined;
      }

      if (pauseTimer.current !== undefined) {
        window.clearTimeout(pauseTimer.current);
        pauseTimer.current = undefined;
      }
    };
  }, [plantId]);

  /*
   * Если backend ещё не вернул рекомендации,
   * через 4.5 секунды ставим progress bar на паузу.
   *
   * ВАЖНО:
   * effect зависит от careReady.
   *
   * Поэтому когда careReady меняется с false на true,
   * React сначала отменяет старый timeout.
   * Таймер больше не сможет остановить уже готовую анимацию.
   */
  useEffect(() => {
    if (careReady) {
      if (pauseTimer.current !== undefined) {
        window.clearTimeout(pauseTimer.current);
        pauseTimer.current = undefined;
      }

      if (fillRef.current) {
        fillRef.current.style.animationPlayState = "running";
      }

      return;
    }

    pauseTimer.current = window.setTimeout(() => {
      if (!careReady && fillRef.current) {
        fillRef.current.style.animationPlayState = "paused";
      }
    }, 4500);

    return () => {
      if (pauseTimer.current !== undefined) {
        window.clearTimeout(pauseTimer.current);
        pauseTimer.current = undefined;
      }
    };
  }, [careReady]);

  /*
   * Когда рекомендации получены — продолжаем progress bar.
   *
   * Если рекомендации пришли раньше 4.5 секунд,
   * полоса просто продолжает идти до 100%.
   *
   * Если она уже была поставлена на паузу,
   * animationPlayState переключается обратно на running.
   */
  useEffect(() => {
    if (!careReady || !fillRef.current) return;

    const fill = fillRef.current;

    fill.style.animationPlayState = "running";

    /*
     * На случай prefers-reduced-motion:
     * CSS отключает animation, поэтому animationend
     * не придёт.
     */
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (reducedMotion && care) {
      timer.current = window.setTimeout(() => {
        setAnimationReady(true);
      }, 0);
    }

    return () => {
      if (timer.current !== undefined) {
        window.clearTimeout(timer.current);
        timer.current = undefined;
      }
    };
  }, [careReady, care]);

  /*
   * Переходим дальше только когда:
   *
   * 1. backend уже вернул рекомендации;
   * 2. progress bar дошёл до 100%.
   */
  useEffect(() => {
    if (!animationReady || !careReady || !care) return;

    onDone?.(care);
  }, [animationReady, careReady, care, onDone]);

  const handleFillEnd = (
    e: React.AnimationEvent<HTMLDivElement>,
  ) => {
    if (e.animationName !== "scanFill") return;

    setAnimationReady(true);
  };

  const handleRetry = () => {
    window.location.reload();
  };

  return (
    <main className="reg reg--scan">
      <div className="reg__photo" />
      <div className="reg__shade" />

      <section className="reg__content">
        {!error ? (
          <>
            <h1 className="reg__title">
              <span className="scan__line">
                Анализируем
              </span>

              <span className="scan__line reg__accent">
                твое растение
              </span>
            </h1>

            <p className="reg__text">
              Нейросеть подбирает оптимальные условия для здорового роста и
              развития.
            </p>

            <div
              className="scan__bar"
              role="progressbar"
              aria-label="Анализ растения"
              aria-busy="true"
            >
              <div
                ref={fillRef}
                className="scan__fill"
                onAnimationEnd={handleFillEnd}
              />
            </div>
          </>
        ) : (
          <>
            <h1 className="reg__title">
              <span className="scan__line">
                Не удалось
              </span>

              <span className="scan__line reg__accent">
                завершить анализ
              </span>
            </h1>

            <p className="reg__text">
              {error}
            </p>

            <button
              className="reg__button"
              type="button"
              onClick={handleRetry}
            >
              Попробовать ещё раз
            </button>
          </>
        )}
      </section>
    </main>
  );
}
