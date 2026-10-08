export function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function startOfDay(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** «Сегодня», «Вчера» или «2 октября» */
export function dayLabel(ts: number) {
  const diff = Math.round(
    (startOfDay(Date.now()) - startOfDay(ts)) / 86_400_000,
  );
  if (diff === 0) return "Сегодня";
  if (diff === 1) return "Вчера";
  return new Date(ts).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
  });
}

/** «Сегодня, 14:32» */
export function formatStamp(ts: number) {
  return `${dayLabel(ts)}, ${formatTime(ts)}`;
}