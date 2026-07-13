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

export function shouldUseHapticCue(appReducedMotion: boolean, systemReducedMotion: boolean) {
  return !appReducedMotion && !systemReducedMotion;
}

export function foregroundCueStatus(soundEnabled: boolean, motionReduced: boolean) {
  if (soundEnabled && motionReduced) return "页面内仍会显示提醒；提示音开启，触感已关闭";
  if (soundEnabled) return "页面内仍会显示提醒；提示音和轻触反馈按设备支持";
  if (motionReduced) return "页面内仍会显示提醒；提示音与触感均已关闭";
  return "页面内仍会显示提醒；提示音关闭，轻触反馈按设备支持";
}
