import { useEffect, useState } from "react";
import Greeting from "./components/Greeting";
import Welcome from "./components/Welcome";
import Registration from "./components/Registration";
import Login from "./components/Login";
import PlantSetup from "./components/PlantSetup";
import Analyzing from "./components/Analyzing";
import Ready from "./components/Ready";
import Main from "./components/Main";
import "./App.css";
import type { Note, Plant } from "./types";
import { DEMO_PHOTOS, type CameraPhoto } from "./demoData";
import { displayName, restoreSession, verifySession, logout } from "./api/auth";
import { getToken, onSessionExpired } from "./api/session";
import { getPlants, uploadPlantPhoto } from "./api/plants";
import { useNotifications } from "./hooks/useNotifications";
import { syncPushSubscription } from "./api/push";

type Screen =
  | "greeting"
  | "welcome"
  | "registration"
  | "login"
  | "plant"
  | "analyzing"
  | "ready"
  | "home";

const SCREENS: Screen[] = [
  "greeting",
  "welcome",
  "registration",
  "login",
  "plant",
  "analyzing",
  "ready",
  "home",
];

// экраны, на которых пользователь уже авторизован
const AUTH_SCREENS: Screen[] = ["plant", "analyzing", "ready", "home"];
const REVALIDATE_AFTER_MS = 5 * 60_000;

function App() {
  const [boot] = useState(restoreSession);
  const [screen, setScreen] = useState<Screen>(boot ? "home" : "greeting");
  const [leaving, setLeaving] = useState<Screen | null>(null);
  const [userName, setUserName] = useState(boot ? displayName(boot.username) : "");
  const [plants, setPlants] = useState<Plant[]>([]);
  const [photos] = useState<CameraPhoto[]>(DEMO_PHOTOS);
  const [activePlant, setActivePlant] = useState<Plant | null>(null);

  // Уведомления с сервера (вместо DEMO_NOTIFICATIONS)
  const loggedIn = AUTH_SCREENS.includes(screen);
  const {
    items: notifications,
    read: handleNotificationRead,
    readAll: handleNotificationsReadAll,
  } = useNotifications(loggedIn);

  // После входа перепривязываем существующую push-подписку к этому аккаунту
  useEffect(() => {
    if (loggedIn) void syncPushSubscription();
  }, [loggedIn]);

  const resetUserData = () => {
    setUserName("");
    setPlants([]);
    setActivePlant(null);
  };

  // Растения грузим при каждом открытии главного экрана
  useEffect(() => {
    if (screen !== "home" || !getToken()) return;

    let cancelled = false;
    getPlants()
      .then((loaded) => {
        if (cancelled) return;
        setPlants((prev) =>
          loaded.map((p) => {
            const old = prev.find((o) => o.id === p.id);
            return old
              ? { ...p, photo: p.photo ?? old.photo, notes: old.notes }
              : p;
          }),
        );
      })
      .catch(() => {
        // сервер недоступен: оставляем то, что уже есть
      });

    return () => {
      cancelled = true;
    };
  }, [screen]);

  // Сессия: проверка при запуске, при возврате в приложение и при появлении сети
  useEffect(() => {
    let lastCheck = 0;

    const check = async () => {
      if (!getToken()) return;
      lastCheck = Date.now();
      const result = await verifySession();
      if (result.status === "valid") setUserName(displayName(result.username));
      if (result.status === "unreachable") lastCheck = 0;
    };

    void check();

    const onVisible = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastCheck > REVALIDATE_AFTER_MS
      ) {
        void check();
      }
    };
    const onOnline = () => void check();

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);

    const offExpired = onSessionExpired(() => {
      setLeaving(null);
      setScreen((s) => (AUTH_SCREENS.includes(s) ? "login" : s));
      resetUserData();
    });

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      offExpired();
    };
  }, []);

  const go = (next: Screen) => {
    setLeaving(screen);
    setScreen(next);
  };

  // Данные сбрасываем после анимации ухода с экрана
  const endSession = (next: Screen) => {
    go(next);
    window.setTimeout(resetUserData, 700);
  };

  const handleLogout = async () => {
    await logout(); // отписывает push, пока токен ещё действует
    endSession("login");
  };

  const handleAccountDeleted = () => {
    endSession("welcome");
  };

  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => setLeaving(null), 600);
    return () => window.clearTimeout(t);
  }, [leaving]);

  // Фото: сразу локальное превью, параллельно грузим на сервер
  const handlePlantPhoto = async (index: number, file: File) => {
    const plant = plants[index];
    if (!plant?.id) return;

    const id = plant.id;
    const prev = plant.photo;
    const preview = URL.createObjectURL(file);

    const setPhoto = (photo?: string) =>
      setPlants((list) => list.map((p) => (p.id === id ? { ...p, photo } : p)));

    setPhoto(preview);
    try {
      const saved = await uploadPlantPhoto(id, file);
      setPhoto(saved.photo);
    } catch (err) {
      setPhoto(prev);
      console.error("Не удалось загрузить фото", err);
    } finally {
      URL.revokeObjectURL(preview);
    }
  };

  const handlePlantNotes = (index: number, notes: Note[]) => {
    setPlants((list) =>
      list.map((p, i) => (i === index ? { ...p, notes } : p)),
    );
  };

  const render = (s: Screen) => {
    switch (s) {
      case "greeting":
        return <Greeting onDone={() => go("welcome")} />;
      case "welcome":
        return <Welcome onContinue={() => go("registration")} />;
      case "registration":
        return (
          <Registration
            onContinue={(data) => {
              setUserName(displayName(data.name));
              go("plant");
            }}
            onLogin={() => go("login")}
          />
        );
      case "login":
        return (
          <Login
            onContinue={(data) => {
              setUserName(displayName(data.name));
              go("home");
            }}
            onRegister={() => go("registration")}
          />
        );
      case "plant":
        return (
          <PlantSetup
            onContinue={(plant) => {
              setActivePlant(plant);
              setPlants([plant]);
              go("analyzing");
            }}
          />
        );
      case "analyzing":
        if (!activePlant?.id) return null;
        return <Analyzing plantId={activePlant.id} onDone={() => go("ready")} />;
      case "ready":
        return <Ready onContinue={() => go("home")} />;
      case "home":
        return (
          <Main
            userName={userName || "друг"}
            plants={plants}
            onPlantPhoto={handlePlantPhoto}
            onPlantNotes={handlePlantNotes}
            photos={photos}
            notifications={notifications}
            onNotificationRead={handleNotificationRead}
            onNotificationsReadAll={handleNotificationsReadAll}
            onLogout={handleLogout}
            onAccountDeleted={handleAccountDeleted}
          />
        );
    }
  };

  return (
    <div className="app">
      {SCREENS.map((s) => {
        const isLeaving = s === leaving;
        if (s !== screen && !isLeaving) return null;
        return (
          <div
            key={s}
            className={`app__layer ${isLeaving ? "app__layer--leaving" : ""}`}
          >
            {render(s)}
          </div>
        );
      })}
    </div>
  );
}

export default App;