const LIVE_SCREENS = new Set(["running", "transition", "adjust", "wrap"]);
const PRE_LIVE_SCREENS = new Set(["plan", "confirm", "dual-start"]);
const POST_LIVE_SCREENS = new Set(["night-saved", "reward-achieved", "reward-saved"]);

export function resolveHistoryTarget(current: string, target: string) {
  if (LIVE_SCREENS.has(current) && !LIVE_SCREENS.has(target)) {
    return { screen: current, blocked: true, collapseToRoot: false };
  }
  if (POST_LIVE_SCREENS.has(current) && PRE_LIVE_SCREENS.has(target)) {
    return { screen: "home", blocked: false, collapseToRoot: true };
  }
  return { screen: target, blocked: false, collapseToRoot: false };
}
