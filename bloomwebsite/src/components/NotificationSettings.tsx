import { useEffect, useState } from "react";
import {
  disablePush,
  enablePush,
  getPushState,
  sendTestPush,
  type PushState,
} from "../api/push";
import "./NotificationSettings.css";

export default function NotificationSettings() {
  const [state, setState] = useState<PushState>("off");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    void getPushState().then(setState);
  }, []);

  const toggle = async () => {
    setBusy(true);
    setMsg("");
    try {
      if (state === "on") {
        await disablePush();
        setState("off");
      } else {
        setState(await enablePush());
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Не удалось изменить настройку");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setMsg("");
    try {
      const r = await sendTestPush();
      setMsg(`Отправлено на устройств: ${r.sent} из ${r.subscriptions}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Ошибка отправки");
    }
  };

  return (
    <section className="ns">
      <h3 className="ns__title">Уведомления</h3>

      {state === "unsupported" && (
        <p className="ns__hint">
          Этот браузер не поддерживает push. На iPhone добавьте приложение на экран «Домой»
          (iOS 16.4 и новее).
        </p>
      )}

      {state === "denied" && (
        <p className="ns__hint">
          Уведомления запрещены в настройках браузера или системы. Разрешите их там и вернитесь.
        </p>
      )}

      {(state === "on" || state === "off") && (
        <>
          <button
            type="button"
            role="switch"
            aria-checked={state === "on"}
            disabled={busy}
            className="ns__row"
            onClick={toggle}
          >
            <span>Push-уведомления</span>
            <span className={`ns__switch ${state === "on" ? "ns__switch--on" : ""}`} />
          </button>

          {state === "on" && (
            <button type="button" className="ns__test" onClick={test}>
              Отправить тестовое уведомление
            </button>
          )}
        </>
      )}

      {msg && (
        <p className="ns__hint" role="status">
          {msg}
        </p>
      )}
    </section>
  );
}