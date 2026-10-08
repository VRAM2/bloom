import {
  IconAlert,
  IconArrow,
  IconBell,
  IconBook,
  IconCheck,
  IconSliders,
  type IconProps,
} from "./icons";
import PlantCard from "./PlantCard";
import type { Plant } from "../types";
import "./HomeTab.css";

type HomeTabProps = {
  userName: string;
  plants: Plant[];
  onPlantPhoto: (index: number, file: File) => void;
  onOpenPlant: (index: number) => void;
  onOpenControl?: () => void;
  onOpenAdvice?: () => void;
  onOpenNotifications?: () => void;
  greenhouseOk?: boolean;
  hasUnread?: boolean;
};

const ACTIONS: {
  title: string;
  sub: string;
  Icon: (p: IconProps) => React.JSX.Element;
}[] = [
  { title: "Устройства", sub: "Управление оранжереей", Icon: IconSliders },
  { title: "Советы по уходу", sub: "Что нужно твоим растениям", Icon: IconBook },
];

function todayLabel() {
  const s = new Date().toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function HomeTab({
  userName,
  plants,
  onPlantPhoto,
  onOpenPlant,
  onOpenControl,
  onOpenNotifications,
  onOpenAdvice,
  greenhouseOk = true,
  hasUnread = false,
}: HomeTabProps) {
  const handleAction = (title: string) => {
    if (title === "Устройства") onOpenControl?.();
    else if (title === "Советы по уходу") onOpenAdvice?.();
  };

  return (
    <div className="home">
      <header className="home__header">
        <div className="home__brand">Bloom</div>
        <button
          className="home__bell glass"
          type="button"
          aria-label={hasUnread ? "Уведомления, есть новые" : "Уведомления"}
          onClick={onOpenNotifications}
        >
          <IconBell size={22} />
          {hasUnread && <span className="home__bell-dot" />}
        </button>
      </header>
      <section className="hero" data-state={greenhouseOk ? "ok" : "warn"}>
        <div className="hero__photo" aria-hidden="true" />

        <div className="hero__body">
          <p className="hero__date">{todayLabel()}</p>
          <h1 className="hero__title">
            Добро пожаловать,
            <span className="hero__name">{userName}.</span>
          </h1>
          <p className="hero__text">
            Растения, условия и управление оранжереей, всё в одном месте.
          </p>

          <div className="hero__status glass">
            <span className="hero__status-icon">
              {greenhouseOk ? <IconCheck size={14} /> : <IconAlert size={14} />}
            </span>
            {greenhouseOk ? "В оранжерее все отлично" : "Нужно внимание"}
          </div>
        </div>
      </section>
      <div className="home__main">
        <section className="section">
          <h2 className="section__title">Мои растения</h2>

          <div className="plants">
            {plants.map((p, i) => (
              <PlantCard
                key={`${p.name}-${p.plantedAt}`}
                plant={p}
                onPhoto={(file) => onPlantPhoto(i, file)}
                onOpen={() => onOpenPlant(i)}
              />
            ))}
          </div>
        </section>

        <section className="section">
          <h2 className="section__title">Быстрый доступ</h2>

          <div className="actions__grid">
            {ACTIONS.map(({ title, sub, Icon }) => (
              <button
                key={title}
                className="action"
                type="button"
                onClick={() => handleAction(title)}
              >
                <span className="action__icon">
                  <Icon size={22} />
                </span>
                <span className="action__text">
                  <span className="action__title">{title}</span>
                  <span className="action__sub">{sub}</span>
                </span>
                <span className="action__arrow">
                  <IconArrow size={20} />
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}