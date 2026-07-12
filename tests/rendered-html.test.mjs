import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { addMinutes, analyzePlan, durationMinutes } from "../app/plan-utils.ts";

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
  assert.match(app, /xian-kaishi-plan-draft-v1/);
  assert.match(app, /xian-kaishi-live-session-v1/);
  assert.match(app, /休息也算照顾计划的一部分/);
  assert.match(app, /今晚草稿 · 仅保存在这台设备/);
  assert.match(app, /今晚等待温和收尾/);
  assert.match(app, /愿意一起停下来调整/);
  assert.doesNotMatch(app, /className="phone-shell" aria-live/);
  assert.doesNotMatch(`${page}${layout}${app}`, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("ships the mascot and persistent-state migration", async () => {
  await access(new URL("../public/assets/warm-lamp.png", import.meta.url));
  const migration = await readFile(new URL("../drizzle/0000_huge_randall.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE `family_state`/);
  assert.match(migration, /`family_id` text PRIMARY KEY/);
});

test("validates the family plan before dual confirmation", () => {
  const valid = analyzePlan("18:10", "20:30", [
    { title: "数学练习", start: "18:10", end: "18:40" },
    { title: "活动一下", start: "18:40", end: "18:50" },
    { title: "阅读", start: "18:50", end: "19:15" },
  ]);
  assert.equal(valid.hasErrors, false);
  assert.equal(valid.availableMinutes, 140);
  assert.equal(valid.scheduledMinutes, 65);
  assert.equal(valid.balanceMinutes, 75);

  const invalid = analyzePlan("18:10", "19:00", [
    { title: "", start: "18:10", end: "18:30" },
    { title: "阅读", start: "18:20", end: "19:15" },
  ]);
  assert.equal(invalid.hasErrors, true);
  assert.ok(invalid.issues.some(issue => issue.includes("还没有名称")));
  assert.ok(invalid.issues.some(issue => issue.includes("时间重叠")));
  assert.ok(invalid.issues.some(issue => issue.includes("超出今晚可用时间")));
});

test("calculates stage durations and automatic time shifts", () => {
  assert.equal(durationMinutes("18:10", "18:40"), 30);
  assert.equal(addMinutes("18:40", 25), "19:05");
});
