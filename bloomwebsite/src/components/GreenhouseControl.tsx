import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  IconBack,
  IconBlinds,
  IconBulb,
  IconCamera,
  IconCloudDrizzle,
  IconDrop,
  IconSun,
  IconWind,
  type IconProps,
} from "./icons";
import { ApiError } from "../api/client";
import {
  getActuatorState,
  getPhotoUrl,
  listPhotos,
  parseUtc,
  sendCommand,
  waitForCommand,
  type ActuatorState,
  type CommandBody,
  type CommandResult,
  type LampColor,
  type PhotoInfo,
} from "../api/commands";
import { formatStamp } from "../format";
import "./GreenhouseControl.css";

type DimColor = Exclude<LampColor, "strip">;

type GreenhouseControlProps = {
  plantId?: number;
  onBack: () => void;
};

const PUMP_OPTIONS = [1, 3, 5, 10]; // минуты автоотключения
const CURTAIN_TRAVEL_MS = 8000; // только для полоски прогресса
const POLL_STATE_MS = 5000;
const SETTLE_MS = 8000; // сколько держим новое положение, пока сервер обновит состояние

const LAMPS: {
  key: LampColor;
  label: string;
  color: string;
  bg: string;
  dimmable: boolean;
}[] = [
  { key: "red", label: "Красный свет", color: "#ff453a", bg: "rgba(255,69,58,0.18)", dimmable: true },
  { key: "dark_red", label: "Тёмно-красный свет", color: "#b3202e", bg: "rgba(179,32,46,0.24)", dimmable: true },
  { key: "blue", label: "Синий свет", color: "#0a84ff", bg: "rgba(10,132,255,0.2)", dimmable: true },
  { key: "strip", label: "Светодиодная лента", color: "#ffd60a", bg: "rgba(255,214,10,0.18)", dimmable: false },
];

const FANS: { n: number; label: string; dir: string }[] = [
  { n: 1, label: "Вентилятор 1", dir: "Вдув" },
  { n: 2, label: "Вентилятор 2", dir: "Вдув" },
  { n: 3, label: "Вентилятор 3", dir: "Выдув" },
];

const sliderPct = (v: number) => `${((v - 1) / 99) * 100}%`;

function formatLeft(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function failText(r: CommandResult): string {
  if (r.status === "failed") return r.message || "Устройство не смогло выполнить команду";
  if (r.status === "expired") return r.message || "Устройство не забрало команду";
  return "Устройство не отвечает. Проверьте, что оно включено";
}

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** Временное «ожидаемое» значение, пока устройство выполняет команду */
type Override = { value: unknown; until: number };

export default function GreenhouseControl({ plantId, onBack }: GreenhouseControlProps) {
  const now = useNow();
  const alive = useRef(true);

  const [server, setServer] = useState<ActuatorState | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ok" | "error">("loading");
  const [over, setOver] = useState<Record<string, Override>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [pumpMinutes, setPumpMinutes] = useState(5);
  const [drafts, setDrafts] = useState<Partial<Record<LampColor, number>>>({});

  const seq = useRef<Record<string, number>>({});
  const brightnessTimers = useRef<Partial<Record<LampColor, number>>>({});

  // ---------- состояние устройств с сервера ----------
 const refresh = useCallback(async (): Promise<boolean> => {
  if (plantId === undefined) return false;
  try {
    const s = await getActuatorState(plantId);
    if (!alive.current) return false;
    setServer(s);
    setLoadState("ok");
    return true;
  } catch {
    if (alive.current) setLoadState((p) => (p === "ok" ? "ok" : "error"));
    return false;
  }
}, [plantId]);

  useEffect(() => {
    alive.current = true;
    const timers = brightnessTimers.current;
    void refresh();
    const id = window.setInterval(refresh, POLL_STATE_MS);
    return () => {
      alive.current = false;
      window.clearInterval(id);
      Object.values(timers).forEach((t) => window.clearTimeout(t));
    };
  }, [refresh]);

  // сообщение об ошибке гаснет само
  useEffect(() => {
    if (!error) return;
    const id = window.setTimeout(() => setError(""), 6000);
    return () => window.clearTimeout(id);
  }, [error]);

  const ov = <T,>(key: string): T | undefined => {
    const o = over[key];
    return o && o.until > now ? (o.value as T) : undefined;
  };

  // ---------- отправка команды ----------
  const run = async (key: string, value: unknown, body: CommandBody) => {
    if (plantId === undefined) return;
    const id = (seq.current[key] = (seq.current[key] ?? 0) + 1);
    const latest = () => seq.current[key] === id;

    setOver((o) => ({ ...o, [key]: { value, until: Infinity } }));
    setBusy((b) => ({ ...b, [key]: true }));
    setError("");

    let ok = false;
    try {
      const cmd = await sendCommand(plantId, body);
      const result = await waitForCommand(plantId, cmd.id, () => !alive.current);
      if (!alive.current) return;
      if (result.status === "done") ok = true;
      else if (latest()) setError(failText(result));
    } catch (e) {
      if (alive.current && latest()) {
        setError(e instanceof ApiError ? e.message : "Не удалось отправить команду");
      }
    } finally {
      if (alive.current && latest()) {
        setBusy((b) => ({ ...b, [key]: false }));

        // после успеха сервер уже знает новое состояние: берём его сразу
        const fresh = ok ? await refresh() : false;

        if (alive.current && latest()) {
          setOver((o) => {
            const next = { ...o };
            // если состояние получить не удалось (нет сети), ещё ненадолго держим ожидаемое положение
            if (ok && !fresh) next[key] = { value, until: Date.now() + SETTLE_MS };
            else delete next[key];
            return next;
          });
        }
        if (!ok) void refresh();
      }
    }
  };

  // ---------- значения для интерфейса ----------
  const srvPumpUntil = server?.pump.until ? parseUtc(server.pump.until) : null;
  const srvPumpOn =
    server?.pump.is_on === true && (srvPumpUntil === null || srvPumpUntil > now);
  const pump = ov<{ on: boolean; until: number | null }>("pump") ?? {
    on: srvPumpOn,
    until: srvPumpUntil,
  };

  const fanOn = (n: number) =>
    ov<boolean>(`fan${n}`) ?? server?.fans.find((f) => f.number === n)?.is_on ?? false;

  const lampView = (color: LampColor) => {
    const s = server?.lamps.find((l) => l.color === color);
    return (
      ov<{ on: boolean; brightness: number | null }>(`lamp:${color}`) ?? {
        on: s?.is_on ?? false,
        brightness: s?.brightness ?? null,
      }
    );
  };

  const humidifierOn = ov<boolean>("humidifier") ?? server?.humidifier.is_on ?? false;
  const curtain = ov<"open" | "closed">("curtain") ?? server?.curtain.state ?? null;

  // ---------- действия ----------
  const setPump = (on: boolean) =>
    run(
      "pump",
      { on, until: on ? Date.now() + pumpMinutes * 60_000 : null },
      on
        ? { type: "pump", action: "on", duration_sec: pumpMinutes * 60 }
        : { type: "pump", action: "off" },
    );

  const changePumpMinutes = (m: number) => {
    setPumpMinutes(m);
    // если насос уже работает, перезапускаем его с новым временем
    if (pump.on) {
      void run(
        "pump",
        { on: true, until: Date.now() + m * 60_000 },
        { type: "pump", action: "on", duration_sec: m * 60 },
      );
    }
  };

  const setFan = (n: number, on: boolean) =>
    run(`fan${n}`, on, { type: "fan", action: on ? "on" : "off", fans: [n] });

  const setHumidifier = (on: boolean) =>
    run("humidifier", on, { type: "humidifier", action: on ? "on" : "off" });

  const setCurtain = (target: "open" | "closed") => {
    if (busy.curtain || curtain === target) return;
    void run("curtain", target, {
      type: "curtain",
      action: target === "open" ? "open" : "close",
    });
  };

  const brightnessOf = (color: LampColor) => drafts[color] ?? lampView(color).brightness ?? 50;

  const toggleLamp = (color: LampColor, on: boolean) => {
    if (!on) {
      return run(`lamp:${color}`, { on: false, brightness: null }, { type: "lamp", action: "off", color });
    }
    if (color === "strip") {
      return run(`lamp:strip`, { on: true, brightness: null }, { type: "lamp", action: "on", color });
    }
    const b = brightnessOf(color);
    return run(
      `lamp:${color}`,
      { on: true, brightness: b },
      { type: "lamp", action: "on", color, brightness: b },
    );
  };

  // яркость отправляем, когда ползунок остановился
  const changeBrightness = (color: DimColor, v: number) => {
    setDrafts((d) => ({ ...d, [color]: v }));
    window.clearTimeout(brightnessTimers.current[color]);
    brightnessTimers.current[color] = window.setTimeout(() => {
      void run(
        `lamp:${color}`,
        { on: true, brightness: v },
        { type: "lamp", action: "on", color, brightness: v },
      );
    }, 450);
  };

  // ---------- камера ----------
  const [shooting, setShooting] = useState(false);
  const [flashKey, setFlashKey] = useState(0);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoAt, setPhotoAt] = useState<number | null>(null);
  const urlRef = useRef<string | null>(null);

  const showPhoto = useCallback(
    async (p: PhotoInfo) => {
      if (plantId === undefined) return;
      const url = await getPhotoUrl(plantId, p.id);
      if (!alive.current) {
        URL.revokeObjectURL(url);
        return;
      }
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = url;
      setPhotoUrl(url);
      setPhotoAt(parseUtc(p.created_at));
    },
    [plantId],
  );

  // последний снимок при открытии экрана
  useEffect(() => {
    if (plantId === undefined) return;
    listPhotos(plantId, 1)
      .then(([p]) => (p ? showPhoto(p) : undefined))
      .catch(() => {});
  }, [plantId, showPhoto]);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const takePhoto = async () => {
    if (shooting || plantId === undefined) return;
    setShooting(true);
    setFlashKey((k) => k + 1);
    setError("");
    try {
      const cmd = await sendCommand(plantId, { type: "camera" });
      const result = await waitForCommand(plantId, cmd.id, () => !alive.current);
      if (!alive.current) return;
      if (result.status !== "done") {
        setError(failText(result));
        return;
      }
      // файл может дойти чуть позже ответа устройства
      for (let i = 0; i < 6; i++) {
        const [p] = await listPhotos(plantId, 1, cmd.id);
        if (p) {
          await showPhoto(p);
          return;
        }
        await sleep(1000);
        if (!alive.current) return;
      }
      setError("Снимок пока не пришёл, попробуйте позже");
    } catch (e) {
      if (alive.current) {
        setError(e instanceof ApiError ? e.message : "Не удалось сделать снимок");
      }
    } finally {
      if (alive.current) setShooting(false);
    }
  };

  // ---------- подписи ----------
  const wait = "Ждём ответа устройства…";

  const pumpSub = busy.pump
    ? wait
    : pump.on
      ? pump.until !== null
        ? `Отключится через ${formatLeft(pump.until - now)}`
        : "Работает"
      : "Выключен";

  const curtainTarget = curtain ?? "closed";
  const curtainSub = busy.curtain
    ? curtainTarget === "open"
      ? "Открывается…"
      : "Закрывается…"
    : curtain === null
      ? "Положение неизвестно"
      : curtain === "open"
        ? "Открыта"
        : "Закрыта";

  const pending = server?.pending_commands ?? 0;

  if (plantId === undefined) {
    return (
      <div className="gc">
        <Header onBack={onBack} subtitle="Оранжерея" />
        <p className="gc__empty">Сначала добавьте растение: устройства привязываются к нему.</p>
      </div>
    );
  }

  return (
    <div className="gc">
      <Header
        onBack={onBack}
        subtitle={pending > 0 ? `В очереди команд: ${pending}` : "Оранжерея"}
      />

      {error && (
        <p className="gc__error" role="alert">
          {error}
        </p>
      )}

      {loadState === "error" && !server && (
        <p className="gc__error">
          Не удалось получить состояние устройств
          <button className="gc__retry" type="button" onClick={() => void refresh()}>
            Повторить
          </button>
        </p>
      )}

      <div className="gc__grid">
        <div className="gc__col">
          <section className="gc__section gc__section--pump">
            <h2 className="gc__section-title">Полив</h2>
            <div className="gc__list">
              <ToggleRow
                Icon={IconDrop}
                label="Насос для полива"
                sub={pumpSub}
                checked={pump.on}
                disabled={busy.pump}
                onChange={setPump}
              />

              <div className="gc__block">
                <span className="gc__text">
                  <span className="gc__label">Автоотключение</span>
                  <span className="gc__sub">Насос выключится сам</span>
                </span>
                <Segmented
                  label="Время автоотключения насоса"
                  value={pumpMinutes}
                  disabled={busy.pump}
                  options={PUMP_OPTIONS.map((m) => ({ value: m, label: `${m} мин` }))}
                  onChange={changePumpMinutes}
                />
              </div>
            </div>
          </section>

          <section className="gc__section gc__section--light">
            <h2 className="gc__section-title">Освещение</h2>
            <div className="gc__list">
              {LAMPS.map(({ key, label, color, bg, dimmable }) => {
                const lamp = lampView(key);
                const b = brightnessOf(key);
                const sub = busy[`lamp:${key}`] && !dimmable
                  ? wait
                  : lamp.on
                    ? dimmable
                      ? `Яркость ${b}%`
                      : "Включена"
                    : dimmable
                      ? "Выключено"
                      : "Выключена";

                return (
                  <div className="gc__light" key={key}>
                    <ToggleRow
                      Icon={IconBulb}
                      label={label}
                      sub={sub}
                      checked={lamp.on}
                      disabled={busy[`lamp:${key}`] && !dimmable}
                      onChange={(v) => void toggleLamp(key, v)}
                      tint={{ color, bg }}
                    />

                    {dimmable && (
                      <div className={`gc__expand ${lamp.on ? "gc__expand--open" : ""}`}>
                        <div className="gc__expand-inner">
                          <div className="gc__slider-row">
                            <span className="gc__slider-icon">
                              <IconSun size={14} />
                            </span>
                            <input
                              className="gc__slider"
                              type="range"
                              min={1}
                              max={100}
                              value={b}
                              disabled={!lamp.on}
                              aria-label={`Яркость: ${label}`}
                              style={
                                { "--p": sliderPct(b), "--c": color } as CSSProperties
                              }
                              onChange={(e) =>
                                changeBrightness(key as DimColor, Number(e.target.value))
                              }
                            />
                            <span className="gc__slider-icon">
                              <IconSun size={20} />
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="gc__section gc__section--curtain">
            <h2 className="gc__section-title">Штора от солнца</h2>
            <div className="gc__list">
              <div className="gc__row">
                <span className="gc__icon gc__icon--on">
                  <IconBlinds size={20} />
                </span>
                <span className="gc__text">
                  <span className="gc__label">Штора</span>
                  <span className="gc__sub">{curtainSub}</span>
                </span>
              </div>

              <div
                className={`gc__progress ${busy.curtain ? "gc__progress--on" : ""}`}
                aria-hidden="true"
                style={{ "--dur": `${CURTAIN_TRAVEL_MS}ms` } as CSSProperties}
              >
                {busy.curtain && <span key={curtainTarget} />}
              </div>

              <div className="gc__seg-wrap">
                <Segmented
                  label="Положение шторы"
                  value={curtainTarget}
                  disabled={busy.curtain}
                  options={[
                    { value: "open", label: "Открыта" },
                    { value: "closed", label: "Закрыта" },
                  ]}
                  onChange={setCurtain}
                />
              </div>
            </div>
          </section>
        </div>

        <div className="gc__col">
          <section className="gc__section gc__section--camera">
            <h2 className="gc__section-title">Камера</h2>
            <div className="gc__list">
              <div className="ccam">
                {photoUrl ? (
                  <img
                    key={photoUrl}
                    className="ccam__img"
                    src={photoUrl}
                    alt={photoAt ? `Последний снимок: ${formatStamp(photoAt)}` : "Последний снимок"}
                  />
                ) : (
                  <div className="ccam__empty">
                    <IconCamera size={40} />
                  </div>
                )}

                {flashKey > 0 && (
                  <span key={flashKey} className="ccam__flash" aria-hidden="true" />
                )}

                {photoUrl && photoAt && (
                  <span className="ccam__time glass">{formatStamp(photoAt)}</span>
                )}
              </div>

              <div className="ccam__bar">
                <button
                  className="ccam__shoot"
                  type="button"
                  disabled={shooting}
                  onClick={() => void takePhoto()}
                >
                  <IconCamera size={20} />
                  {shooting ? "Снимаю…" : "Сделать фото"}
                </button>
                <p className="ccam__note">
                  Снимок делает устройство, это может занять несколько секунд
                </p>
              </div>
            </div>
          </section>

          <section className="gc__section gc__section--humidifier">
            <h2 className="gc__section-title">Влажность</h2>
            <div className="gc__list">
              <ToggleRow
                Icon={IconCloudDrizzle}
                label="Увлажнитель"
                sub={busy.humidifier ? wait : humidifierOn ? "Работает" : "Выключен"}
                checked={humidifierOn}
                disabled={busy.humidifier}
                onChange={setHumidifier}
              />
            </div>
          </section>

          <section className="gc__section gc__section--fans">
            <h2 className="gc__section-title">Вентиляция</h2>
            <div className="gc__list">
              {FANS.map(({ n, label, dir }) => (
                <ToggleRow
                  key={n}
                  Icon={IconWind}
                  label={label}
                  sub={
                    busy[`fan${n}`]
                      ? wait
                      : `${dir}, ${fanOn(n) ? "работает" : "выключен"}`
                  }
                  checked={fanOn(n)}
                  disabled={busy[`fan${n}`]}
                  onChange={(v) => void setFan(n, v)}
                />
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Header({ onBack, subtitle }: { onBack: () => void; subtitle: string }) {
  return (
    <header className="gc__header">
      <button className="gc__back glass" type="button" aria-label="Назад" onClick={onBack}>
        <IconBack size={22} />
      </button>
      <div className="gc__heading">
        <h1 className="gc__title">Управление</h1>
        <p className="gc__subtitle">{subtitle}</p>
      </div>
    </header>
  );
}

function ToggleRow({
  Icon,
  label,
  sub,
  checked,
  onChange,
  tint,
  disabled,
}: {
  Icon: (p: IconProps) => React.JSX.Element;
  label: string;
  sub: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  tint?: { color: string; bg: string };
  disabled?: boolean;
}) {
  return (
    <div className="gc__row">
      <span
        className={`gc__icon ${checked ? "gc__icon--on" : ""} ${tint ? "gc__icon--tint" : ""}`}
        style={
          tint ? ({ "--tint": tint.color, "--tint-bg": tint.bg } as CSSProperties) : undefined
        }
      >
        <Icon size={20} />
      </span>
      <span className="gc__text">
        <span className="gc__label">{label}</span>
        <span className="gc__sub">{sub}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        className={`gc__switch ${checked ? "gc__switch--on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className="gc__knob" />
      </button>
    </div>
  );
}

function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  disabled,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  disabled?: boolean;
}) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  return (
    <div
      className={`gc__seg ${disabled ? "gc__seg--disabled" : ""}`}
      role="radiogroup"
      aria-label={label}
      style={{ "--n": options.length, "--i": index } as CSSProperties}
    >
      <span className="gc__seg-thumb" aria-hidden="true" />
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={disabled}
          className={`gc__seg-btn ${o.value === value ? "gc__seg-btn--active" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}