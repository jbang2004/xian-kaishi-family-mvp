import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("contains the complete 先开始 product shell", async () => {
  const [page, layout, app] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/StartApp.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /先开始｜家庭晚间习惯助手/);
  assert.match(page, /<StartApp \/>/);
  assert.match(app, /今晚，一起商量再开始/);
  assert.match(app, /监护人授权与儿童隐私说明/);
  assert.match(app, /删除孩子全部数据/);
  assert.match(app, /寻找正规医疗机构/);
  assert.doesNotMatch(`${page}${layout}${app}`, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("ships the mascot and persistent-state migration", async () => {
  await access(new URL("../public/assets/warm-lamp.png", import.meta.url));
  const migration = await readFile(new URL("../drizzle/0000_huge_randall.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE `family_state`/);
  assert.match(migration, /`family_id` text PRIMARY KEY/);
});
