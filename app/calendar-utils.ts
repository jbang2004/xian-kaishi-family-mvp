function calendarDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function shiftCalendarSelection(cursor: Date, selectedDay: string, delta: number) {
  const selected = new Date(`${selectedDay}T12:00:00`);
  const selectionMatchesCursor = Number.isFinite(selected.getTime())
    && selected.getFullYear() === cursor.getFullYear()
    && selected.getMonth() === cursor.getMonth();
  const preferredDay = selectionMatchesCursor ? selected.getDate() : 1;
  const nextCursor = new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1);
  const lastDay = new Date(nextCursor.getFullYear(), nextCursor.getMonth() + 1, 0).getDate();
  const nextSelected = new Date(nextCursor.getFullYear(), nextCursor.getMonth(), Math.min(preferredDay, lastDay));
  return { cursor: nextCursor, selectedDay: calendarDateKey(nextSelected) };
}
