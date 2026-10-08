import { useEffect, useRef, useState } from "react";
import {
  IconBack,
  IconCamera,
  IconChat,
  IconChevron,
  IconClose,
  IconDrop,
  IconHistory,
  IconSliders,
  IconSoil,
  IconSoilTemp,
  IconSprout,
  IconSun,
  IconThermo,
  type IconProps,
} from "./icons";
import PlantHistory from "./PlantHistory";
import PlantChat from "./PlantChat";
import type { Note, Plant } from "../types";
import type { CameraPhoto } from "../demoData";
import { formatStamp } from "../format";
import { getPlantCare, type PlantCare } from "../api/plants";
import {
  getLatestReading,
  type LatestReading,
  type WaterSensors,
} from "../api/sensors";
import {
  formatRec,
  pct,
  scaleFor,
  statusOf,
  toRecommended,
  type Recommended,
  type SensorKey,
} from "../care";
import "./PlantDetail.css";


type Mode = "now" | "history" | "chat";
type LoadState = "loading" | "ok" | "error";
type ReadingState = "loading" | "ok" | "empty" | "error";

const READING_POLL_MS = 30_000;

type PlantDetailProps = {
  plant: Plant;
  onBack: () => void;
  onPhoto: (file: File) => void;
  onNotesChange?: (notes: Note[]) => void;
  onOpenControl?: () => void;
  photos?: CameraPhoto[];
  initialMode?: "now" | "chat";
};

const ROWS: {
  key: SensorKey;
  label: string;
  unit: string;
  Icon: (p: IconProps) => React.JSX.Element;
}[] = [
  { key: "airHumidity", label: "Влажность воздуха", unit: "%", Icon: IconDrop },
  { key: "soilHumidity", label: "Влажность почвы", unit: "%", Icon: IconSoil },
  { key: "airTemp", label: "Температура воздуха", unit: "°C", Icon: IconThermo },
  { key: "soilTemp", label: "Температура почвы", unit: "°C", Icon: IconSoilTemp },
  { key: "light", label: "Освещённость", unit: "лк", Icon: IconSun },
];

const WATER_ROWS: {
  key: keyof WaterSensors;
  label: string;
  unit: string;
  Icon: (p: IconProps) => React.JSX.Element;
}[] = [
  { key: "waterLevel", label: "Уровень воды в баке", unit: "%", Icon: IconDrop },
  { key: "waterFlow", label: "Расход воды", unit: "л/мин", Icon: IconDrop },
];

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

function plural(n: number, [one, few, many]: [string, string, string]) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

const TITLES: Record<Mode, string> = {
  now: "Показания",
  history: "История",
  chat: "Чат с нейросетью",
};

export default function PlantDetail({
  plant,
  onBack,
  onPhoto,
  onNotesChange,
  photos,
  onOpenControl,
  initialMode = "now",
}: PlantDetailProps) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const blockRef = useRef<HTMLDivElement>(null);
  const days = daysSince(plant.plantedAt);

  // ----- благоприятные условия с бэкенда -----
  const [care, setCare] = useState<PlantCare | null>(null);
  const [careState, setCareState] = useState<LoadState>("loading");
  const [careReload, setCareReload] = useState(0);

  useEffect(() => {
    const plantId = plant.id;
    if (plantId === undefined) {
      setCareState("error");
      return;
    }

    let cancelled = false;
    setCareState("loading");
    getPlantCare(plantId)
      .then((c) => {
        if (cancelled) return;
        setCare(c);
        setCareState("ok");
      })
      .catch(() => {
        if (!cancelled) setCareState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [plant.id, careReload]);

  const recommended: Recommended | null = care ? toRecommended(care) : null;

  // ----- текущие показания датчиков -----
  const [reading, setReading] = useState<LatestReading | null>(null);
  const [readingState, setReadingState] = useState<ReadingState>("loading");

  useEffect(() => {
    const plantId = plant.id;
    if (plantId === undefined) {
      setReadingState("error");
      return;
    }

    let cancelled = false;
    setReading(null);
    setReadingState("loading");

    const load = async () => {
      try {
        const r = await getLatestReading(plantId);
        if (cancelled) return;
        if (r === null) {
          setReading(null);
          setReadingState("empty");
        } else {
          setReading(r);
          setReadingState("ok");
        }
      } catch {
        // при сбое оставляем уже показанные данные, а если их нет, показываем ошибку
        if (!cancelled) setReadingState((s) => (s === "ok" ? "ok" : "error"));
      }
    };

    void load();
    const id = window.setInterval(load, READING_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [plant.id]);

  const live = reading?.sensors ?? null;

  const scrollToBlock = () =>
    blockRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  // если открыли сразу с чата (плитка «Советы по уходу»), прокручиваем к нему
  useEffect(() => {
    if (initialMode !== "chat") return;
    const id = window.setTimeout(scrollToBlock, 150);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openChat = () => {
    setMode("chat");
    window.setTimeout(scrollToBlock, 50);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onPhoto(file);
    e.target.value = "";
  };

  const nowSubtitle =
    readingState === "ok" && reading
      ? `Обновлено ${formatStamp(reading.recordedAt).toLowerCase()}`
      : readingState === "loading"
        ? "Загружаем показания…"
        : readingState === "empty"
          ? "Датчики пока ничего не прислали"
          : "Нет связи с сервером, повторим автоматически";

  const subtitle =
    mode === "now"
      ? nowSubtitle
      : mode === "history"
        ? "Показания, заметки, действия и фото"
        : "Советы по уходу";

  return (
    <div className="pd">
      {/* ===== Фото на всю ширину, уходит в чёрный ===== */}
      <section className="pd__hero">
        {plant.photo ? (
          <img className="pd__img" src={plant.photo} alt={`Фото: ${plant.name}`} />
        ) : (
          <div className="pd__empty">
            <IconSprout size={56} />
          </div>
        )}
        <div className="pd__fade" />

        <button
          className="pd__back glass"
          type="button"
          aria-label="Назад к растениям"
          onClick={onBack}
        >
          <IconBack size={22} />
        </button>

        <label
          className={`pd__photo glass ${plant.photo ? "" : "pd__photo--text"}`}
        >
          <IconCamera size={20} />
          {!plant.photo && <span>Добавить фото</span>}
          <input
            type="file"
            accept="image/*"
            aria-label="Изменить фото растения"
            onChange={handleFile}
          />
        </label>

        <div className="pd__info">
          <h1 className="pd__name">{plant.name}</h1>
          <p className="pd__species">
            {plant.species}, {days > 0 ? "посажено" : "посадка"}{" "}
            {formatDate(plant.plantedAt)}
          </p>
          <span className="pd__days">
            {days > 0
              ? `Растёт ${days} ${plural(days, ["день", "дня", "дней"])}`
              : "Скоро посадка"}
          </span>
        </div>
      </section>

      {/* ===== Показания / история / чат ===== */}
      <div className="pd__body" ref={blockRef}>
        <div className="pd__head">
          <div>
            <h2 className="section__title">{TITLES[mode]}</h2>
            <p className="pd__updated">{subtitle}</p>
          </div>
          <button
            className={`pd__history glass ${mode !== "now" ? "pd__history--on" : ""}`}
            type="button"
            aria-pressed={mode === "history"}
            onClick={() => setMode(mode === "now" ? "history" : "now")}
          >
            {mode === "now" ? <IconHistory size={16} /> : <IconClose size={16} />}
            {mode === "now" ? "История" : "Закрыть"}
          </button>
        </div>

        <div className="pd__swap" key={mode}>
          {mode === "history" && (
            <PlantHistory
              plantId={plant.id}
              notes={plant.notes ?? []}
              onNotesChange={onNotesChange ?? (() => {})}
              recommended={recommended}
              photos={photos}
            />
          )}

          {mode === "chat" && (
            <PlantChat plantId={plant.id} plantName={plant.name} />
          )}

          {mode === "now" && (
            <>
              {careState === "ok" && care && (
                <div className="pd__care">
                  <span className="pd__stage">Фаза: {care.growth_stage}</span>
                  {care.notes && <p className="pd__care-notes">{care.notes}</p>}
                </div>
              )}

              {careState === "error" && (
                <p className="pd__care-error">
                  Не удалось загрузить рекомендации
                  <button type="button" onClick={() => setCareReload((n) => n + 1)}>
                    Повторить
                  </button>
                </p>
              )}

              <div className="pd__list">
                {ROWS.map(({ key, label, unit, Icon }) => {
                  const value = live?.[key] ?? null;
                  const range = recommended?.[key];
                  const status = value === null ? "ok" : statusOf(value, range);
                  const warn = status !== "ok";
                  const scale = scaleFor(key, range);

                  const from = range ? pct(range.min, scale) : 0;
                  const to = range ? pct(range.max, scale) : 0;

                  return (
                    <div className="pd__row pd__row--sensor" key={key}>
                      <span className="pd__row-icon">
                        <Icon size={20} />
                      </span>

                      <span className="pd__row-text">
                        <span className="pd__row-label">{label}</span>
                        <span className="pd__row-sub">
                          {range
                            ? `Рекомендуется ${formatRec(range, unit)}`
                            : careState === "loading"
                              ? "Загружаем рекомендации…"
                              : "Рекомендации недоступны"}
                        </span>
                        <span className="pd__bar" aria-hidden="true">
                          {range && (
                            <span
                              className="pd__bar-zone"
                              style={{ left: `${from}%`, width: `${to - from}%` }}
                            />
                          )}
                          {value !== null && (
                            <span
                              className={`pd__bar-dot ${warn ? "pd__bar-dot--warn" : ""}`}
                              style={{ left: `${pct(value, scale)}%` }}
                            />
                          )}
                        </span>
                      </span>

                      <span className="pd__row-side">
                        <span
                          className={`pd__row-value ${warn ? "pd__row-value--warn" : ""}`}
                        >
                          {value === null
                            ? "—"
                            : key === "light"
                              ? Math.round(value).toLocaleString("ru-RU")
                              : Math.round(value * 10) / 10}
                          {value !== null && (
                            <span className="pd__row-unit">{unit}</span>
                          )}
                        </span>
                        {warn && (
                          <span className="pd__row-flag">
                            {status === "low" ? "ниже нормы" : "выше нормы"}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="pd__list pd__list--links">
                {WATER_ROWS.map(({ key, label, unit, Icon }) => {
                  const value = reading?.water[key] ?? null;
                  return (
                    <div className="pd__row pd__row--sensor" key={key}>
                      <span className="pd__row-icon">
                        <Icon size={20} />
                      </span>
                      <span className="pd__row-text">
                        <span className="pd__row-label">{label}</span>
                      </span>
                      <span className="pd__row-side">
                        <span className="pd__row-value">
                          {value === null ? "—" : Math.round(value * 10) / 10}
                          {value !== null && (
                            <span className="pd__row-unit">{unit}</span>
                          )}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="pd__list pd__list--links">
          <button
            className="pd__row pd__row--link"
            type="button"
            onClick={onOpenControl}
          >
            <span className="pd__row-icon">
              <IconSliders size={20} />
            </span>
            <span className="pd__row-text">
              <span className="pd__row-label">Управление оранжереей</span>
              <span className="pd__row-sub">Устройства и режимы</span>
            </span>
            <span className="pd__row-chev">
              <IconChevron size={18} />
            </span>
          </button>

          <button
            className="pd__row pd__row--link"
            type="button"
            onClick={openChat}
          >
            <span className="pd__row-icon">
              <IconChat size={22} />
            </span>
            <span className="pd__row-text">
              <span className="pd__row-label">Чат с нейросетью</span>
              <span className="pd__row-sub">Спросить совет по уходу</span>
            </span>
            <span className="pd__row-chev">
              <IconChevron size={18} />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
