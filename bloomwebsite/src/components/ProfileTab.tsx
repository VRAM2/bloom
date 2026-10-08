import { IconChevron, IconTrash, type IconProps } from "./icons";
import "./ProfileTab.css";

type ProfileTabProps = {
  userName: string;
  onLogout: () => void;
  onDelete: () => void;
};

function IconLogout({ size = 24 }: IconProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

export default function ProfileTab({ userName, onLogout, onDelete }: ProfileTabProps) {
  const initial = userName.trim().charAt(0).toLocaleUpperCase("ru") || "?";

  return (
    <div className="pf">
      <div className="pf__head">
        <h1 className="section__title">Профиль</h1>
        <p className="pf__head-sub">Аккаунт и настройки</p>
      </div>

      <div className="pf__body">
        <div className="pf__user">
          <span className="pf__avatar" aria-hidden="true">
            {initial}
          </span>
          <span className="pf__user-text">
            <span className="pf__name">{userName}</span>
            <span className="pf__user-sub">Аккаунт Bloom</span>
          </span>
        </div>

        <section className="pf__section pf__section--account">
          <h2 className="pf__section-title">Аккаунт</h2>
          <div className="pf__list">
            <button className="pf__row" type="button" onClick={onLogout}>
              <span className="pf__icon">
                <IconLogout size={20} />
              </span>
              <span className="pf__text">
                <span className="pf__label">Выйти из аккаунта</span>
                <span className="pf__sub">Данные сохранятся, войти можно снова</span>
              </span>
              <span className="pf__chev">
                <IconChevron size={18} />
              </span>
            </button>
          </div>
        </section>

        <section className="pf__section pf__section--danger">
          <h2 className="pf__section-title">Опасная зона</h2>
          <div className="pf__list">
            <button className="pf__row pf__row--danger" type="button" onClick={onDelete}>
              <span className="pf__icon">
                <IconTrash size={20} />
              </span>
              <span className="pf__text">
                <span className="pf__label">Удалить аккаунт</span>
                <span className="pf__sub">Все данные будут стёрты безвозвратно</span>
              </span>
              <span className="pf__chev">
                <IconChevron size={18} />
              </span>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}