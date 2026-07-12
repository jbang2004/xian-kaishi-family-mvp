import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import test from "node:test";
import { addMinutes, analyzePlan, clockTimeFromDate, durationMinutes, reflowTimedItemsFrom, shiftTimedItemsFrom, shiftTimedPlanToStart } from "../app/plan-utils.ts";
import { shouldUseBackgroundReminder } from "../app/reminder-utils.ts";
import { rewardThresholdBounds } from "../app/reward-utils.ts";
import { suggestWeeklyFocus } from "../app/review-utils.ts";
import { calculateNightBonus, familyNightKey, isLiveSessionFresh, liveNightLabel } from "../app/session-utils.ts";
import { compareSyncSnapshots, mergeUniqueById } from "../app/sync-utils.ts";
import manifest from "../app/manifest.ts";

test("contains the complete 先开始 product shell", async () => {
  const [page, layout, app, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/StartApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /先开始｜家庭晚间习惯助手/);
  assert.match(layout, /manifest: "\/manifest\.webmanifest"/);
  assert.match(layout, /appleWebApp: \{ capable: true/);
  assert.match(layout, /themeColor: "#fff8ec"/);
  assert.match(page, /<StartApp \/>/);
  assert.match(app, /今晚少催一次/);
  assert.match(app, /孩子只短暂看屏幕 · 大人掌控手机/);
  assert.match(app, /每阶段只提醒一次/);
  assert.match(app, /监护人授权与儿童隐私说明/);
  assert.match(app, /删除孩子全部数据/);
  assert.match(app, /寻找正规医疗机构/);
  assert.match(app, /xian-kaishi-plan-draft-v1/);
  assert.match(app, /xian-kaishi-live-session-v1/);
  assert.match(app, /休息也算照顾计划的一部分/);
  assert.match(app, /今晚草稿 · 仅保存在这台设备/);
  assert.match(app, /activeNightLabel\}等待温和收尾/);
  assert.match(app, /愿意一起停下来/);
  assert.match(app, /哪些数据保存在哪里/);
  assert.match(app, /随机家庭 ID 不是正式账号鉴权/);
  assert.match(app, /family: data, planDraft, activeSession/);
  assert.match(app, /energy: 0,/);
  assert.match(app, /setPlanHydrated\(false\).*setFamilyId\(""\)/);
  assert.match(app, /aria-current=\{screen === id \? "page"/);
  assert.match(app, /aria-pressed=\{data\.planningMode === mode\}/);
  assert.match(app, /resumeTonightFromWrap/);
  assert.match(app, /还想继续今晚/);
  assert.match(app, /go\(profileReturn === "settings" \? "settings" : "plan"\)/);
  assert.match(app, /保存并安排今晚/);
  assert.match(app, /className="profile-preferences"/);
  assert.match(app, /const openAdjust = \(\) => \{ setAdjustChoice\("extend"\)/);
  assert.match(app, /undoRemoveStage/);
  assert.match(app, /setDeletedStage\(null\), 8000/);
  assert.match(app, /data-screen-heading/);
  assert.match(app, /预计到时间了，可以完成、继续或调整/);
  assert.match(app, /const startRestNow/);
  assert.match(app, /到时间只是提醒，不代表必须完成/);
  assert.match(app, /再继续 10 分钟/);
  assert.match(app, /先休息 10 分钟/);
  assert.match(app, /setTransitionReason\("completed"\)/);
  assert.match(app, /className="transition-result"/);
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
  assert.match(app, /activeNightLabel\}计划正在调整 · 进度已保存在本机/);
  assert.match(app, /这一段已完成 · 进度已保存在本机/);
  assert.match(app, /阶段预计到时 · 只提醒一次/);
  assert.match(app, /data-state=\{liveResumeView\.state\}/);
  assert.match(app, /const nextPendingStage/);
  assert.match(app, /className="timeline-disclosure"/);
  assert.match(app, /今晚进度/);
  assert.match(app, /running-action-dock/);
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
  assert.match(app, /一起定下想共度的家庭时光/);
  assert.match(app, /先选家庭时光，再共同商量积累节奏/);
  assert.match(app, /aria-label="家庭期待目标能量"/);
  assert.match(app, /达到门槛不会自动清零/);
  assert.match(app, /家庭活动不需要与孩子的表现一一交换/);
  assert.match(app, /goalRedeemed \? ""/);
  assert.match(styles, /\.reward-idea-grid button\.selected/);
  assert.match(app, /确认已兑现并从0开始/);
  assert.match(app, /达到门槛，不等于已经兑现/);
  assert.match(app, /当前 \{data\.energy\} 点家庭能量将全部归零/);
  assert.match(app, /energyBeforeReset: data\.energy/);
  assert.match(app, /!next\.rewardGoal\.acknowledged/);
  assert.match(app, /先保留能量，稍后兑现/);
  assert.match(app, /已经安全记入家庭日历|已安全记入家庭日历/);
  assert.match(styles, /\.reward-saved-screen/);
  assert.match(app, /这一晚分\$\{selectedSessionSummary\.settlements\}次留下记录/);
  assert.match(app, /先看整体，不用逐条比较每一次/);
  assert.match(app, /aria-controls="day-session-details"/);
  assert.match(styles, /\.daily-summary-stats/);
  assert.match(app, /最迟到次日清晨5点自动失效/);
  assert.match(app, /nightKey: \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\//);
  assert.match(app, /今晚的合作已经留下来了/);
  assert.match(app, /再次安排不会重复获得“共同收尾”能量/);
  assert.match(app, /item\.nightKey===key/);
  assert.doesNotMatch(app, /const cooperationEnergy = 2/);
  assert.match(styles, /\.settled-home-card/);
  assert.match(app, /规则建议 · 不评价孩子/);
  assert.match(app, /只使用本周收尾次数、主动调整和大人的催促感记录/);
  assert.match(app, /这周只试这一件 · 给大人的提醒/);
  assert.match(app, /weekKey: weekStartKey/);
  assert.match(styles, /\.one-change-card/);
  assert.match(app, /未完成或暂停不会倒扣、过期/);
  assert.match(app, /确认入账并结束今晚/);
  assert.match(app, /已安全记入家庭日历/);
  assert.match(app, /taskEnergy: Number\(record\.taskEnergy \?\? record\.childEnergy/);
  assert.match(app, /cooperationEnergy: Number\(record\.cooperationEnergy/);
  assert.doesNotMatch(app, /childEnergy, guardianEnergy/);
  assert.match(styles, /@keyframes energy-rise/);
  assert.match(app, /icon: data\.rewardGoal\.icon/);
  assert.doesNotMatch(app, /能量不会清零、倒扣或过期/);
  assert.match(app, /className="stage-summary" aria-expanded=\{expanded\}/);
  assert.match(app, /className="stage-editor-body"/);
  assert.match(app, /data-stage-title/);
  assert.match(app, /planStageIssueIds/);
  assert.match(app, /scrollIntoView\(\{ block: "center"/);
  assert.match(styles, /\.stage-editor\.is-expanded/);
  assert.match(styles, /\.screen h1\[tabindex="-1"\]:focus \{ outline: none; \}/);
  assert.match(styles, /@media \(pointer: coarse\)/);
  assert.match(styles, /\.phone-shell button \{ min-height: 44px; \}/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /transition-duration: \.001ms !important/);
  assert.match(app, /也会跟随系统设置/);
  assert.match(app, /navigator\.serviceWorker\.register\("\/sw\.js"\)/);
  assert.match(app, /window\.addEventListener\("offline", handleOffline\)/);
  assert.match(app, /网络已恢复 · 已合并并同步/);
  assert.match(app, /离线使用中/);
  assert.match(styles, /\.phone-shell\.is-offline \.screen \{ padding-top:/);
  assert.match(app, /共同商量能量/);
  assert.match(app, /className="task-energy-range branded-range"/);
  assert.match(app, /aria-valuetext=\{`\$\{stage\.energy\}点家庭能量`\}/);
  assert.match(app, /rewardThresholdBounds\(data\.energy\)/);
  assert.match(app, /max=\{rewardMaximumThreshold\}/);
  assert.match(styles, /\.branded-range::-webkit-slider-runnable-track/);
  assert.match(styles, /height: min\(860px, calc\(100vh - 68px\)\)/);
  assert.match(styles, /\.availability-card \.mascot \{ display: none; \}/);
  assert.match(styles, /\.stage-actions \{ grid-column: 1 \/ -1; grid-row: 2; grid-template-columns: repeat\(3,1fr\); \}/);
  assert.match(styles, /\.reward-idea-grid small \{ display: none; \}/);
  assert.match(styles, /\.undo-toast \{ z-index: 51/);
  assert.match(app, /从现在 \$\{startNowLabel\} 开始/);
  assert.match(app, /整晚时间会一起顺延/);
  assert.match(app, /shiftTimedPlanToStart\(stages, actualStart\)/);
  assert.match(app, /setTimeout\(startPlan, 1600\)/);
  assert.match(app, /const enterDualStart = \(\) => \{ setGuardianConfirmed\(false\)/);
  assert.match(app, /这是一份共同约定，不是身份验证/);
  assert.match(app, /再点一次可以取消/);
  assert.match(styles, /@keyframes launch-fill/);
  assert.match(app, /activeStage\.kind === "rest" \? "休息放松"/);
  assert.match(app, /planStart: data\.planStart, planEnd: data\.planEnd, stages/);
  assert.match(app, /planStart: livePlanStart \|\|/);
  assert.match(app, /screen !== "dual-start"/);
  assert.match(app, /setInterval\(\(\) => setClockNow\(Date\.now\(\)\), 1000\)/);
  assert.match(app, /Notification\.requestPermission/);
  assert.match(app, /new Notification\("这一段预计到时间了"/);
  assert.doesNotMatch(app, /\{data\.childAlias\}：完成事项/);
  assert.doesNotMatch(app, /className="phone-shell" aria-live/);
  assert.doesNotMatch(`${page}${layout}${app}`, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("ships an installable, privacy-preserving app manifest", async () => {
  const appManifest = manifest();
  assert.equal(appManifest.display, "standalone");
  assert.equal(appManifest.lang, "zh-CN");
  assert.equal(appManifest.icons?.[0]?.sizes, "320x320");
  const serviceWorker = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(serviceWorker, /clients\.claim\(\)/);
  assert.doesNotMatch(serviceWorker, /caches\.|addEventListener\("fetch"/);
});

test("ships optimized visual assets and persistent-state migration", async () => {
  const roomAsset = new URL("../public/assets/energy-room-v3.jpg", import.meta.url);
  await access(roomAsset);
  assert.ok((await stat(roomAsset)).size < 200_000, "energy room should stay below 200KB");
  await assert.rejects(access(new URL("../public/assets/energy-room-v2.png", import.meta.url)));
  await assert.rejects(access(new URL("../public/assets/warm-lamp.png", import.meta.url)));
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

  const shiftedToNow = shiftTimedPlanToStart([
    { title: "吃点东西", start: "18:10", end: "18:30" },
    { title: "阅读", start: "18:40", end: "19:00" },
  ], "20:00");
  assert.deepEqual(shiftedToNow.map(item => [item.start, item.end]), [["20:00", "20:20"], ["20:30", "20:50"]]);
  assert.equal(clockTimeFromDate(new Date(2026, 0, 1, 20, 5)), "20:05");
});

test("only uses a system reminder after guardian permission while hidden", () => {
  assert.equal(shouldUseBackgroundReminder(true, "hidden", "granted"), true);
  assert.equal(shouldUseBackgroundReminder(true, "visible", "granted"), false);
  assert.equal(shouldUseBackgroundReminder(false, "hidden", "granted"), false);
  assert.equal(shouldUseBackgroundReminder(true, "hidden", "denied"), false);
});

test("keeps a late-night session through the early morning but not into the next day", () => {
  const started = "2026-07-13T23:30:00+08:00";
  const updated = "2026-07-14T04:30:00+08:00";
  assert.equal(familyNightKey(started), familyNightKey(new Date("2026-07-14T04:59:00+08:00")));
  assert.equal(isLiveSessionFresh(started, updated, new Date("2026-07-14T04:59:00+08:00")), true);
  assert.equal(isLiveSessionFresh(started, updated, new Date("2026-07-14T05:00:00+08:00")), false);
  assert.equal(liveNightLabel(started, new Date("2026-07-14T01:00:00+08:00")), "昨晚");
  assert.equal(isLiveSessionFresh(started, updated, new Date("2026-07-15T00:30:00+08:00")), false);
});

test("awards shared-night bonuses only once while allowing later task energy", () => {
  assert.deepEqual(calculateNightBonus([], 1), { cooperationEnergy: 2, adjustmentEnergy: 1 });
  assert.deepEqual(calculateNightBonus([{ adjustmentEnergy: 1 }], 2), { cooperationEnergy: 0, adjustmentEnergy: 0 });
  assert.deepEqual(calculateNightBonus([{ adjustmentEnergy: 0 }], 1), { cooperationEnergy: 0, adjustmentEnergy: 1 });
});

test("suggests one transparent, parent-facing weekly change", () => {
  assert.equal(suggestWeeklyFocus({ nights: 0, morePromptNights: 0, lessPromptNights: 0, adjustments: 0 }).id, "observe");
  assert.equal(suggestWeeklyFocus({ nights: 2, morePromptNights: 1, lessPromptNights: 0, adjustments: 0 }).id, "offer-choice");
  assert.equal(suggestWeeklyFocus({ nights: 2, morePromptNights: 0, lessPromptNights: 0, adjustments: 3 }).id, "leave-space");
  assert.equal(suggestWeeklyFocus({ nights: 2, morePromptNights: 0, lessPromptNights: 1, adjustments: 0, recentCompletedFirstStep: "阅读" }).id, "keep-first-step");
  assert.equal(suggestWeeklyFocus({ nights: 1, morePromptNights: 0, lessPromptNights: 0, adjustments: 0 }).id, "smaller-start");
});

test("keeps reward targets valid after unusually high family energy", () => {
  assert.deepEqual(rewardThresholdBounds(4), { minimum: 10, maximum: 100 });
  assert.deepEqual(rewardThresholdBounds(100), { minimum: 105, maximum: 155 });
  assert.deepEqual(rewardThresholdBounds(215), { minimum: 220, maximum: 270 });
  assert.deepEqual(rewardThresholdBounds(Number.NaN), { minimum: 10, maximum: 100 });
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
