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
