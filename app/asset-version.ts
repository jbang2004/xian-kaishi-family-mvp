export const ASSET_VERSION = "2026-07-13-2";

export function versionedAsset(path: string) {
  return `${path}?v=${ASSET_VERSION}`;
}
