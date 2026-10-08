import { useEffect, useRef, useState } from "react";
import { IconAlert } from "./icons";
import { useKeyboardInset } from "../hooks/useKeyboardInset";
import { deleteAccount } from "../api/auth";
import { ApiError } from "../api/client";
import "./DeleteAccountSheet.css";

type DeleteAccountSheetProps = {
  onClose: () => void;
  onDeleted: () => void;
};

export default function DeleteAccountSheet({ onClose, onDeleted }: DeleteAccountSheetProps) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const panelRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // поднимаем окно над клавиатурой (как форму входа)
  useKeyboardInset(panelRef);

  // на ПК сразу ставим курсор в поле, на телефоне не вызываем клавиатуру сама
  useEffect(() => {
    if (window.matchMedia("(hover: hover)").matches) inputRef.current?.focus();
  }, []);

  // Escape закрывает окно, пока не идёт удаление
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loading, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || loading) return;

    setLoading(true);
    setError("");
    try {
      await deleteAccount(password);
      // при успехе loading не сбрасываем: идёт переход на другой экран
      onDeleted();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Не удалось удалить аккаунт, попробуйте ещё раз",
      );
      setLoading(false);
    }
  };

  return (
    <div className="dsheet">
      <div className="dsheet__backdrop" onClick={() => !loading && onClose()} />

      <section
        className="dsheet__panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dsheet-title"
      >
        <span className="dsheet__badge" aria-hidden="true">
          <IconAlert size={22} />
        </span>

        <h2 className="dsheet__title" id="dsheet-title">
          Удалить аккаунт?
        </h2>
        <p className="dsheet__text">
          Профиль, растения, данные датчиков, фотографии и переписка с помощником будут удалены
          безвозвратно. Отменить это нельзя.
        </p>

        <form onSubmit={handleSubmit} noValidate>
          <input
            ref={inputRef}
            className="dsheet__input"
            type="password"
            placeholder="Пароль для подтверждения"
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError("");
            }}
          />

          <p className="dsheet__error" aria-live="polite">
            {error}
          </p>

          <button className="dsheet__danger" type="submit" disabled={!password || loading}>
            {loading ? "Удаляем…" : "Удалить навсегда"}
          </button>
          <button className="dsheet__cancel" type="button" disabled={loading} onClick={onClose}>
            Отмена
          </button>
        </form>
      </section>
    </div>
  );
}