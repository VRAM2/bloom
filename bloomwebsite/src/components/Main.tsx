import { useState, type CSSProperties } from "react";
import {
  IconBell,
  IconHome,
  IconProfile,
  IconSettings,
  type IconProps,
} from "./icons";
import HomeTab from "./HomeTab";
import PlantDetail from "./PlantDetail";
import GreenhouseControl from "./GreenhouseControl";
import NotificationsPanel from "./NotificationsPanel";
import SettingsTab from "./SettingsTab";
import type { Note, Plant } from "../types";
import type { AppNotification, CameraPhoto } from "../demoData";
import "./Main.css";
import ProfileTab from "./ProfileTab";
import DeleteAccountSheet from "./DeleteAccountSheet";

type Tab = "home" | "settings" | "profile";

const TABS: {
  id: Tab;
  label: string;
  Icon: (p: IconProps) => React.JSX.Element;
}[] = [
  { id: "home", label: "Главная", Icon: IconHome },
  { id: "settings", label: "Настройки", Icon: IconSettings },
  { id: "profile", label: "Профиль", Icon: IconProfile },
];

type MainProps = {
  userName: string;
  plants: Plant[];
  onPlantPhoto: (index: number, file: File) => void;
  onPlantNotes: (index: number, notes: Note[]) => void;
  photos: CameraPhoto[];
  notifications: AppNotification[];
  onNotificationRead: (id: string) => void;
  onNotificationsReadAll: () => void;
  onLogout: () => void;
  onAccountDeleted: () => void;
};

export default function Main({
  userName,
  plants,
  onPlantPhoto,
  onPlantNotes,
  photos,
  notifications,
  onNotificationRead,
  onNotificationsReadAll,
  onLogout,
  onAccountDeleted,
}: MainProps) {
  const [tab, setTab] = useState<Tab>("home");
  const [openPlant, setOpenPlant] = useState<number | null>(null);
  const [plantMode, setPlantMode] = useState<"now" | "chat">("now");
  const [showControl, setShowControl] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const index = TABS.findIndex((t) => t.id === tab);

  const selected = openPlant !== null ? plants[openPlant] : undefined;
  const unread = notifications.filter((n) => !n.read).length;

  const renderHome = () => {
    if (showControl) {
      return (
        <GreenhouseControl
          // устройства привязаны к растению; пока оно одно, берём первое
          plantId={(selected ?? plants[0])?.id}
          onBack={() => setShowControl(false)}
        />
      );
    }

    if (selected && openPlant !== null) {
      return (
        <PlantDetail
          plant={selected}
          initialMode={plantMode}
          photos={photos}
          onBack={() => setOpenPlant(null)}
          onPhoto={(file) => onPlantPhoto(openPlant, file)}
          onNotesChange={(notes) => onPlantNotes(openPlant, notes)}
          onOpenControl={() => setShowControl(true)}
        />
      );
    }

    return (
      <HomeTab
        userName={userName}
        plants={plants}
        hasUnread={unread > 0}
        onPlantPhoto={onPlantPhoto}
        onOpenPlant={(i) => {
          setPlantMode("now");
          setOpenPlant(i);
        }}
        onOpenControl={() => setShowControl(true)}
        onOpenAdvice={() => {
          if (plants.length === 0) return;
          setPlantMode("chat");
          setOpenPlant(0); // пока одно растение; позже можно спрашивать, какое
        }}
        onOpenNotifications={() => setNotifOpen(true)}
      />
    );
  };

  return (
    <div className="main">
      {/* На телефоне «полоса» не видна, остаётся только меню внизу */}
      <header className="bar">
        <div className="bar__brand">Bloom</div>

        <nav className="nav glass" aria-label="Основное меню">
          <div className="nav__list" style={{ "--i": index } as CSSProperties}>
            <span className="nav__indicator glass" aria-hidden="true" />
            {TABS.map(({ id, label, Icon }) => {
              const active = id === tab;
              return (
                <button
                  key={id}
                  type="button"
                  className={`nav__item ${active ? "nav__item--active" : ""}`}
                  aria-current={active ? "page" : undefined}
                  onClick={() => {
                    setTab(id);
                    setOpenPlant(null);
                    setShowControl(false);
                  }}
                >
                  <Icon size={22} />
                  <span className="nav__label">{label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        <button
          className="bar__bell glass"
          type="button"
          aria-label={
            unread > 0 ? `Уведомления, новых: ${unread}` : "Уведомления"
          }
          aria-haspopup="dialog"
          onClick={() => setNotifOpen(true)}
        >
          <IconBell size={22} />
          {unread > 0 && <span className="bar__bell-dot" />}
        </button>
      </header>

      <div
        className="main__scroll"
        key={`${tab}-${openPlant}-${showControl}`}
      >
        {tab === "home" && renderHome()}
        {tab === "settings" && <SettingsTab />}
        {tab === "profile" && (
          <ProfileTab
            userName={userName}
            onLogout={onLogout}
            onDelete={() => setDeleteOpen(true)}
          />
        )}
      </div>

      <NotificationsPanel
        open={notifOpen}
        items={notifications}
        onClose={() => setNotifOpen(false)}
        onRead={onNotificationRead}
        onReadAll={onNotificationsReadAll}
      />
      {deleteOpen && (
        <DeleteAccountSheet
          onClose={() => setDeleteOpen(false)}
          onDeleted={onAccountDeleted}
        />
      )}
    </div>
  );
}