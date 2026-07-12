export type SyncSnapshot = { revision: number; updatedAt: string };

function timestamp(value: string) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function compareSyncSnapshots(local: SyncSnapshot, remote: SyncSnapshot) {
  if (local.revision !== remote.revision) return local.revision > remote.revision ? "local" : "remote";
  const localTime = timestamp(local.updatedAt);
  const remoteTime = timestamp(remote.updatedAt);
  if (localTime === remoteTime) return "equal";
  return localTime > remoteTime ? "local" : "remote";
}

export function mergeUniqueById<T extends { id: string }>(preferred: T[], other: T[], limit = 60) {
  const seen = new Set<string>();
  return [...preferred, ...other].filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).slice(0, limit);
}
