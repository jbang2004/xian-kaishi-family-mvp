export function rewardThresholdBounds(energy: number) {
  const safeEnergy = Math.max(0, Number.isFinite(energy) ? energy : 0);
  const minimum = Math.max(10, Math.ceil((safeEnergy + 1) / 5) * 5);
  return { minimum, maximum: Math.max(100, minimum + 50) };
}
