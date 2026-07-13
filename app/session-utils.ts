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

export function settlementFooterCopy(priorSettlementCount: number, hasDeferredStages: boolean) {
  if (priorSettlementCount > 0) {
    return hasDeferredStages
      ? "未完成事项留到明天；本夜合作与调整能量不重复记录"
      : "保存后继续写入同一晚；合作与调整能量不重复记录";
  }
  return hasDeferredStages
    ? "未完成事项留到明天；不会扣掉已经获得的能量"
    : "保存后写入家庭日历；不会公开，也不会用于比较";
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

type RemovableSession = {
  id: string;
  date: string;
  nightKey: string;
  adjustments: number;
  cooperationEnergy: number;
  adjustmentEnergy: number;
  energyEarned: number;
};

export function removeSessionAndReconcileEnergy<T extends RemovableSession>(sessions: T[], recordId: string, currentEnergy: number, rewardDates: string[]) {
  const removed = sessions.find(item => item.id === recordId);
  if (!removed) return { sessions, energy: currentEnergy, removedEnergy: 0, currentCycleAdjusted: false };

  const next = sessions.filter(item => item.id !== recordId).map(item => ({ ...item }));
  const sameNight = next.filter(item => item.nightKey === removed.nightKey);
  let transferredEnergy = 0;

  if (removed.cooperationEnergy > 0 && sameNight.length && !sameNight.some(item => item.cooperationEnergy > 0)) {
    sameNight[0].cooperationEnergy += removed.cooperationEnergy;
    sameNight[0].energyEarned += removed.cooperationEnergy;
    transferredEnergy += removed.cooperationEnergy;
  }

  const adjustmentTarget = sameNight.find(item => item.adjustments > 0);
  if (removed.adjustmentEnergy > 0 && adjustmentTarget && !sameNight.some(item => item.adjustmentEnergy > 0)) {
    adjustmentTarget.adjustmentEnergy += removed.adjustmentEnergy;
    adjustmentTarget.energyEarned += removed.adjustmentEnergy;
    transferredEnergy += removed.adjustmentEnergy;
  }

  const recordTime = Date.parse(removed.date);
  const hasLaterRewardReset = !Number.isFinite(recordTime) || rewardDates.some(value => {
    const rewardTime = Date.parse(value);
    return Number.isFinite(rewardTime) && rewardTime > recordTime;
  });
  const removedEnergy = Math.max(0, removed.energyEarned - transferredEnergy);
  return {
    sessions: next,
    energy: hasLaterRewardReset ? currentEnergy : Math.max(0, currentEnergy - removedEnergy),
    removedEnergy,
    currentCycleAdjusted: !hasLaterRewardReset,
  };
}

export function keepNewestRecords<T>(items: T[], getDate: (item: T) => string, limit: number) {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  return items.map((item, index) => ({ item, index, time: Date.parse(getDate(item)) }))
    .sort((left, right) => {
      const leftValid = Number.isFinite(left.time); const rightValid = Number.isFinite(right.time);
      if (leftValid && rightValid && left.time !== right.time) return right.time - left.time;
      if (leftValid !== rightValid) return leftValid ? -1 : 1;
      return left.index - right.index;
    })
    .slice(0, Math.floor(limit))
    .map(entry => entry.item);
}
