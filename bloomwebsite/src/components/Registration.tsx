import { useRef, useState } from "react";
import { useKeyboardInset } from "../hooks/useKeyboardInset";
import { register } from "../api/auth";
import { ApiError } from "../api/client";
import "./Registration.css";

type RegistrationProps = {
  onContinue?: (data: { name: string }) => void;
  onLogin?: () => void;
};

// Те же правила, что на бэкенде (app/schemas.py)
function validate(name: string, password: string, confirm: string): string {
  const n = name.trim();
  if (n.length < 3) return "Имя должно содержать минимум 3 символа";
  if (n.length > 50) return "Имя слишком длинное (максимум 50 символов)";
  if (password.length < 8) return "Пароль должен содержать минимум 8 символов";
  if (new TextEncoder().encode(password).length > 72) {
    return "Пароль слишком длинный: максимум 72 байта (около 36 русских букв)";
  }
  if (password !== confirm) return "Пароли не совпадают";
  return "";
}

export default function Registration({ onContinue, onLogin }: RegistrationProps) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const contentRef = useRef<HTMLElement>(null);

  useKeyboardInset(contentRef);

  const filled = name.trim().length > 0 && password.length > 0 && confirm.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!filled || loading) return;

    const problem = validate(name, password, confirm);
    if (problem) {
      setError(problem);
      return;
    }

    setLoading(true);
    setError("");
    try {
      await register(name.trim(), password, confirm);
      // при успехе loading не сбрасываем: идёт переход на следующий экран
      onContinue?.({ name: name.trim() });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Не удалось создать аккаунт, попробуйте ещё раз",
      );
      setLoading(false);
    }
  };

  const edit = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setter(e.target.value);
    setError("");
  };

  return (
    <main className="reg">
      <div className="reg__photo" />
      <div className="reg__shade" />

      <section className="reg__content" ref={contentRef}>
        <h1 className="reg__title">
          Начнем с <span className="reg__accent">тебя</span>
        </h1>

        <p className="reg__text">
          Расскажи немного о себе, а обо всём остальном позабочусь я.
        </p>

        <form className="reg__form" onSubmit={handleSubmit} noValidate>
          <div className="reg__fields">
            <input
              className="reg__input"
              type="text"
              placeholder="Имя"
              autoComplete="username"
              value={name}
              onChange={edit(setName)}
            />
            <input
              className="reg__input"
              type="password"
              placeholder="Пароль"
              autoComplete="new-password"
              value={password}
              onChange={edit(setPassword)}
            />
            <input
              className="reg__input"
              type="password"
              placeholder="Подтвердите пароль"
              autoComplete="new-password"
              value={confirm}
              onChange={edit(setConfirm)}
            />
          </div>

          <p className="reg__error" aria-live="polite">
            {error}
          </p>

          <button className="reg__link" type="button" onClick={onLogin}>
            Уже есть аккаунт? <span>Войти</span>
          </button>

          <button className="reg__button" type="submit" disabled={!filled || loading}>
            {loading ? "Создаём…" : "Продолжить"}
          </button>
        </form>
      </section>
    </main>
  );
}