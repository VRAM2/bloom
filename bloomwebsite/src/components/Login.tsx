import { useRef, useState } from "react";
import { useKeyboardInset } from "../hooks/useKeyboardInset";
import { login } from "../api/auth";
import { ApiError } from "../api/client";
import "./Registration.css";
import "./Login.css";

type LoginProps = {
  onContinue?: (data: { name: string }) => void;
  onRegister?: () => void;
};

export default function Login({ onContinue, onRegister }: LoginProps) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const contentRef = useRef<HTMLElement>(null);

  useKeyboardInset(contentRef);

  const isValid = name.trim().length > 0 && password.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || loading) return;

    setLoading(true);
    setError("");
    try {
      await login(name.trim(), password);
      // при успехе loading не сбрасываем: идёт переход на главный экран
      onContinue?.({ name: name.trim() });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Не удалось войти, попробуйте ещё раз",
      );
      setLoading(false);
    }
  };

  return (
    <main className="reg reg--login">
      <div className="reg__photo" />
      <div className="reg__shade" />

      <section className="reg__content" ref={contentRef}>
        <h1 className="reg__title">
          Снова <span className="reg__accent">вместе!</span>
        </h1>

        <p className="reg__text">
          Зайди в свой профиль, чтобы продолжить заботу о растениях.
        </p>

        <form className="reg__form" onSubmit={handleSubmit} noValidate>
          <div className="reg__fields">
            <input
              className="reg__input"
              type="text"
              placeholder="Имя"
              autoComplete="username"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError("");
              }}
            />
            <input
              className="reg__input"
              type="password"
              placeholder="Пароль"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError("");
              }}
            />
          </div>

          <p className="reg__error" aria-live="polite">
            {error}
          </p>

          <button className="reg__link" type="button" onClick={onRegister}>
            Нет аккаунта? <span>Создать</span>
          </button>

          <button className="reg__button" type="submit" disabled={!isValid || loading}>
            {loading ? "Входим…" : "Войти"}
          </button>
        </form>
      </section>
    </main>
  );
}