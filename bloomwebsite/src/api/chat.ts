import { request } from "./client";

type ChatMessageResponse = {
  id: number;
  role: "user" | "assistant";
  content: string;
  model: string | null;
  created_at: string; // всегда UTC
};

type ChatReplyResponse = {
  user_message: ChatMessageResponse;
  assistant_message: ChatMessageResponse;
};

export type ChatItem = {
  id: number;
  role: "user" | "assistant";
  text: string;
  createdAt: number; // мс
};

// ответ нейросети может идти долго
const CHAT_TIMEOUT_MS = 60_000;

function mapMessage(m: ChatMessageResponse): ChatItem {
  return {
    id: m.id,
    role: m.role,
    text: m.content,
    createdAt: Date.parse(m.created_at),
  };
}

/** История чата, от старых к новым (бэкенд: до 200 сообщений) */
export async function getChatHistory(plantId: number, limit = 100): Promise<ChatItem[]> {
  const rows = await request<ChatMessageResponse[]>(`/plants/${plantId}/chat?limit=${limit}`);
  return rows.map(mapMessage);
}

/** Отправить сообщение и получить ответ нейросети */
export async function sendChatMessage(
  plantId: number,
  message: string,
): Promise<{ user: ChatItem; assistant: ChatItem }> {
  const r = await request<ChatReplyResponse>(`/plants/${plantId}/chat`, {
    method: "POST",
    body: { message },
    timeoutMs: CHAT_TIMEOUT_MS,
  });
  return { user: mapMessage(r.user_message), assistant: mapMessage(r.assistant_message) };
}

/** Повторить ответ, если нейросеть не ответила на последнее сообщение */
export async function retryChatReply(plantId: number): Promise<ChatItem> {
  const m = await request<ChatMessageResponse>(`/plants/${plantId}/chat/retry`, {
    method: "POST",
    timeoutMs: CHAT_TIMEOUT_MS,
  });
  return mapMessage(m);
}