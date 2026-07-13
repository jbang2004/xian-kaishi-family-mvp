import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import test from "node:test";
import { addMinutes, analyzePlan, canInsertRestBreak, clockDeltaMinutes, clockTimeFromDate, durationMinutes, formatPlanClock, gentleRemainingLabel, insertRestBreak, prepareNextRoundPlan, prepareNextRoundSchedule, reflowTimedItemsFrom, remainingTimerMinutes, shiftFollowingForEndChange, shiftTimedItemsFrom, shiftTimedPlanToStart, spansMidnight } from "../app/plan-utils.ts";
import { shouldUseBackgroundReminder, shouldUseForegroundCue } from "../app/reminder-utils.ts";
import { rewardThresholdBounds } from "../app/reward-utils.ts";
import { suggestWeeklyFocus } from "../app/review-utils.ts";
import { calculateNightBonus, familyNightKey, isLiveSessionFresh, liveNightLabel } from "../app/session-utils.ts";
import { compareSyncSnapshots, mergeUniqueById, PendingWrites } from "../app/sync-utils.ts";
import { ASSET_VERSION, versionedAsset } from "../app/asset-version.ts";
import { cleanShortText } from "../app/text-utils.ts";
import { resolveHistoryTarget } from "../app/navigation-utils.ts";
import { shiftCalendarSelection } from "../app/calendar-utils.ts";

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
  assert.match(layout, /把每晚合作和共同期待留在家庭日历里/);
  assert.doesNotMatch(layout, /兑换/);
  assert.match(page, /<StartApp \/>/);
  assert.match(page, /把每晚合作和共同期待留在家庭日历里/);
  assert.match(app, /今晚少催一次/);
  assert.match(app, /孩子只短暂看屏幕 · 大人掌控手机/);
  assert.match(app, /name="child-alias" aria-label="孩子化名"/);
  assert.match(app, /window\.addEventListener\("popstate", handlePopState\)/);
  assert.match(app, /current !== "home" && LIVE_SCREENS\.includes\(next as LiveScreen\)/);
  assert.match(app, /今晚还在进行，可以调整计划或温和收尾/);
  assert.doesNotMatch(app, /window\.confirm/);
  assert.match(app, /role="alertdialog" aria-modal="true"/);
  assert.match(app, /取消，保留数据/);
  assert.match(app, /确认永久删除/);
  assert.match(app, /deleteCancelRef\.current\?\.focus\(\)/);
  assert.match(app, /deleteConfirmRef\.current/);
  assert.match(app, /aria-hidden=\{deleteArmed \|\| undefined\}/);
  assert.match(app, /inert=\{deleteArmed \|\| undefined\}/);
  assert.match(app, /event\.key !== "Tab"/);
  assert.match(app, /maxLength=\{24\} autoComplete="off" spellCheck=\{false\} enterKeyHint="done"/);
  assert.match(app, /aria-invalid=\{titleInvalid\}/);
  assert.match(app, /className="stage-inline-issue" aria-live="polite"/);
  assert.match(app, /className="input-label-row"/);
  assert.match(styles, /\.time-range input \{[^}]*font-size: 16px/);
  assert.match(styles, /\.window-inputs input \{[^}]*min-height: 44px[^}]*font-size: 16px/);
  assert.match(styles, /\.reward-compact-input input \{[^}]*min-height: 44px[^}]*font-size: 16px/);
  assert.match(styles, /--type-micro: 10px/);
  assert.match(styles, /--type-caption: 11px/);
  assert.doesNotMatch(styles, /font-size:\s*[789]px/);
  assert.equal(ASSET_VERSION, "2026-07-13-1");
  assert.match(app, /import \{ ASSET_VERSION \} from "\.\/asset-version"/);
  assert.match(layout, /versionedAsset\("\/assets\/icons\/home-heart\.png"\)/);
  assert.match(app, /loading\?: "eager" \| "lazy"/);
  assert.match(app, /<AppIcon name=\{icon\} loading="lazy"/);
  assert.match(app, /const COMMON_ICON_NAMES = new Set<string>/);
  assert.match(app, /showAllIcons \? ICON_LIBRARY/);
  assert.match(app, /显示全部 \$\{ICON_LIBRARY\.length\} 个图标/);
  assert.match(styles, /\.icon-library-toggle/);
  assert.match(app, /energy-room-v3\.jpg\?v=\$\{ASSET_VERSION\}/);
  assert.match(app, /fetchPriority="high" alt="温暖的家庭学习角"/);
  assert.match(app, /每阶段只提醒一次/);
  assert.match(app, /监护人授权与儿童隐私说明/);
  assert.match(app, /删除孩子全部数据/);
  assert.match(app, /寻找正规医疗机构/);
  assert.match(app, /xian-kaishi-plan-draft-v1/);
  assert.match(app, /xian-kaishi-live-session-v1/);
  assert.match(app, /休息也算照顾计划的一部分/);
  assert.match(app, /今晚草稿 · \$\{draftUpdatedAt \? "已自动保存" : "仅保存在这台设备"\}/);
  assert.match(app, /const \[editingStageId, setEditingStageId\] = useState\(""\)/);
  assert.match(app, /const activeStage = stages\[activeIndex\] \?\? stages\[0\] \?\? DEFAULT_STAGES\[0\]/);
  assert.match(app, /const addNodeButtonRef = useRef<HTMLButtonElement>\(null\)/);
  assert.match(app, /focusPlanTarget\(nextStageId\)/);
  assert.match(app, /setToast\("今晚已从空白开始"\); focusPlanTarget\(\)/);
  assert.match(app, /ref=\{addNodeButtonRef\} className="add-node-button"/);
  assert.match(app, /!e\.nativeEvent\.isComposing/);
  assert.match(app, /e\.currentTarget\.blur\(\); setEditingStageId\(""\)/);
  assert.match(app, /本项延长 \$\{delta\} 分钟，后续时间已顺延/);
  assert.match(app, /本项\$\{delta > 0 \? "后移" : "前移"\}/);
  assert.match(app, /onChange=\{e => updateStageStart\(stage\.id, e\.target\.value\)\}/);
  assert.match(app, /stageTimeEditRef = useRef/);
  assert.match(app, /onFocus=\{\(\) => beginStageTimeEdit\(stage\.id, "start"\)\}/);
  assert.match(app, /const baseline = timeEditBaseline\(id, "end"\)/);
  assert.match(app, /shiftedPlanUndo && <div className="undo-toast"/);
  assert.match(app, /className="home-plan-cta"/);
  assert.doesNotMatch(app, /className="draft-summary"/);
  assert.match(app, /const startAnotherPlan = \(\) => \{\s+setEditingStageId\(""\);\s+go\("plan"\);\s+\}/);
  assert.match(styles, /\.home-plan-cta \{[^}]*min-height: 92px/);
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
  assert.match(app, /if \(profileReturn === "settings"\) back\("settings"\); else go\("plan", "replace"\)/);
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
  assert.match(app, /现在休息10分钟，最晚\$\{result\.planEnd\}收尾/);
  assert.match(app, /setData\(current => \(\{ \.\.\.current, planEnd: result\.planEnd \}\)\)/);
  assert.match(app, /最晚\$\{nextPlanEnd\}收尾/);
  assert.match(app, /今晚进度 · 最晚 \{formatPlanClock\(data\.planEnd, data\.planStart, data\.planEnd\)\} 收尾/);
  assert.match(app, /之后只继续剩余时长/);
  assert.match(app, /跨到次日 · 结束时间按第二天计算/);
  assert.match(app, /const planCrossesMidnight = spansMidnight/);
  assert.match(app, /setData\(current => \(\{ \.\.\.current, planStart: e\.target\.value \}\)\)/);
  assert.match(app, /setData\(current => \(\{ \.\.\.current, planEnd: e\.target\.value \}\)\)/);
  assert.match(app, /canStartRest && <button className="soft-button" onClick=\{startRestNow\}>先休息 10 分钟<\/button>/);
  assert.match(app, /title: canStartRest \? "延长当前阶段" : "再休息10分钟"/);
  assert.match(app, /if \(screen !== "adjust"\) return/);
  assert.match(app, /remainingTimerMinutes\(activeEndsAt, startedAt\)/);
  assert.match(app, /!planHydrated \|\| LIVE_SCREENS\.includes\(screen as LiveScreen\)/);
  assert.match(app, /sessionPlanWindowRef\.current = \{ planStart: data\.planStart, planEnd: data\.planEnd \}/);
  assert.match(app, /baselinePlanStart: baseline\.planStart, baselinePlanEnd: baseline\.planEnd/);
  assert.match(app, /planStart: baseline\.planStart, planEnd: baseline\.planEnd/);
  assert.match(app, /setStages\(prepareNextRoundSchedule\(stages, completedStageTitles, baseline\.planStart\)\)/);
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
  assert.match(app, /积累到约定点数不会自动开始新一轮/);
  assert.match(app, /家庭活动不需要与孩子的表现一一交换/);
  assert.match(app, /goalRedeemed \? ""/);
  assert.match(styles, /\.reward-idea-grid button\.selected/);
  assert.match(app, /确认已实现，开启新一轮/);
  assert.match(app, /积累到约定点数，不等于已经实现/);
  assert.match(app, /当前 \{data\.energy\} 点会完成这一轮积累/);
  assert.match(app, /energyBeforeReset: data\.energy/);
  assert.match(app, /!next\.rewardGoal\.acknowledged/);
  assert.match(app, /先保留能量，等实际实现/);
  assert.match(app, /screenRef\.current === "reward-achieved" && next !== "reward-achieved"/);
  assert.match(app, /rewardExitHandlerRef\.current = \(\) =>/);
  assert.match(app, /rewardGoal: nextGoal \}, `能量会保留/);
  assert.doesNotMatch(app, /兑现|兑换|入账|支付|归零/);
  assert.match(app, /已安全保存在家庭日历/);
  assert.match(styles, /\.reward-saved-screen/);
  assert.match(app, /这一晚分\$\{selectedSessionSummary\.settlements\}次留下记录/);
  assert.match(app, /先看整体，不用逐条比较每一次/);
  assert.match(app, /aria-controls="day-session-details"/);
  assert.match(styles, /\.daily-summary-stats/);
  assert.match(app, /aria-current=\{isToday \? "date" : undefined\}/);
  assert.match(app, /className="today-jump"/);
  assert.match(styles, /\.calendar-grid > button\.is-today/);
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
  assert.match(app, /保存记录并结束今晚/);
  assert.match(app, /本次新增能量/);
  assert.match(app, /taskEnergy: Number\(record\.taskEnergy \?\? record\.childEnergy/);
  assert.match(app, /cooperationEnergy: Number\(record\.cooperationEnergy/);
  assert.doesNotMatch(app, /childEnergy, guardianEnergy/);
  assert.match(styles, /@keyframes energy-rise/);
  assert.match(styles, /--motion-fast: 160ms/);
  assert.match(styles, /--ambient-cycles: 3/);
  assert.match(styles, /--ease-out-soft: cubic-bezier/);
  assert.match(styles, /@keyframes mascot-ground/);
  assert.match(styles, /mascot-ground 3\.6s ease-in-out var\(--ambient-cycles\)/);
  assert.match(styles, /mascot-blink 5\.8s linear var\(--ambient-cycles\)/);
  assert.match(styles, /halo-breathe 3s ease-in-out var\(--ambient-cycles\)/);
  assert.match(styles, /mascot-nod 2\.8s ease-in-out 2/);
  assert.match(styles, /mascot-listen 3\.4s ease-in-out 2/);
  assert.match(styles, /mascot-breathe 3\.6s ease-in-out infinite/);
  assert.match(styles, /room-drift 10s ease-in-out var\(--ambient-cycles\) alternate/);
  assert.match(styles, /room-light 5\.5s ease-in-out var\(--ambient-cycles\)/);
  assert.doesNotMatch(styles, /breathing-ring|ring-breathe/);
  assert.match(styles, /mascot-celebrate 1\.9s var\(--ease-out-soft\) 2/);
  assert.match(styles, /spark-pop 1\.9s ease-out 2/);
  assert.match(styles, /energy-rise 2\.4s ease-out 2/);
  assert.match(styles, /\.bottom-nav button\.active \{ color: var\(--amber-deep\); background:/);
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
  assert.match(styles, /summary:focus-visible/);
  assert.match(styles, /\.phone-shell button \{ min-height: 44px; \}/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /transition-duration: \.001ms !important/);
  assert.match(app, /也会跟随系统设置/);
  assert.match(app, /navigator\.serviceWorker\.register\("\/sw\.js"\)/);
  assert.match(app, /useSyncExternalStore\(subscribeToNetworkStatus/);
  assert.match(app, /\(\) => navigator\.onLine, \(\) => true/);
  assert.doesNotMatch(app, /useState\(\(\) => typeof navigator/);
  assert.match(app, /window\.addEventListener\("offline", handleOffline\)/);
  assert.match(app, /网络已恢复 · 已合并并同步/);
  assert.match(app, /离线使用中/);
  assert.match(app, /xian-kaishi-pending-cloud-delete-v1/);
  assert.match(app, /pendingWritesRef\.current\.drain\(\)/);
  assert.match(app, /pendingWritesRef\.current\.track\(syncPromise\)/);
  assert.doesNotMatch(app, /track\(fetch\(/);
  assert.match(app, /deleteInProgressRef\.current\) return/);
  assert.match(app, /联网后继续清理云端副本/);
  assert.match(app, /只暂存随机家庭 ID；联网后自动重试/);
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
  assert.match(styles, /@media \(max-width: 900px\) and \(max-height: 640px\)/);
  assert.match(styles, /\.due-action-dock \{ position: static; margin-top: 10px; \}/);
  assert.match(styles, /\.wrap-action-dock \{ position: static; margin-top: 10px; \}/);
  assert.match(styles, /\.undo-toast \{ z-index: 51/);
  assert.match(app, /从现在 \$\{startNowLabel\} 开始/);
  assert.match(app, /整晚时间会一起顺延/);
  assert.match(app, /const cleanStages = stages\.map/);
  assert.match(app, /shiftTimedPlanToStart\(cleanStages, actualStart\)/);
  assert.match(app, /const DUAL_START_DELAY_MS = 2400/);
  assert.match(app, /setTimeout\(startPlan, DUAL_START_DELAY_MS\)/);
  assert.match(app, /const enterDualStart = \(\) => \{ setGuardianConfirmed\(false\)/);
  assert.match(app, /const \[dualStartPaused, setDualStartPaused\] = useState\(false\)/);
  assert.match(app, /if \(screenRef\.current === "dual-start" && next !== "dual-start"\)/);
  assert.match(app, /已经停住，可以再商量一下/);
  assert.match(app, /dualStatusRef\.current\?\.focus\(\)/);
  assert.match(app, /约 2 秒后开始/);
  assert.match(app, /const adjustReturnScreen: LiveScreen = activeStage\.status === "done" \? "transition" : "running"/);
  assert.match(app, /pendingAfterActiveCount >= 2 \? \[\{ id: "swap" as const/);
  assert.match(app, /pendingAfterActiveCount >= 1 \? \[\{ id: "tomorrow" as const/);
  assert.match(app, /当前阶段 · \{activeTonightOrdinal\}\/\{tonightStageCount\}/);
  assert.match(app, /这不是身份验证/);
  assert.match(app, /className="launch-cancel-button"/);
  assert.match(app, /className="launch-status-copy"/);
  assert.match(app, /即将进入/);
  assert.match(app, /aria-live="polite" aria-atomic="true"/);
  assert.match(styles, /@keyframes launch-fill/);
  assert.match(styles, /animation: launch-fill 2\.4s linear both/);
  assert.match(app, /activeStage\.kind === "rest" \? "休息放松"/);
  assert.match(app, /点错了，回到这一段/);
  assert.match(app, /这一段已经做完/);
  assert.doesNotMatch(app, /提前完成这一阶段/);
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
  const [manifestSource, serviceWorker] = await Promise.all([
    readFile(new URL("../app/manifest.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
  ]);
  assert.match(manifestSource, /display: "standalone"/);
  assert.match(manifestSource, /lang: "zh-CN"/);
  assert.match(manifestSource, /sizes: "320x320"/);
  assert.equal(versionedAsset("/assets/icons/home-heart.png"), `/assets/icons/home-heart.png?v=${ASSET_VERSION}`);
  assert.match(manifestSource, /src: versionedAsset\("\/assets\/icons\/home-heart\.png"\)/);
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
  assert.match(route, /localOnly: true \}, \{ status: 503 \}/);
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

test("supports a family plan that crosses midnight", () => {
  const overnight = analyzePlan("22:30", "00:30", [
    { title: "阅读", start: "22:30", end: "23:10" },
    { title: "整理书包", start: "23:50", end: "00:10" },
    { title: "洗漱", start: "00:10", end: "00:25" },
  ]);

  assert.equal(overnight.hasErrors, false);
  assert.equal(overnight.availableMinutes, 120);
  assert.equal(overnight.scheduledMinutes, 75);
  assert.equal(overnight.balanceMinutes, 45);
  assert.equal(spansMidnight("22:30", "00:30"), true);
  assert.equal(durationMinutes("23:50", "00:10"), 20);
  assert.equal(formatPlanClock("23:50", "22:30", "00:30"), "23:50");
  assert.equal(formatPlanClock("00:10", "22:30", "00:30"), "次日 00:10");
});

test("rejects cross-midnight overlap and tasks outside the family window", () => {
  const invalid = analyzePlan("22:30", "00:30", [
    { title: "阅读", start: "23:30", end: "00:10" },
    { title: "整理", start: "23:50", end: "00:20" },
    { title: "太晚", start: "00:25", end: "00:40" },
  ]);

  assert.equal(invalid.hasErrors, true);
  assert.equal(invalid.itemErrors[1].time, true);
  assert.ok(invalid.itemErrors[1].messages.some(issue => issue.includes("重叠")));
  assert.ok(invalid.itemErrors[2].messages.some(issue => issue.includes("超出")));
});

test("calculates stage durations and automatic time shifts", () => {
  assert.equal(durationMinutes("18:10", "18:40"), 30);
  assert.equal(addMinutes("18:40", 25), "19:05");

  const shifted = shiftTimedItemsFrom([
    { title: "数学", start: "18:10", end: "18:40" },
    { title: "阅读", start: "18:40", end: "19:05" },
  ], 1, 10);
  assert.deepEqual(shifted.map(item => [item.start, item.end]), [["18:10", "18:40"], ["18:50", "19:15"]]);

  const resized = shiftFollowingForEndChange([
    { title: "数学", start: "18:10", end: "18:40" },
    { title: "阅读", start: "18:50", end: "19:15" },
    { title: "整理", start: "19:15", end: "19:25" },
  ], 0, "18:50");
  assert.deepEqual(resized.map(item => [item.start, item.end]), [["18:10", "18:50"], ["19:00", "19:25"], ["19:25", "19:35"]]);

  const shortened = shiftFollowingForEndChange(resized, 0, "18:35");
  assert.deepEqual(shortened.map(item => [item.start, item.end]), [["18:10", "18:35"], ["18:45", "19:10"], ["19:10", "19:20"]]);

  const overnightResize = shiftFollowingForEndChange([
    { title: "阅读", start: "23:30", end: "23:50" },
    { title: "整理", start: "00:00", end: "00:20" },
  ], 0, "00:10");
  assert.deepEqual(overnightResize.map(item => [item.start, item.end]), [["23:30", "00:10"], ["00:20", "00:40"]]);
  assert.equal(clockDeltaMinutes("23:50", "00:10"), 20);
  assert.equal(clockDeltaMinutes("00:10", "23:50"), -20);

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

test("inserts a live rest break from now and resumes only the unfinished time", () => {
  const result = insertRestBreak([
    { title: "数学", start: "19:00", end: "19:30", status: "active" },
    { title: "阅读", start: "19:30", end: "20:00", status: "pending" },
    { title: "整理", start: "20:00", end: "20:10", status: "pending" },
  ], 0, { title: "安静休息", start: "", end: "", status: "active" }, "19:12", 18, 10, 10, "20:30");

  assert.equal(result.restIndex, 0);
  assert.equal(result.resumedMinutes, 18);
  assert.equal(result.planEnd, "20:40");
  assert.deepEqual(result.items.map(item => [item.title, item.start, item.end, item.status]), [
    ["安静休息", "19:12", "19:22", "active"],
    ["数学", "19:22", "19:40", "pending"],
    ["阅读", "19:40", "20:10", "pending"],
    ["整理", "20:10", "20:20", "pending"],
  ]);
});

test("gives a due stage a small follow-up window after resting", () => {
  const result = insertRestBreak([
    { title: "数学", start: "19:00", end: "19:30", status: "active" },
    { title: "阅读", start: "19:30", end: "20:00", status: "pending" },
  ], 0, { title: "安静休息", start: "", end: "", status: "active" }, "19:31", 0);

  assert.equal(result.resumedMinutes, 10);
  assert.deepEqual(result.items.map(item => [item.start, item.end]), [
    ["19:31", "19:41"], ["19:41", "19:51"], ["19:51", "20:21"],
  ]);
  assert.equal(result.planEnd, "20:21");
});

test("uses the confirmation moment for whole remaining timer minutes", () => {
  const now = Date.parse("2026-07-13T19:12:00+08:00");
  assert.equal(remainingTimerMinutes(now + 17 * 60_000 + 2_000, now), 18);
  assert.equal(remainingTimerMinutes(now - 1, now), 0);
  assert.equal(remainingTimerMinutes(0, now), 0);
});

test("shows a calm approximate timer instead of a second-by-second deadline", () => {
  assert.equal(gentleRemainingLabel(20 * 60), "20 分钟左右");
  assert.equal(gentleRemainingLabel(61), "2 分钟左右");
  assert.equal(gentleRemainingLabel(59), "不到 1 分钟");
  assert.equal(gentleRemainingLabel(0), "可以看看下一步");
});

test("keeps calendar context across months and clamps long month endings", () => {
  const august = shiftCalendarSelection(new Date(2026, 6, 1), "2026-07-13", 1);
  assert.equal(august.cursor.getFullYear(), 2026);
  assert.equal(august.cursor.getMonth(), 7);
  assert.equal(august.selectedDay, "2026-08-13");

  const february = shiftCalendarSelection(new Date(2026, 0, 1), "2026-01-31", 1);
  assert.equal(february.selectedDay, "2026-02-28");

  const fallback = shiftCalendarSelection(new Date(2026, 6, 1), "not-a-date", 1);
  assert.equal(fallback.selectedDay, "2026-08-01");
});

test("never nests an adaptive rest inside an active rest stage", () => {
  assert.equal(canInsertRestBreak("task"), true);
  assert.equal(canInsertRestBreak("rest"), false);
});

test("keeps only unfinished planned items for another round", () => {
  const next = prepareNextRoundPlan([
    { id: "rest-live", title: "安静休息", start: "19:00", end: "19:10", status: "done" },
    { id: "snack", title: "吃点东西", start: "19:10", end: "19:30", status: "done" },
    { id: "math", title: "数学练习", start: "19:30", end: "20:00", status: "tomorrow" },
    { id: "book", title: "阅读", start: "20:00", end: "20:20", status: "pending" },
  ], ["吃点东西"]);

  assert.deepEqual(next.map(item => [item.id, item.status]), [["math", "pending"], ["book", "pending"]]);
});

test("does not remove an unfinished duplicate after its completed twin", () => {
  const next = prepareNextRoundPlan([
    { id: "math-a", title: "数学练习", start: "19:00", end: "19:20", status: "done" },
    { id: "math-b", title: "数学练习", start: "19:20", end: "19:40", status: "pending" },
  ], ["数学练习"]);

  assert.deepEqual(next.map(item => [item.id, item.status]), [["math-b", "pending"]]);
});

test("restores the family planning window after a session starts at a different time", () => {
  const next = prepareNextRoundSchedule([
    { id: "snack", title: "吃点东西", start: "08:19", end: "08:39", status: "done" },
    { id: "math", title: "数学练习", start: "08:39", end: "09:09", status: "tomorrow" },
    { id: "book", title: "阅读", start: "09:19", end: "09:39", status: "pending" },
  ], ["吃点东西"], "18:10");

  assert.deepEqual(next.map(item => [item.id, item.start, item.end, item.status]), [
    ["math", "18:10", "18:40", "pending"],
    ["book", "18:50", "19:10", "pending"],
  ]);
});

test("preserves planned gaps and the trailing buffer after a live rest", () => {
  const result = insertRestBreak([
    { title: "数学", start: "19:00", end: "19:30", status: "active" },
    { title: "阅读", start: "19:40", end: "20:00", status: "pending" },
    { title: "整理", start: "20:10", end: "20:20", status: "pending" },
  ], 0, { title: "安静休息", start: "", end: "", status: "active" }, "19:10", 20, 10, 10, "20:30");

  assert.deepEqual(result.items.map(item => [item.title, item.start, item.end]), [
    ["安静休息", "19:10", "19:20"],
    ["数学", "19:20", "19:40"],
    ["阅读", "19:50", "20:10"],
    ["整理", "20:20", "20:30"],
  ]);
  assert.equal(result.planEnd, "20:40");
});

test("preserves a planned gap when a live rest crosses midnight", () => {
  const result = insertRestBreak([
    { title: "阅读", start: "23:40", end: "00:00", status: "active" },
    { title: "整理", start: "00:10", end: "00:30", status: "pending" },
  ], 0, { title: "安静休息", start: "", end: "", status: "active" }, "23:50", 10, 10, 10, "00:45");

  assert.deepEqual(result.items.map(item => [item.title, item.start, item.end]), [
    ["安静休息", "23:50", "00:00"],
    ["阅读", "00:00", "00:10"],
    ["整理", "00:20", "00:40"],
  ]);
  assert.equal(result.planEnd, "00:55");
});

test("rests after a completed stage without reviving it", () => {
  const result = insertRestBreak([
    { title: "数学", start: "19:00", end: "19:20", status: "done" },
    { title: "阅读", start: "19:20", end: "19:50", status: "pending" },
  ], 0, { title: "安静休息", start: "", end: "", status: "active" }, "19:24", 0);

  assert.equal(result.restIndex, 1);
  assert.equal(result.resumedMinutes, 0);
  assert.deepEqual(result.items.map(item => [item.title, item.start, item.end, item.status]), [
    ["数学", "19:00", "19:20", "done"],
    ["安静休息", "19:24", "19:34", "active"],
    ["阅读", "19:34", "20:04", "pending"],
  ]);
  assert.equal(result.planEnd, "20:04");
});

test("only uses a system reminder after guardian permission while hidden", () => {
  assert.equal(shouldUseBackgroundReminder(true, "hidden", "granted"), true);
  assert.equal(shouldUseBackgroundReminder(true, "visible", "granted"), false);
  assert.equal(shouldUseBackgroundReminder(false, "hidden", "granted"), false);
  assert.equal(shouldUseBackgroundReminder(true, "hidden", "denied"), false);
  assert.equal(shouldUseForegroundCue("visible"), true);
  assert.equal(shouldUseForegroundCue("hidden"), false);
  assert.equal(shouldUseForegroundCue("prerender"), false);
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

test("cleans short family-entered text only at save boundaries", () => {
  assert.equal(cleanShortText("  小  橙  ", 12), "小 橙");
  assert.equal(cleanShortText("  阅读二十四个字以内的任务名称  ", 8), "阅读二十四个字以");
  assert.equal(cleanShortText("   ", 12), "");
});

test("keeps browser back inside the live evening and skips stale setup after finishing", () => {
  assert.deepEqual(resolveHistoryTarget("running", "confirm"), { screen: "running", blocked: true, collapseToRoot: false });
  assert.deepEqual(resolveHistoryTarget("night-saved", "confirm"), { screen: "home", blocked: false, collapseToRoot: true });
  assert.deepEqual(resolveHistoryTarget("night-saved", "wrap"), { screen: "home", blocked: false, collapseToRoot: true });
  assert.deepEqual(resolveHistoryTarget("reward-saved", "reward-achieved"), { screen: "home", blocked: false, collapseToRoot: true });
  assert.deepEqual(resolveHistoryTarget("welcome", "settings"), { screen: "welcome", blocked: true, collapseToRoot: false });
  assert.deepEqual(resolveHistoryTarget("review", "home"), { screen: "home", blocked: false, collapseToRoot: false });
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

test("waits for pending cloud writes before destructive deletion", async () => {
  const pending = new PendingWrites();
  let release = () => {};
  const write = new Promise(resolve => { release = resolve; });
  pending.track(write);
  const draining = pending.drain();
  assert.equal(pending.size, 1);
  release();
  await draining;
  assert.equal(pending.size, 0);
});
