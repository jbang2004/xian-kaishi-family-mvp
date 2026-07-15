import { rm } from "node:fs/promises";

// A local Wrangler run against dist/server writes Miniflare databases beside
// the production bundle. They are disposable QA state and must never enter a
// Sites archive or Worker upload.
await Promise.all([
  rm(new URL("../dist/server/.wrangler/", import.meta.url), { recursive: true, force: true }),
  rm(new URL("../dist/client/.wrangler/", import.meta.url), { recursive: true, force: true }),
]);
