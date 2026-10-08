import "./NotificationSettings.css";
import NotificationSettings from "./NotificationSettings";

export default function SettingsTab() {
  return (
    <div className="stub" style={{ alignItems: "stretch", textAlign: "left" }}>
      <h1 className="stub__title">Настройки</h1>
      <NotificationSettings />
    </div>
  );
}