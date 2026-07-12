import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { addMinutes, analyzePlan, durationMinutes, reflowTimedItemsFrom, shiftTimedItemsFrom } from "../app/plan-utils.ts";
import { shouldUseBackgroundReminder } from "../app/reminder-utils.ts";
import { compareSyncSnapshots, mergeUniqueById } from "../app/sync-utils.ts";

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
  assert.match(app, /const liveResumeView/);
  assert.match(app, /今晚计划正在调整 · 进度已保存在本机/);
  assert.match(app, /这一段已完成 · 进度已保存在本机/);
  assert.match(app, /阶段预计到时 · 只提醒一次/);
  assert.match(app, /data-state=\{liveResumeView\.state\}/);
  assert.match(app, /const nextPendingStage/);
  assert.match(app, /className="timeline-disclosure"/);
  assert.match(app, /今晚进度/);
  assert.match(app, /className="running-action-dock"/);
  assert.match(app, /页面在后台时提醒/);
  assert.match(app, /xian-kaishi-background-reminder-v1/);
  assert.match(app, /关闭浏览器后不承诺提醒送达/);
  assert.match(app, /xian-kaishi-family-revision-v1/);
  assert.match(app, /旧状态不会静默覆盖更新的本机记录/);
  assert.match(app, /正在合并另一处更新/);
  assert.match(app, /正在找回这个家庭的今晚/);
  assert.match(app, /if \(validLocal\) setAppReady\(true\)/);
  assert.match(app, /catch \{ localStorage\.removeItem\(STORAGE_KEY\)/);
  assert.match(app, /finally\(\(\) => setAppReady\(true\)\)/);
  assert.match(app, /const \[rewardDraft, setRewardDraft\]/);
  assert.match(app, /只有点保存后才会替换现在的期待/);
  assert.match(app, /确认已兑现，能量归零/);
  assert.match(app, /未完成或暂停不会倒扣、过期/);
  assert.match(app, /icon: data\.rewardGoal\.icon/);
  assert.doesNotMatch(app, /能量不会清零、倒扣或过期/);
  assert.match(app, /Notification\.requestPermission/);
  assert.match(app, /new Notification\("这一段预计到时间了"/);
  assert.doesNotMatch(app, /\{data\.childAlias\}：完成事项/);
  assert.doesNotMatch(app, /className="phone-shell" aria-live/);
  assert.doesNotMatch(`${page}${layout}${app}`, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("ships the mascot and persistent-state migration", async () => {
  await access(new URL("../public/assets/warm-lamp.png", import.meta.url));
  const [initialMigration, revisionMigration, route] = await Promise.all([
    readFile(new URL("../drizzle/0000_huge_randall.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0001_slimy_moonstone.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/state/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(initialMigration, /CREATE TABLE `family_state`/);
  assert.match(initialMigration, /`family_id` text PRIMARY KEY/);
  assert.match(revisionMigration, /ADD `revision` integer DEFAULT 0 NOT NULL/);
  assert.match(route, /excluded\.revision > family_state\.revision/);
  assert.match(route, /status: 409/);
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

test("only uses a system reminder after guardian permission while hidden", () => {
  assert.equal(shouldUseBackgroundReminder(true, "hidden", "granted"), true);
  assert.equal(shouldUseBackgroundReminder(true, "visible", "granted"), false);
  assert.equal(shouldUseBackgroundReminder(false, "hidden", "granted"), false);
  assert.equal(shouldUseBackgroundReminder(true, "hidden", "denied"), false);
});

test("keeps the newest family snapshot and merges durable history", () => {
  assert.equal(compareSyncSnapshots(
    { revision: 4, updatedAt: "2026-07-13T10:00:00.000Z" },
    { revision: 3, updatedAt: "2026-07-13T11:00:00.000Z" },
  ), "local");
  assert.equal(compareSyncSnapshots(
    { revision: 4, updatedAt: "2026-07-13T10:00:00.000Z" },
    { revision: 4, updatedAt: "2026-07-13T11:00:00.000Z" },
  ), "remote");
  assert.deepEqual(mergeUniqueById(
    [{ id: "local", value: 1 }, { id: "shared", value: 2 }],
    [{ id: "remote", value: 3 }, { id: "shared", value: 9 }],
  ), [{ id: "local", value: 1 }, { id: "shared", value: 2 }, { id: "remote", value: 3 }]);
});
