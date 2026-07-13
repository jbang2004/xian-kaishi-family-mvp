const NIGHT_CUTOFF_HOUR = 5;
const MAX_LIVE_AGE_MS = 18 * 60 * 60 * 1000;

function validDate(value: string | Date | number) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function localKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function familyNightKey(value: string | Date | number) {
  const parsed = validDate(value);
  if (!parsed) return "";
  const date = new Date(parsed);
  if (date.getHours() < NIGHT_CUTOFF_HOUR) date.setDate(date.getDate() - 1);
  return localKey(date);
}

export function isLiveSessionFresh(startedAt: string, updatedAt: string, now: Date = new Date()) {
  const started = validDate(startedAt);
  const updated = validDate(updatedAt);
  if (!started || !updated) return false;
  const age = now.getTime() - updated.getTime();
  if (age < -5 * 60 * 1000 || age > MAX_LIVE_AGE_MS) return false;
  return familyNightKey(started) === familyNightKey(now);
}

export function liveNightLabel(startedAt: string, now: Date = new Date()) {
  const started = validDate(startedAt);
  if (!started) return "这一晚";
  return localKey(started) === localKey(now) ? "今晚" : "昨晚";
}

export function calculateNightBonus(existing: Array<{ adjustmentEnergy: number }>, adjustments: number) {
  return {
    cooperationEnergy: existing.length ? 0 : 2,
    adjustmentEnergy: adjustments > 0 && !existing.some(item => item.adjustmentEnergy > 0) ? 1 : 0,
  };
}

export function advanceStageStatuses<T extends { status: string }>(items: T[], currentIndex: number, nextIndex: number): T[] {
  if (currentIndex < 0 || nextIndex < 0 || currentIndex >= items.length || nextIndex >= items.length || currentIndex === nextIndex) return items;
  return items.map((item, index) => {
    if (index === nextIndex) return { ...item, status: "active" };
    if (index === currentIndex && item.status === "active") return { ...item, status: "done" };
    if (item.status === "active") return { ...item, status: "pending" };
    return item;
  });
}
