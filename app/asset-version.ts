export const ASSET_VERSION = "2026-07-15-1";

export function versionedAsset(path: string) {
  return `${path}?v=${ASSET_VERSION}`;
}
