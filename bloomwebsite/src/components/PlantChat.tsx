import { useCallback, useEffect, useRef, useState } from "react";
import { IconSend } from "./icons";
import { ApiError } from "../api/client";
import {
  getChatHistory,
  retryChatReply,
  sendChatMessage,
  type ChatItem,
} from "../api/chat";
import "./PlantChat.css";

const SUGGESTIONS = [
  "Когда поливать?",
  "Хватает ли света?",
  "Какая температура нужна?",
  "Почему желтеют листья?",
];

type PlantChatProps = {
  plantId?: number;
  plantName: string;
};

const errorText = (e: unknown) =>
  e instanceof ApiError ? e.message : "Не удалось отправить сообщение";

export default function PlantChat({ plantId, plantName }: PlantChatProps) {
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [load, setLoad] = useState<"loading" | "ok" | "error">("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const [text, setText] = useState("");
  const [waiting, setWaiting] = useState(false); // ждём ответ нейросети
  const [error, setError] = useState("");

  const listRef = useRef<HTMLDivElement>(null);
  const alive = useRef(true);

  const loadHistory = useCallback(async (): Promise<ChatItem[] | null> => {
    if (plantId === undefined) return null;
    try {
      return await getChatHistory(plantId);
    } catch {
      return null;
    }
  }, [plantId]);

  // история при открытии чата
  useEffect(() => {
    alive.current = true;
    if (plantId === undefined) {
      setLoad("error");
      return;
    }

    setLoad("loading");
    void loadHistory().then((h) => {
      if (!alive.current) return;
      if (h) {
        setMessages(h);
        setLoad("ok");
      } else {
        setLoad("error");
      }
    });

    return () => {
      alive.current = false;
    };
  }, [plantId, loadHistory, reloadKey]);

  const last = messages[messages.length - 1];
  // последнее сообщение от пользователя, а ответа нет: нейросеть не ответила
  const needsReply = load === "ok" && !waiting && last?.role === "user";

  // прокрутка к новым сообщениям
  useEffect(() => {
    const el = listRef.current;
    el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, waiting, needsReply]);

  const send = async (value: string) => {
    const v = value.trim();
    if (!v || waiting || plantId === undefined) return;

    const tmp: ChatItem = { id: -Date.now(), role: "user", text: v, createdAt: Date.now() };
    setMessages((m) => [...m, tmp]);
    setText("");
    setWaiting(true);
    setError("");

    try {
      const r = await sendChatMessage(plantId, v);
      if (!alive.current) return;
      setMessages((m) => [...m.filter((x) => x.id !== tmp.id), r.user, r.assistant]);
    } catch (e) {
      if (!alive.current) return;
      setError(errorText(e));

      // сверяемся с сервером: сообщение могло сохраниться, даже если ответа нет
      const fresh = await loadHistory();
      if (!alive.current) return;
      if (fresh) {
        setMessages(fresh);
        const saved = fresh.slice(-2).some((m) => m.role === "user" && m.text === v);
        if (!saved) setText((t) => t || v); // не дошло до сервера: возвращаем текст в поле
      } else {
        setMessages((m) => m.filter((x) => x.id !== tmp.id));
        setText((t) => t || v);
      }
    } finally {
      if (alive.current) setWaiting(false);
    }
  };

  const retry = async () => {
    if (waiting || plantId === undefined) return;
    setWaiting(true);
    setError("");

    try {
      const m = await retryChatReply(plantId);
      if (!alive.current) return;
      setMessages((list) => [...list, m]);
    } catch (e) {
      if (!alive.current) return;
      setError(errorText(e));
      const fresh = await loadHistory(); // ответ мог прийти, пока запрос висел
      if (fresh && alive.current) setMessages(fresh);
    } finally {
      if (alive.current) setWaiting(false);
    }
  };

  if (plantId === undefined) {
    return <p className="cc__state">Сначала нужно сохранить растение.</p>;
  }

  if (load === "loading") {
    return <p className="cc__state">Загружаем переписку…</p>;
  }

  if (load === "error") {
    return (
      <p className="cc__state">
        Не удалось загрузить переписку
        <button className="cc__retry" type="button" onClick={() => setReloadKey((n) => n + 1)}>
          Повторить
        </button>
      </p>
    );
  }

  return (
    <div className="cc">
      <div className="cc__list" ref={listRef} role="log" aria-live="polite">
        <div className="cc__row">
          <div className="cc__bubble cc__bubble--assistant">
            Привет! Я помогу ухаживать за «{plantName}». Спроси про полив, свет, температуру
            или влажность.
          </div>
        </div>

        {messages.map((m) => (
          <div className={`cc__row cc__row--${m.role}`} key={m.id}>
            <div className={`cc__bubble cc__bubble--${m.role}`}>{m.text}</div>
          </div>
        ))}

        {waiting && (
          <div className="cc__row">
            <div
              className="cc__bubble cc__bubble--assistant cc__typing"
              role="status"
              aria-label="Нейросеть печатает ответ"
            >
              <span />
              <span />
              <span />
            </div>
          </div>
        )}

        {needsReply && (
          <div className="cc__row">
            <div className="cc__bubble cc__bubble--assistant cc__failed">
              Нейросеть пока не ответила.
              <button className="cc__retry" type="button" onClick={() => void retry()}>
                Повторить ответ
              </button>
            </div>
          </div>
        )}

        {messages.length === 0 && !waiting && (
          <div className="cc__chips">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                className="cc__chip"
                type="button"
                onClick={() => void send(s)}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p className="cc__error" role="alert">
          {error}
        </p>
      )}

      <form
        className="cc__bar"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <input
          className="cc__input"
          type="text"
          placeholder="Спросить о растении"
          value={text}
          maxLength={500}
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
        />
        <button
          className="cc__send"
          type="submit"
          aria-label="Отправить"
          disabled={!text.trim() || waiting}
        >
          <IconSend size={20} />
        </button>
      </form>

      <p className="cc__note">
        Нейросеть может ошибаться. При болезнях растения лучше посоветоваться со специалистом.
      </p>
    </div>
  );
}