import { request } from "./client";

export type PushState = "unsupported" | "denied" | "off" | "on";

export const isPushSupported = (): boolean =>
  "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function sendToServer(sub: PushSubscription): Promise<void> {
  const { endpoint, keys } = sub.toJSON();
  await request("/push/subscribe", {
    method: "POST",
    body: { endpoint, keys: { p256dh: keys?.p256dh, auth: keys?.auth } },
  });
}

export async function getPushState(): Promise<PushState> {
  if (!isPushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "off";
  return (await currentSubscription()) ? "on" : "off";
}

/** Вызывать ТОЛЬКО из обработчика клика: иначе браузер (особенно iOS) не покажет запрос разрешения. */
export async function enablePush(): Promise<PushState> {
  if (!isPushSupported()) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { public_key } = await request<{ public_key: string }>("/push/public-key");
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(public_key),
    });
  }
  await sendToServer(sub);
  return "on";
}

export async function disablePush(): Promise<void> {
  if (!isPushSupported()) return;
  const sub = await currentSubscription();
  if (!sub) return;
  await request("/push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe();
}

/** При старте приложения после входа: перепривязывает существующую подписку к текущему аккаунту. */
export async function syncPushSubscription(): Promise<void> {
  if (!isPushSupported() || Notification.permission !== "granted") return;
  const sub = await currentSubscription();
  if (sub) await sendToServer(sub).catch(() => {});
}

export const sendTestPush = () =>
  request<{ sent: number; subscriptions: number }>("/push/test", { method: "POST" });