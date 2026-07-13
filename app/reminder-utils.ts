export type ReminderPermission = "default" | "granted" | "denied" | "unsupported";

export function shouldUseBackgroundReminder(
  enabled: boolean,
  visibility: DocumentVisibilityState,
  permission: ReminderPermission,
) {
  return enabled && visibility === "hidden" && permission === "granted";
}

export function shouldUseForegroundCue(visibility: DocumentVisibilityState) {
  return visibility === "visible";
}
