export type TimedPlanItem = {
  title: string;
  start: string;
  end: string;
};

export function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : -1;
}

export function durationMinutes(start: string, end: string) {
  return Math.max(0, timeToMinutes(end) - timeToMinutes(start));
}

export function addMinutes(time: string, amount: number) {
  const [hours, minutes] = time.split(":").map(Number);
  const total = (hours * 60 + minutes + amount + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function clockTimeFromDate(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function remainingTimerMinutes(endsAt: number, now: number) {
  return endsAt > 0 ? Math.max(0, Math.ceil((endsAt - now) / 60_000)) : 0;
}

export function canInsertRestBreak(activeKind: string) {
  return activeKind !== "rest";
}

export function prepareNextRoundPlan<T extends TimedSessionItem & { id: string }>(items: T[], completedTitles: string[] = []): T[] {
  const completedCounts = completedTitles.reduce((counts, title) => counts.set(title, (counts.get(title) ?? 0) + 1), new Map<string, number>());
  return items.flatMap(item => {
    const recordedCount = completedCounts.get(item.title) ?? 0;
    if (item.status === "done") {
      if (recordedCount > 0) completedCounts.set(item.title, recordedCount - 1);
      return [];
    }
    if (item.id.startsWith("rest-")) return [];
    if (recordedCount > 0) { completedCounts.set(item.title, recordedCount - 1); return []; }
    return [{ ...item, status: "pending" }];
  });
}

export function shiftTimedItemsFrom<T extends TimedPlanItem>(items: T[], startIndex: number, amount: number): T[] {
  return items.map((item, index) => index < startIndex ? item : {
    ...item,
    start: addMinutes(item.start, amount),
    end: addMinutes(item.end, amount),
  });
}

export function shiftTimedPlanToStart<T extends TimedPlanItem>(items: T[], newStart: string): T[] {
  if (!items.length) return [];
  const offset = timeToMinutes(newStart) - timeToMinutes(items[0].start);
  return shiftTimedItemsFrom(items, 0, offset);
}

export function reflowTimedItemsFrom<T extends TimedPlanItem>(items: T[], startIndex: number, startTime: string): T[] {
  let cursor = startTime;
  return items.map((item, index) => {
    if (index < startIndex) return item;
    const minutes = Math.max(1, durationMinutes(item.start, item.end));
    const next = { ...item, start: cursor, end: addMinutes(cursor, minutes) };
    cursor = next.end;
    return next;
  });
}

export type TimedSessionItem = TimedPlanItem & { status: string };

export function insertRestBreak<T extends TimedSessionItem>(
  items: T[],
  activeIndex: number,
  restItem: T,
  nowTime: string,
  remainingMinutes: number,
  restMinutes = 10,
  dueResumeMinutes = 10,
  planEndTime?: string,
) {
  const current = items[activeIndex];
  if (!current) return { items, restIndex: -1, planEnd: nowTime, resumedMinutes: 0 };

  const currentIsDone = current.status === "done";
  const resumedMinutes = currentIsDone ? 0 : Math.max(1, Math.ceil(remainingMinutes) || dueResumeMinutes);
  const restIndex = currentIsDone ? activeIndex + 1 : activeIndex;
  const restEnd = addMinutes(nowTime, restMinutes);
  const rest = { ...restItem, start: nowTime, end: restEnd, status: "active" };
  const withRest = [...items.slice(0, restIndex), rest, ...items.slice(restIndex)];
  const lastTonightItem = [...items].reverse().find(item => item.status !== "tomorrow");
  const trailingBuffer = planEndTime && lastTonightItem ? durationMinutes(lastTonightItem.end, planEndTime) : 0;
  let cursor = restEnd;

  const nextItems = withRest.map((item, index) => {
    if (index <= restIndex || item.status === "tomorrow") return item;
    const isResumedCurrent = !currentIsDone && index === restIndex + 1;
    const minutes = isResumedCurrent ? resumedMinutes : Math.max(1, durationMinutes(item.start, item.end));
    const previousOriginal = withRest[index - 1];
    const preservedGap = isResumedCurrent || previousOriginal.status === "tomorrow" ? 0 : Math.max(0, timeToMinutes(item.start) - timeToMinutes(previousOriginal.end));
    const start = addMinutes(cursor, preservedGap);
    const next = {
      ...item,
      start,
      end: addMinutes(start, minutes),
      status: isResumedCurrent ? "pending" : item.status,
    };
    cursor = next.end;
    return next;
  });

  return { items: nextItems, restIndex, planEnd: addMinutes(cursor, trailingBuffer), resumedMinutes };
}

export function analyzePlan(planStart: string, planEnd: string, items: TimedPlanItem[]) {
  const availableMinutes = durationMinutes(planStart, planEnd);
  const scheduledMinutes = items.reduce((sum, item) => sum + durationMinutes(item.start, item.end), 0);
  const issues = items.flatMap((item, index) => {
    const itemIssues: string[] = [];
    const start = timeToMinutes(item.start);
    const end = timeToMinutes(item.end);
    const label = item.title.trim() || `第${index + 1}项`;
    if (!item.title.trim()) itemIssues.push(`第${index + 1}项还没有名称`);
    if (end <= start) itemIssues.push(`${label}的结束时间需要晚于开始时间`);
    if (availableMinutes > 0 && (start < timeToMinutes(planStart) || end > timeToMinutes(planEnd))) itemIssues.push(`${label}超出今晚可用时间`);
    if (index > 0 && start < timeToMinutes(items[index - 1].end)) itemIssues.push(`${label}与上一项时间重叠`);
    return itemIssues;
  });
  if (availableMinutes <= 0) issues.unshift("今晚结束时间需要晚于开始时间");
  return {
    availableMinutes,
    scheduledMinutes,
    balanceMinutes: Math.max(0, availableMinutes - scheduledMinutes),
    issues,
    hasErrors: issues.length > 0,
  };
}
