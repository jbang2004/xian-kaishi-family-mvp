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
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);
  if (startMinutes < 0 || endMinutes < 0 || startMinutes === endMinutes) return 0;
  return endMinutes > startMinutes ? endMinutes - startMinutes : endMinutes + 1440 - startMinutes;
}

export function spansMidnight(start: string, end: string) {
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);
  return startMinutes >= 0 && endMinutes >= 0 && endMinutes < startMinutes;
}

export function formatPlanClock(time: string, planStart: string, planEnd: string) {
  return spansMidnight(planStart, planEnd) && timeToMinutes(time) < timeToMinutes(planStart) ? `次日 ${time}` : time;
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
    const firstAfterRest = index === restIndex + 1;
    const preservedGap = firstAfterRest || previousOriginal.status === "tomorrow" || item.start === previousOriginal.end ? 0 : durationMinutes(previousOriginal.end, item.start);
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
  const planStartMinutes = timeToMinutes(planStart);
  let previousEndOffset = -1;
  const itemErrors = items.map((item, index) => {
    const messages: string[] = [];
    const startMinutes = timeToMinutes(item.start);
    const startOffset = startMinutes < 0 || planStartMinutes < 0 ? -1 : (startMinutes - planStartMinutes + 1440) % 1440;
    const itemDuration = durationMinutes(item.start, item.end);
    const endOffset = startOffset < 0 ? -1 : startOffset + itemDuration;
    const label = item.title.trim() || `第${index + 1}项`;
    const title = !item.title.trim();
    if (title) messages.push(`第${index + 1}项还没有名称`);
    if (itemDuration <= 0) messages.push(`${label}的开始和结束时间不能相同`);
    if (availableMinutes > 0 && (startOffset < 0 || startOffset >= availableMinutes || endOffset > availableMinutes)) messages.push(`${label}超出今晚可用时间`);
    if (index > 0 && startOffset >= 0 && startOffset < previousEndOffset) messages.push(`${label}与上一项时间重叠`);
    if (endOffset >= 0) previousEndOffset = endOffset;
    return { messages, title, time: messages.some(message => !message.includes("还没有名称")) };
  });
  const issues = itemErrors.flatMap(item => item.messages);
  if (availableMinutes <= 0) issues.unshift("今晚开始和结束时间不能相同");
  return {
    availableMinutes,
    scheduledMinutes,
    balanceMinutes: Math.max(0, availableMinutes - scheduledMinutes),
    itemErrors,
    issues,
    hasErrors: issues.length > 0,
  };
}
