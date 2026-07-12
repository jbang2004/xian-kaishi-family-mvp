import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { addMinutes, analyzePlan, durationMinutes, reflowTimedItemsFrom, shiftTimedItemsFrom } from "../app/plan-utils.ts";

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
  assert.match(app, /哪些数据保存在哪里/);
  assert.match(app, /随机家庭 ID 不是正式账号鉴权/);
  assert.match(app, /family: data, planDraft, activeSession/);
  assert.match(app, /energy: 0,/);
  assert.match(app, /setPlanHydrated\(false\).*setFamilyId\(""\)/);
  assert.match(app, /aria-current=\{screen === id \? "page"/);
  assert.match(app, /aria-pressed=\{data\.planningMode === mode\}/);
  assert.match(app, /resumeTonightFromWrap/);
  assert.match(app, /还想继续今晚/);
  assert.match(app, /go\(profileReturn === "settings" \? "settings" : "home"\)/);
  assert.match(app, /const openAdjust = \(\) => \{ setAdjustChoice\("extend"\)/);
  assert.match(app, /undoRemoveStage/);
  assert.match(app, /setDeletedStage\(null\), 8000/);
  assert.match(app, /data-screen-heading/);
  assert.match(app, /预计到时间了，可以完成、继续或调整/);
  assert.match(app, /const startRestNow/);
  assert.match(app, /现在休息10分钟，后续时间已顺延/);
  assert.match(app, /legacyRestIcons/);
  assert.match(app, /promptReflection: normalizePromptReflection/);
  assert.match(app, /可选，不影响能量，也不评价孩子/);
  assert.match(app, /本周复盘 · 不评价孩子/);
  assert.match(app, /少催反馈/);
  assert.match(app, /normalizeTransitionReason/);
  assert.match(app, /已经告一段落/);
  assert.match(app, /进入今晚收尾/);
  assert.match(app, /restartFromNow \? Date\.now\(\) \+ 10 \* 60_000/);
  assert.match(app, /osc\.addEventListener\("ended"/);
  assert.doesNotMatch(app, /\{data\.childAlias\}：完成事项/);
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

  const shifted = shiftTimedItemsFrom([
    { title: "数学", start: "18:10", end: "18:40" },
    { title: "阅读", start: "18:40", end: "19:05" },
  ], 1, 10);
  assert.deepEqual(shifted.map(item => [item.start, item.end]), [["18:10", "18:40"], ["18:50", "19:15"]]);

  const reordered = reflowTimedItemsFrom([
    { title: "阅读", start: "18:40", end: "19:05" },
    { title: "数学", start: "18:10", end: "18:40" },
  ], 0, "18:10");
  assert.deepEqual(reordered.map(item => [item.start, item.end]), [["18:10", "18:35"], ["18:35", "19:05"]]);
});
