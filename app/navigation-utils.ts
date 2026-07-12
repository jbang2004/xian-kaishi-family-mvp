const LIVE_SCREENS = new Set(["running", "transition", "adjust", "wrap"]);
const PRE_LIVE_SCREENS = new Set(["plan", "confirm", "dual-start"]);
const POST_LIVE_SCREENS = new Set(["night-saved", "reward-achieved", "reward-saved"]);
const STALE_AFTER_NIGHT = new Set(["plan", "confirm", "dual-start", "running", "transition", "adjust", "wrap"]);
const STALE_AFTER_REWARD = new Set(["reward-achieved", "reward-setup"]);

export function resolveHistoryTarget(current: string, target: string) {
  if (current === "welcome" && target !== "welcome") {
    return { screen: "welcome", blocked: true, collapseToRoot: false };
  }
  if (LIVE_SCREENS.has(current) && !LIVE_SCREENS.has(target)) {
    return { screen: current, blocked: true, collapseToRoot: false };
  }
  if ((current === "night-saved" && STALE_AFTER_NIGHT.has(target)) || (current === "reward-saved" && STALE_AFTER_REWARD.has(target))) {
    return { screen: "home", blocked: false, collapseToRoot: true };
  }
  if (POST_LIVE_SCREENS.has(current) && PRE_LIVE_SCREENS.has(target)) {
    return { screen: "home", blocked: false, collapseToRoot: true };
  }
  return { screen: target, blocked: false, collapseToRoot: false };
}
