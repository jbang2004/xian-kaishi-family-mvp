export function normalizeStageEnergy(value: unknown, fallback = 1) {
  const safeFallback = Math.max(0, Math.min(5, Math.round(Number.isFinite(fallback) ? fallback : 1)));
  if (value === null || value === undefined || value === "") return safeFallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return safeFallback;
  return Math.max(0, Math.min(5, Math.round(numeric)));
}

export function stageEnergyLabel(value: unknown) {
  const energy = normalizeStageEnergy(value, 0);
  return energy > 0 ? `${energy}点家庭能量` : "不计家庭能量";
}

export function rewardThresholdBounds(energy: number) {
  const safeEnergy = Math.max(0, Number.isFinite(energy) ? energy : 0);
  const minimum = Math.max(10, Math.ceil((safeEnergy + 1) / 5) * 5);
  return { minimum, maximum: Math.max(100, minimum + 50) };
}

export function restoreRewardRedemption<
  TGoal extends { redeemed: boolean },
  THistory extends { id: string },
  TData extends { energy: number; rewardGoal: TGoal; rewardHistory: THistory[] },
>(current: TData, undo: { rewardId: string; energy: number; rewardGoal: TGoal; rewardHistory: THistory[] }) {
  const unchangedReset = current.energy === 0 && current.rewardGoal.redeemed && current.rewardHistory[0]?.id === undo.rewardId;
  if (!unchangedReset) return null;
  return { ...current, energy: undo.energy, rewardGoal: undo.rewardGoal, rewardHistory: undo.rewardHistory };
}
