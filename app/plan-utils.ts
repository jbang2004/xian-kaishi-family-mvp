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

export function scheduledEndTime<T extends TimedPlanItem & { status?: string }>(items: T[], fallback: string) {
  return [...items].reverse().find(item => item.status !== "tomorrow")?.end || fallback;
}

export function countCompletedTasks<T extends { status: string; kind?: string }>(items: T[]) {
  return items.filter(item => item.status === "done" && item.kind !== "rest").length;
}

export function addMinutes(time: string, amount: number) {
  const [hours, minutes] = time.split(":").map(Number);
  const total = (hours * 60 + minutes + amount + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function clockDeltaMinutes(from: string, to: string) {
  const fromMinutes = timeToMinutes(from);
  const toMinutes = timeToMinutes(to);
  if (fromMinutes < 0 || toMinutes < 0) return 0;
  let delta = toMinutes - fromMinutes;
  if (delta > 720) delta -= 1440;
  if (delta < -720) delta += 1440;
  return delta;
}

export function clockMinutesUntil(now: string, target: string) {
  const nowMinutes = timeToMinutes(now);
  const targetMinutes = timeToMinutes(target);
  if (nowMinutes < 0 || targetMinutes < 0) return 0;
  const directDelta = targetMinutes - nowMinutes;
  return directDelta < -720 ? directDelta + 1440 : directDelta;
}

export function clockTimeFromDate(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function millisecondsUntilNextMinute(timestamp: number) {
  const safeTimestamp = Number.isFinite(timestamp) ? Math.max(0, Math.floor(timestamp)) : 0;
  return 60_000 - safeTimestamp % 60_000;
}

export function suggestInitialEveningWindow(now: Date) {
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  // A first-run suggestion should never normalize overnight homework for a
  // primary-school family. Outside the realistic after-school/evening window,
  // offer a calm default that the family can still edit.
  if (!Number.isFinite(now.getTime()) || minutesNow < 16 * 60 || minutesNow >= 21 * 60 + 30) {
    return { planStart: "18:00", planEnd: "20:30" };
  }

  const roundedStartMinutes = Math.ceil(minutesNow / 10) * 10;
  const planStart = `${String(Math.floor((roundedStartMinutes % 1440) / 60)).padStart(2, "0")}:${String(roundedStartMinutes % 60).padStart(2, "0")}`;
  return { planStart, planEnd: addMinutes(planStart, minutesNow >= 20 * 60 ? 60 : 120) };
}

export function remainingTimerMinutes(endsAt: number, now: number) {
  return endsAt > 0 ? Math.max(0, Math.ceil((endsAt - now) / 60_000)) : 0;
}

export function gentleRemainingLabel(seconds: number) {
  const safe = Math.max(0, Math.ceil(seconds));
  if (safe <= 0) return "可以看看下一步";
  if (safe < 60) return "不到 1 分钟";
  return `${Math.ceil(safe / 60)} 分钟左右`;
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

export function prepareNextRoundSchedule<T extends TimedSessionItem & { id: string }>(items: T[], completedTitles: string[], nextStart: string): T[] {
  return shiftTimedPlanToStart(prepareNextRoundPlan(items, completedTitles), nextStart);
}

export function shiftTimedItemsFrom<T extends TimedPlanItem>(items: T[], startIndex: number, amount: number): T[] {
  return items.map((item, index) => index < startIndex ? item : {
    ...item,
    start: addMinutes(item.start, amount),
    end: addMinutes(item.end, amount),
  });
}

export function alignLiveStagesToStart<T extends TimedPlanItem & { status: string }>(items: T[], startIndex: number, actualStart: string): T[] {
  const next = items[startIndex];
  if (!next || timeToMinutes(actualStart) < 0) return items;
  const delta = clockDeltaMinutes(next.start, actualStart);
  if (!delta) return items;
  return items.map((item, index) => index < startIndex || item.status === "tomorrow" ? item : {
    ...item,
    start: addMinutes(item.start, delta),
    end: addMinutes(item.end, delta),
  });
}

export function shiftFollowingForEndChange<T extends TimedPlanItem>(items: T[], index: number, newEnd: string): T[] {
  const current = items[index];
  if (!current) return items;
  const delta = clockDeltaMinutes(current.end, newEnd);
  return items.map((item, itemIndex) => {
    if (itemIndex < index) return item;
    if (itemIndex === index) return { ...item, end: newEnd };
    return { ...item, start: addMinutes(item.start, delta), end: addMinutes(item.end, delta) };
  });
}

export function shiftTimedPlanToStart<T extends TimedPlanItem>(items: T[], newStart: string): T[] {
  if (!items.length) return [];
  const offset = timeToMinutes(newStart) - timeToMinutes(items[0].start);
  return shiftTimedItemsFrom(items, 0, offset);
}

export function findPlanInsertionSlot<T extends TimedPlanItem>(planStart: string, planEnd: string, items: T[], preferredMinutes = 20, minimumMinutes = 5) {
  const availableMinutes = durationMinutes(planStart, planEnd);
  const planStartMinutes = timeToMinutes(planStart);
  if (availableMinutes <= 0 || planStartMinutes < 0) return { status: "invalid" as const };

  const occupied = items.map((item, index) => {
    const itemDuration = durationMinutes(item.start, item.end);
    const itemStartMinutes = timeToMinutes(item.start);
    const startOffset = itemStartMinutes < 0 ? -1 : (itemStartMinutes - planStartMinutes + 1440) % 1440;
    return { index, startOffset, endOffset: startOffset + itemDuration, itemDuration };
  }).sort((a, b) => a.startOffset - b.startOffset);

  const orderChanged = occupied.some((item, chronologicalIndex) => item.index !== chronologicalIndex);
  if (orderChanged || occupied.some(item => item.itemDuration <= 0 || item.startOffset < 0 || item.startOffset >= availableMinutes || item.endOffset > availableMinutes)) {
    return { status: "invalid" as const };
  }

  const gaps: Array<{ startOffset: number; minutes: number }> = [];
  let cursor = 0;
  for (const item of occupied) {
    if (item.startOffset < cursor) return { status: "invalid" as const };
    if (item.startOffset > cursor) gaps.push({ startOffset: cursor, minutes: item.startOffset - cursor });
    cursor = item.endOffset;
  }
  if (cursor < availableMinutes) gaps.push({ startOffset: cursor, minutes: availableMinutes - cursor });

  const preferred = gaps.find(gap => gap.minutes >= preferredMinutes);
  const fallback = preferred ?? gaps.filter(gap => gap.minutes >= minimumMinutes).sort((a, b) => b.minutes - a.minutes || a.startOffset - b.startOffset)[0];
  if (!fallback) return { status: "full" as const };

  const minutes = Math.min(preferredMinutes, fallback.minutes);
  const start = addMinutes(planStart, fallback.startOffset);
  const nextOccupied = occupied.find(item => item.startOffset >= fallback.startOffset);
  return {
    status: "available" as const,
    start,
    end: addMinutes(start, minutes),
    minutes,
    insertIndex: nextOccupied?.index ?? items.length,
    usedShortGap: minutes < preferredMinutes,
  };
}

function retimeReorderedItems<T extends TimedPlanItem>(items: T[], reordered: T[], planStart: string) {
  if (timeToMinutes(planStart) < 0) return { items, moved: false };
  const planStartMinutes = timeToMinutes(planStart);
  const timing = items.map(item => {
    const minutes = durationMinutes(item.start, item.end);
    const startMinutes = timeToMinutes(item.start);
    const startOffset = startMinutes < 0 ? -1 : (startMinutes - planStartMinutes + 1440) % 1440;
    return { minutes, startOffset, endOffset: startOffset + minutes };
  });
  const invalid = timing.some((item, index) => item.minutes <= 0 || item.startOffset < 0 || (index > 0 && item.startOffset < timing[index - 1].endOffset));
  if (invalid) return { items, moved: false };

  const leadingGap = timing[0]?.startOffset ?? 0;
  const positionGaps = timing.slice(0, -1).map((item, index) => Math.max(0, timing[index + 1].startOffset - item.endOffset));
  let cursor = addMinutes(planStart, leadingGap);
  const nextItems = reordered.map((item, index) => {
    const minutes = durationMinutes(item.start, item.end);
    const start = cursor;
    const end = addMinutes(start, minutes);
    cursor = addMinutes(end, positionGaps[index] ?? 0);
    return { ...item, start, end };
  });
  return { items: nextItems, moved: true };
}

export function moveTimedItemPreservingGaps<T extends TimedPlanItem>(items: T[], fromIndex: number, toIndex: number, planStart: string) {
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length || fromIndex === toIndex) return { items, moved: false };
  const reordered = [...items];
  const [movedItem] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, movedItem);
  return retimeReorderedItems(items, reordered, planStart);
}

export function swapTimedItemsPreservingGaps<T extends TimedPlanItem>(items: T[], firstIndex: number, secondIndex: number, planStart: string) {
  if (firstIndex < 0 || secondIndex < 0 || firstIndex >= items.length || secondIndex >= items.length || firstIndex === secondIndex) return { items, moved: false };
  const reordered = [...items];
  [reordered[firstIndex], reordered[secondIndex]] = [reordered[secondIndex], reordered[firstIndex]];
  return retimeReorderedItems(items, reordered, planStart);
}

export function rebaseFollowUpPlan<T extends TimedPlanItem>(planStart: string, planEnd: string, items: T[], nowTime: string) {
  const availableMinutes = durationMinutes(planStart, planEnd);
  if (availableMinutes <= 0 || timeToMinutes(nowTime) < 0) {
    return { planStart, planEnd, items, keptPlanEnd: true };
  }

  const elapsedMinutes = (timeToMinutes(nowTime) - timeToMinutes(planStart) + 1440) % 1440;
  const stillInsideWindow = elapsedMinutes < availableMinutes;
  const nextItems = shiftTimedPlanToStart(items, nowTime);
  const scheduledSpan = nextItems.length ? durationMinutes(nowTime, nextItems.at(-1)!.end) : 0;
  const remainingWindow = stillInsideWindow ? availableMinutes - elapsedMinutes : 0;
  const keptPlanEnd = stillInsideWindow && scheduledSpan <= remainingWindow;

  return {
    planStart: nowTime,
    planEnd: keptPlanEnd ? planEnd : addMinutes(nowTime, stillInsideWindow ? scheduledSpan : Math.max(scheduledSpan, availableMinutes)),
    items: nextItems,
    keptPlanEnd,
  };
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
