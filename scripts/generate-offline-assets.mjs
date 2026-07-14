import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const publicRoot = path.join(projectRoot, "public");
const assetsRoot = path.join(publicRoot, "assets");
const criticalIconNames = ["alarm", "backpack", "chart", "check", "home-heart", "moon", "move", "plant", "privacy", "quiet", "speech", "steps"];
const criticalMascotNames = ["blink", "breathe", "celebrate", "confirm", "ready", "support"];

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async entry => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(absolutePath) : [absolutePath];
  }));
  return files.flat();
}

const assets = (await collectFiles(assetsRoot))
  .map(file => `/${path.relative(publicRoot, file).split(path.sep).join("/")}`)
  .sort((left, right) => left.localeCompare(right, "en"));

const criticalAssets = [
  ...criticalIconNames.map(name => `/assets/optimized/icons/${name}.webp`),
  ...criticalMascotNames.map(name => `/assets/optimized/mascot/${name}.webp`),
].sort((left, right) => left.localeCompare(right, "en"));

const missingCriticalAsset = criticalAssets.find(asset => !assets.includes(asset));
if (missingCriticalAsset) throw new Error(`Missing critical offline asset: ${missingCriticalAsset}`);

await writeFile(
  path.join(publicRoot, "offline-assets.json"),
  `${JSON.stringify({ version: 2, criticalAssets, assets }, null, 2)}\n`,
  "utf8",
);
