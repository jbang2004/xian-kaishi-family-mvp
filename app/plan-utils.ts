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
