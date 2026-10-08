import { request } from "./client";
import type { AppNotification, NotificationKind } from "../demoData";

type ApiNotification = {
  id: number;
  plant_id: number | null;
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  data: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
  read_at: string | null;
};

function kindOf(n: ApiNotification): NotificationKind {
  if (n.severity !== "info") return "alert"; // sensor_alert, water_low, device_offline, command_failed
  if (n.type.startsWith("care_")) return "action";
  return "system"; // *_recovered, device_online
}

const toApp = (n: ApiNotification): AppNotification => ({
  id: String(n.id),
  kind: kindOf(n),
  title: n.title,
  text: n.message,
  at: Date.parse(n.created_at), // бэкенд отдаёт время с UTC-зоной
  read: n.is_read,
});

export async function fetchNotifications(limit = 100): Promise<AppNotification[]> {
  const list = await request<ApiNotification[]>(`/notifications?limit=${limit}`);
  return list.map(toApp);
}

export const markNotificationRead = (id: number) =>
  request(`/notifications/${id}/read`, { method: "POST" });

export const markAllNotificationsRead = () =>
  request(`/notifications/read-all`, { method: "POST" });

