import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const publicRoot = path.join(projectRoot, "public");
const assetsRoot = path.join(publicRoot, "assets");

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

await writeFile(
  path.join(publicRoot, "offline-assets.json"),
  `${JSON.stringify({ version: 1, assets }, null, 2)}\n`,
  "utf8",
);
