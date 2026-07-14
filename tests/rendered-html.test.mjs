import assert from "node:assert/strict";
import { access, readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";
import { addMinutes, alignLiveStagesToStart, analyzePlan, canInsertRestBreak, clockDeltaMinutes, clockMinutesUntil, clockTimeFromDate, countCompletedTasks, deferNextPendingItem, durationMinutes, findPlanInsertionSlot, formatPlanClock, gentleRemainingLabel, insertRestBreak, millisecondsUntilNextMinute, moveTimedItemPreservingGaps, prepareNextRoundPlan, prepareNextRoundSchedule, rebaseFollowUpPlan, reflowTimedItemsFrom, remainingTimerMinutes, scheduledEndTime, shiftFollowingForEndChange, shiftTimedItemsFrom, shiftTimedPlanToStart, spansMidnight, suggestInitialEveningWindow, swapNextPendingItems, swapTimedItemsPreservingGaps, titleAfterIconChoice } from "../app/plan-utils.ts";
import { foregroundCueStatus, shouldShowSoftLanding, shouldUseBackgroundReminder, shouldUseForegroundCue, shouldUseHapticCue } from "../app/reminder-utils.ts";
import { normalizeStageEnergy, restoreRewardRedemption, rewardThresholdBounds, stageEnergyLabel } from "../app/reward-utils.ts";
import { suggestWeeklyFocus } from "../app/review-utils.ts";
import { advanceStageStatuses, calculateNightBonus, deferActiveStage, familyNightDisplayLabel, familyNightKey, isLiveSessionFresh, keepNewestRecords, liveNightLabel, removeNightAndReconcileEnergy, removeSessionAndReconcileEnergy, settlementFooterCopy } from "../app/session-utils.ts";
import { compareSyncSnapshots, mergeUniqueById, PendingWrites } from "../app/sync-utils.ts";
import { ASSET_VERSION, versionedAsset } from "../app/asset-version.ts";
import { cleanShortText } from "../app/text-utils.ts";
import { resolveHistoryTarget } from "../app/navigation-utils.ts";
import { shiftCalendarSelection } from "../app/calendar-utils.ts";

function relativeLuminance(hex) {
  const channels = hex.match(/[\da-f]{2}/gi).map(value => Number.parseInt(value, 16) / 255);
  const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground, background) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

test("keeps supporting text readable across the warm card palette", async () => {
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const muted = styles.match(/--muted:\s*(#[\da-f]{6})/i)?.[1];
  const focusRing = styles.match(/--focus-ring:\s*(#[\da-f]{6})/i)?.[1];
  const focusHalo = styles.match(/--focus-halo:\s*(#[\da-f]{6})/i)?.[1];
  assert.ok(muted, "the supporting-text token should be defined");
  assert.ok(focusRing, "the keyboard focus-ring token should be defined");
  assert.ok(focusHalo, "the keyboard focus-halo token should be defined");
  for (const background of ["#fffdf8", "#fff8ec", "#edf6ef", "#edf4fb", "#fff2cb"]) {
    assert.ok(contrastRatio(muted, background) >= 4.5, `${muted} should remain readable on ${background}`);
  }
  for (const background of ["#fffdf8", "#fff8ec", "#f5b84b", "#75b89b"]) {
    assert.ok(contrastRatio(focusRing, background) >= 3, `${focusRing} should remain visible on ${background}`);
  }
  assert.ok(contrastRatio("#8a5c14", "#fff9e9") >= 4.5, "the cloud-boundary heading should stay readable");
  assert.ok(contrastRatio("#725d3e", "#fff9e9") >= 4.5, "the cloud-boundary explanation should stay readable");
  assert.ok(contrastRatio(focusHalo, "#bd4f46") >= 3, `${focusHalo} should separate focus from destructive controls`);
  assert.match(styles, /outline: 3px solid var\(--focus-ring\); outline-offset: 3px; box-shadow: 0 0 0 3px var\(--focus-halo\)/);
  assert.match(styles, /\.stage-summary:focus-visible,[\s\S]*?\.timeline-disclosure summary:focus-visible \{ outline-offset: -4px/);
  assert.match(styles, /button, summary \{[^}]*touch-action: manipulation/);
  assert.match(styles, /\.phone-shell button:not\(:disabled\):not\(\.press-zone\):active \{[^}]*filter: brightness\(\.975\)[^}]*transform: translateY\(1px\) scale\(\.985\)/);
  assert.match(styles, /@media \(prefers-contrast: more\)/);
  assert.match(styles, /@media \(forced-colors: active\)/);
  assert.match(styles, /outline: 3px solid Highlight; box-shadow: none/);
  assert.match(styles, /@media \(max-width: 900px\) \{[\s\S]*?\.phone-shell button \{ min-height: 44px; \}/);
  assert.match(styles, /\.stage-meta \.effort-pill \{[^}]*min-height: 44px/);
  assert.match(styles, /\.welcome-boundary > button \{ min-height: 44px; margin-top: 4px/);
  assert.match(styles, /\.effort-screen \.rest-duration button \{ min-height: 44px/);
});

test("aligns calm decision-screen updates to minute boundaries", () => {
  assert.equal(millisecondsUntilNextMinute(0), 60_000);
  assert.equal(millisecondsUntilNextMinute(1), 59_999);
  assert.equal(millisecondsUntilNextMinute(59_999), 1);
  assert.equal(millisecondsUntilNextMinute(60_000), 60_000);
  assert.equal(millisecondsUntilNextMinute(Number.NaN), 60_000);
});

test("uses an icon label only to help name an empty stage", () => {
  assert.equal(titleAfterIconChoice("", "book", "阅读"), "阅读");
  assert.equal(titleAfterIconChoice("  ", "backpack", "整理书包"), "整理书包");
  assert.equal(titleAfterIconChoice("自主阅读", "book", "阅读"), "自主阅读");
  assert.equal(titleAfterIconChoice("", "custom", "自定义"), "");
});

test("contains the complete 先开始 product shell", async () => {
  const [page, layout, app, styles, serviceWorker] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/StartApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /先开始｜家庭晚间习惯助手/);
  assert.match(layout, /manifest: "\/manifest\.webmanifest"/);
  assert.match(layout, /appleWebApp: \{ capable: true/);
  assert.match(layout, /themeColor: "#fff8ec"/);
  assert.match(layout, /亲子共同安排任务、休息和奖励/);
  assert.doesNotMatch(layout, /兑换/);
  assert.match(page, /<StartApp \/>/);
  assert.match(page, /亲子共同安排任务、休息和奖励/);
  assert.match(app, /headers\.set\("x-family-token", familyToken\)/);
  assert.doesNotMatch(app, /api\/state\?familyId/);
  assert.match(app, /今晚的事，一起定下来，按时开始/);
  assert.match(app, /共同确认/);
  assert.match(app, /到点确认下一步/);
  assert.match(app, /childAlias: ""/);
  assert.match(app, /guardianAlias: ""/);
  assert.match(app, /rewardGoal: \{ threshold: 20, title: "", icon: "game", date: "周六", participants: \[\], redeemed: true/);
  assert.match(app, /const \[stages, setStages\] = useState<Stage\[]>\(\[\]\)/);
  assert.match(app, /if \(!Array\.isArray\(value\)\) return \[\]/);
  assert.match(app, /name="child-alias" aria-label="孩子化名" placeholder="例如：小橙"/);
  assert.match(app, /name="guardian-alias" aria-label="大人称呼" placeholder="例如：妈妈"/);
  assert.match(app, /ref=\{childAliasInputRef\} name="child-alias"/);
  assert.match(app, /guardianAliasInputRef\.current\?\.focus\(\)/);
  assert.match(app, /ref=\{guardianAliasInputRef\} name="guardian-alias"/);
  assert.match(app, /e\.preventDefault\(\); finishProfile\(\)/);
  assert.match(app, /familyDataRef\.current\.consent \? \{\} : suggestInitialEveningWindow\(new Date\(\)\)/);
  assert.match(app, /window\.addEventListener\("popstate", handlePopState\)/);
  assert.match(app, /familyDataRef\.current\.consent && \(target === "welcome" \|\| target === "profile"\)/);
  assert.match(app, /window\.history\.replaceState\(\{ xianKaishi: true, screen: "home", depth \}/);
  assert.match(app, /current !== "home" && LIVE_SCREENS\.includes\(next as LiveScreen\)/);
  assert.match(app, /今晚还在进行，可以调整计划或结束本次计划/);
  assert.doesNotMatch(app, /window\.confirm/);
  assert.match(app, /role="alertdialog" aria-modal="true"/);
  assert.match(app, /取消，保留数据/);
  assert.match(app, /确认永久删除/);
  assert.match(app, /家庭数据已全部删除/);
  assert.match(app, /重新开始时不会带入旧家庭的信息/);
  assert.match(styles, /\.deletion-complete-note \{[^}]*border-color: rgba\(117,184,155,\.35\)/);
  assert.match(app, /deleteCancelRef\.current\?\.focus\(\)/);
  assert.match(app, /deleteConfirmRef\.current/);
  assert.match(app, /aria-hidden=\{deleteArmed \|\| undefined\}/);
  assert.match(app, /inert=\{deleteArmed \|\| undefined\}/);
  assert.match(app, /aria-controls="calendar-day-detail"/);
  assert.match(app, /id="calendar-day-detail" ref=\{calendarDetailRef\}/);
  assert.match(app, /className="toast" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(app, /event\.key !== "Tab"/);
  assert.match(app, /maxLength=\{24\} autoComplete="off" spellCheck=\{false\} enterKeyHint="done"/);
  assert.match(app, /const focusStageDetails = \(stageId: string\)/);
  assert.match(app, /e\.currentTarget\.blur\(\); focusStageDetails\(stage\.id\)/);
  assert.match(app, /aria-invalid=\{titleInvalid\}/);
  assert.match(app, /className="stage-inline-issue" aria-live="polite"/);
  assert.match(app, /const restDurationChoices = Array\.from\(new Set\(\[5, 10, 15, editingStageDuration\]/);
  assert.match(app, /title="调整节点"/);
  assert.match(app, /选择会自动保存 · 先确定它是投入，还是恢复/);
  assert.match(app, /完成调整，返回时间表/);
  assert.match(styles, /\.rest-duration > div\.has-custom-duration/);
  assert.match(app, /className="input-label-row"/);
  assert.match(styles, /\.time-range input \{[^}]*font-size: 16px/);
  assert.match(styles, /\.window-inputs input \{[^}]*min-height: 44px[^}]*font-size: 16px/);
  assert.match(styles, /\.reward-compact-input input \{[^}]*min-height: 44px[^}]*font-size: 16px/);
  assert.match(styles, /\.energy-screen \.room-scene \{[^}]*height: clamp\(156px, 28\.5vh, 194px\)/);
  assert.match(styles, /\.energy-screen \.goal-card,[\s\S]*?\.energy-screen \.empty-goal-card \{[^}]*grid-template-columns: 50px minmax\(0,1fr\)/);
  assert.match(styles, /--type-micro: 11px/);
  assert.match(styles, /--type-caption: 12px/);
  assert.doesNotMatch(styles, /font-size:\s*10px/);
  assert.doesNotMatch(styles, /font-size:\s*[789]px/);
  assert.match(styles, /body \{[^}]*min-height: 100svh;[^}]*min-height: 100dvh;[^}]*overflow: hidden/);
  assert.match(styles, /\.site-shell \{[^}]*min-height: 100svh;[^}]*min-height: 100dvh/);
  assert.match(styles, /\.phone-shell \{[^}]*overflow-y: auto;[^}]*overscroll-behavior-y: contain;[^}]*scroll-padding-block: 24px 128px/);
  assert.match(styles, /@media \(max-width: 900px\) \{[\s\S]*?\.phone-shell \{[^}]*height: 100svh;[^}]*height: 100dvh;[^}]*min-height: 100svh;[^}]*min-height: 100dvh/);
  assert.match(styles, /\.screen \{[^}]*env\(safe-area-inset-right\)[^}]*env\(safe-area-inset-left\)/);
  assert.match(styles, /\.bottom-nav \{ position: fixed; left: max\(18px, env\(safe-area-inset-left\)\); right: max\(18px, env\(safe-area-inset-right\)\)/);
  assert.match(styles, /\.undo-shelf \{[\s\S]*?position: sticky;[\s\S]*?top: 10px/);
  assert.match(styles, /\.toast \{[^}]*font-size: 13px[^}]*-webkit-line-clamp: 2/);
  assert.match(styles, /@media \(max-width: 380px\) and \(max-height: 640px\) \{[\s\S]*?\.toast \{[^}]*bottom: calc\(96px \+ env\(safe-area-inset-bottom\)\)[^}]*font-size: 12px/);
  assert.match(styles, /\.undo-shelf span \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap/);
  assert.match(app, /const readableDuration = Math\.min\(5200, Math\.max\(3000, 2000 \+ toast\.length \* 90\)\)/);
  assert.match(app, /screen !== "confirm" && screen !== "dual-start" && screen !== "adjust"/);
  assert.match(app, /minuteTimer = window\.setInterval\(tick, 60_000\)/);
  assert.equal((app.match(/window\.setInterval\([^;\n]*1000\)/g) ?? []).length, 1);
  assert.match(app, /document\.addEventListener\("visibilitychange", tick\)/);
  assert.match(styles, /@media \(max-width: 900px\) and \(orientation: landscape\) and \(min-width: 600px\) \{[\s\S]*?\.screen \{ width: min\(600px, 100%\); margin-inline: auto; \}/);
  assert.match(app, /className="undo-shelf" role="status" aria-live="polite" aria-atomic="true"/);
  assert.equal(ASSET_VERSION, "2026-07-13-2");
  assert.match(app, /import \{ ASSET_VERSION \} from "\.\/asset-version"/);
  assert.match(layout, /versionedAsset\("\/assets\/icons\/home-heart\.png"\)/);
  assert.match(app, /loading\?: "eager" \| "lazy"/);
  assert.match(app, /\/assets\/optimized\/icons\/\$\{name\}\.webp/);
  assert.match(app, /\/assets\/optimized\/mascot\/\$\{mood\}\.webp/);
  assert.match(app, /<picture className=\{`app-icon \$\{className\}`\}>/);
  assert.match(app, /className="app-icon-image"/);
  assert.match(styles, /\.app-icon-image \{ display: block; width: 100%; height: 100%; object-fit: contain; \}/);
  assert.match(styles, /\.optimized-picture \{ display: contents; \}/);
  assert.match(styles, /\.live-pulse::after \{[^}]*animation: live-soft-pulse/);
  assert.match(styles, /@keyframes live-soft-pulse \{ 0%, 100% \{ opacity: 0; transform: scale\(\.9\); \} 42% \{ opacity: \.68; transform: scale\(1\.16\); \}/);
  assert.match(styles, /\.active-stage-card\.is-landing::after \{[^}]*animation: soft-landing-arrive/);
  assert.match(styles, /@keyframes soft-landing-arrive \{ 0%, 100% \{ opacity: 0; transform: scale\(\.994\); \} 48% \{ opacity: \.82; transform: scale\(1\.006\); \}/);
  assert.match(app, /现在开始，整晚将比原定 \$\{plannedStartLabel\} 前移/);
  assert.match(app, /开始后仍可休息、换顺序，或把事项留到明天/);
  assert.match(styles, /\.confirm-hero \{ grid-template-columns: minmax\(0,1fr\) 74px/);
  assert.match(styles, /\.confirm-timing-note \{ min-height: 0; grid-template-columns: 32px minmax\(0,1fr\)/);
  assert.match(styles, /\.family-agreement > div \{ min-height: 54px; grid-template-columns: 32px minmax\(0,1fr\)/);
  assert.match(styles, /@media \(max-width: 900px\) and \(max-height: 700px\) \{[\s\S]*?\.confirm-action-dock \{[\s\S]*?grid-template-columns: minmax\(0,1fr\) 106px/);
  assert.match(layout, /images: \[\{ url: `\$\{origin\}\/og\.jpg`/);
  assert.match(app, /<AppIcon name=\{icon\} loading="lazy"/);
  assert.match(app, /当前图标 \+ \$\{commonIconLibrary\.length\} 个家庭高频图标/);
  assert.match(app, /const COMMON_ICON_NAMES = new Set<string>/);
  assert.match(app, /showAllIcons \? ICON_LIBRARY/);
  assert.match(app, /显示全部 \$\{ICON_LIBRARY\.length\} 个图标/);
  assert.match(styles, /\.icon-library-toggle/);
  assert.match(app, /energy-room-v3\.jpg\?v=\$\{ASSET_VERSION\}/);
  assert.match(app, /fetchPriority="high" alt="温暖的家庭学习角"/);
  assert.match(app, /每个阶段提醒一次/);
  assert.match(app, /const confirmReminderReady = backgroundReminder && notificationPermission === "granted"/);
  assert.match(app, /准备把手机放到一旁？/);
  assert.match(app, /锁屏时也会尝试到点提醒/);
  assert.match(app, /保持页面打开会提示一次；锁屏提醒需在浏览器设置中重新允许/);
  assert.match(app, /className=\{`confirm-reminder-card \$\{confirmReminderReady \? "is-ready" : ""\}`\}/);
  assert.match(app, /aria-describedby="confirm-reminder-detail" onClick=\{\(\) => void changeBackgroundReminder\(true\)\}/);
  assert.match(styles, /\.confirm-reminder-card \{ min-height: 68px; display: grid;/);
  assert.match(styles, /\.confirm-reminder-card > button \{ min-width: 68px; min-height: 44px;/);
  assert.match(styles, /\.confirm-action-dock \{[\s\S]*?background: linear-gradient\(180deg,rgba\(255,248,236,\.985\),var\(--cream\)\);/);
  assert.match(app, /监护人授权与儿童隐私说明/);
  assert.match(app, /删除全部家庭数据/);
  assert.doesNotMatch(app, /删除孩子全部数据/);
  assert.match(app, /旧家庭的云端副本等待清理/);
  assert.match(app, /只保留随机家庭令牌作为删除凭证/);
  assert.match(app, /高熵随机家庭令牌关联/);
  assert.match(app, /令牌只经同源请求发送，不放进网址/);
  assert.match(app, /这不是账号同步：换设备、换浏览器或清除站点数据后无法找回/);
  assert.match(app, /className="storage-boundary-note"><strong>不能跨设备找回/);
  assert.match(styles, /\.storage-boundary-note \{[^}]*border: 1px solid rgba\(245,184,75,\.32\)[^}]*background: rgba\(255,249,233,\.88\)/);
  assert.match(styles, /\.privacy-storage-list p \{[^}]*font-size: var\(--type-caption\)[^}]*line-height: 1\.6/);
  assert.match(styles, /\.storage-boundary-note span \{[^}]*font-size: var\(--type-caption\)/);
  assert.match(styles, /\.privacy-transparency p \{[^}]*font-size: var\(--type-caption\)/);
  assert.match(app, /正在确认这台设备的家庭记录/);
  assert.match(app, /云端副本已更新/);
  assert.doesNotMatch(app, /云端已同步/);
  assert.doesNotMatch(app, /随机家庭 ID/);
  assert.match(app, /backLabel=\{privacyReturn === "welcome" \? "返回监护人授权页" : "返回设置页"\}/);
  assert.match(app, /backLabel=\{profileReturn === "settings" \? "返回设置页" : "返回监护人授权页"\}/);
  assert.match(app, /backLabel = "返回上一页"/);
  assert.match(app, /<Header back=\{\(\) => back\("home"\)\} title="一起安排今晚"/);
  assert.match(app, /<Header back=\{\(\) => back\("plan"\)\} title="共同确认"/);
  assert.match(app, /backLabel="返回共同确认" title="一起确认"/);
  assert.match(app, /backLabel="返回今晚进行中" title="调整今晚"/);
  assert.match(app, /backLabel="返回家庭能量房间" title="家庭期待"/);
  assert.match(app, /backLabel="返回设置页"/);
  assert.match(app, /先暂停流程，陪孩子稳定下来/);
  assert.match(app, /只记发生时间、场景、持续多久和已经尝试过什么/);
  assert.match(app, /儿童保健科、发育行为儿科、儿科或精神心理相关门诊/);
  assert.match(app, /全国统一心理援助热线 12356/);
  assert.match(app, /href="tel:12356" aria-label="拨打全国统一心理援助热线 12356"/);
  assert.match(app, /它不替代急救服务/);
  assert.match(app, /className="next-action-list"/);
  assert.doesNotMatch(app, /今晚流程已暂停/);
  assert.match(app, /xian-kaishi-plan-draft-v1/);
  assert.match(app, /xian-kaishi-live-session-v1/);
  assert.match(app, /休息也算照顾计划的一部分/);
  assert.match(app, /今晚时间表 · \$\{draftUpdatedAt \? "已自动保存" : "仅保存在这台设备"\}/);
  assert.match(app, /item\.title \?\? ""/);
  assert.match(app, /const \[editingStageId, setEditingStageId\] = useState\(""\)/);
  assert.match(app, /const activeStage = stages\[activeIndex\] \?\? stages\[0\] \?\? FALLBACK_STAGE/);
  assert.match(app, /const addNodeButtonRef = useRef<HTMLButtonElement>\(null\)/);
  assert.match(app, /focusPlanTarget\(nextStageId\)/);
  assert.match(app, /setToast\("时间表已清空，可以重新安排"\); focusPlanTarget\(\)/);
  assert.match(app, /清空时间表/);
  assert.match(app, /调整节点类型和用力程度/);
  assert.match(app, /editingStage\?\.title\.trim\(\) \|\| "这个时间节点"/);
  assert.match(app, /ref=\{addNodeButtonRef\} className="add-node-button"/);
  assert.match(app, /const MAX_PLAN_STAGES = 20/);
  assert.match(app, /title: "", icon: "custom", start: slot\.start/);
  assert.match(app, /placeholder="例如：阅读、吃饭或休息"/);
  assert.match(app, /先写下这件事，再继续安排/);
  assert.match(app, /const planNeedsTitle = planItemErrors\.some/);
  assert.match(app, /planNeedsTime \? "has-error" : ""/);
  assert.match(app, /draftReady \? openConfirmPlan\(\) : startAnotherPlan\(\)/);
  assert.match(app, /保存时间表，稍后开始/);
  assert.match(app, /const plannedStartPassed = plannedStartOffset < 0/);
  assert.match(app, /const shiftedScheduleEndLabel = addMinutes\(startNowLabel, Math\.max\(1, durationMinutes\(plannedStartLabel, draftEnd\)\)\)/);
  assert.match(app, /原定 \$\{plannedStartLabel\} 已过，整晚将顺延/);
  assert.match(app, /现在开始，整晚将比原定 \$\{plannedStartLabel\} 前移/);
  assert.match(app, /从现在一起开始，时间整体顺延/);
  assert.match(app, /现在一起开始，时间整体前移/);
  assert.match(app, /事项预计 \{formatPlanClock\(draftEnd, data\.planStart, data\.planEnd\)\} 结束 · 可用时间到/);
  assert.match(styles, /\.confirm-timing-note\.is-late/);
  assert.match(app, /时间表会留在首页/);
  assert.match(styles, /@media \(max-width: 900px\) and \(max-height: 640px\) \{[\s\S]*?\.confirm-action-dock \{ position: sticky; bottom: 0;[^}]*grid-template-columns: minmax\(0,1fr\) 106px/);
  assert.match(styles, /\.confirm-action-dock \.confirm-secondary-action \{[^}]*min-height: 50px[^}]*font-size: 11px/);
  assert.doesNotMatch(styles, /\.confirm-action-dock, \.reward-save-dock \{ position: static/);
  assert.doesNotMatch(styles, /\.plan-balance\.needs-input/);
  assert.match(styles, /\.stage-editor\.needs-title/);
  assert.match(styles, /\.confirm-secondary-action/);
  assert.match(app, /stages\.length >= MAX_PLAN_STAGES/);
  assert.match(app, /今晚最多保留\$\{MAX_PLAN_STAGES\}个节点/);
  assert.match(app, /id="plan-node-guidance"/);
  assert.match(app, /继续添加今晚要做的事；时间和顺序随时可改/);
  assert.match(styles, /\.add-node-button:disabled/);
  assert.match(app, /className=\{`plan-next-dock \$\{planHasErrors \? "needs-fix" : "is-ready"\}`\}/);
  assert.match(app, /aria-label="安排进度与下一步"/);
  assert.match(app, /完成必要信息后即可确认/);
  assert.match(app, /一起确认今晚时间表/);
  assert.match(app, /onClick=\{planHasErrors \? focusFirstPlanIssue : openConfirmPlan\}/);
  assert.match(app, /定位到需要补充的位置/);
  assert.doesNotMatch(app, /disabled=\{planHasErrors\}/);
  assert.match(app, /const planTimeIssue = availableMinutes <= 0/);
  assert.match(app, /className=\{`plan-balance \$\{planNeedsTime \? "has-error" : ""\}`\}/);
  assert.match(app, /querySelector<HTMLInputElement>\("\[data-stage-title\]"\)/);
  assert.match(app, /querySelector<HTMLInputElement>\('input\[type="time"\]\[aria-invalid="true"\]'\)/);
  assert.match(styles, /\.plan-next-dock \{ position: sticky;[^}]*top: max\(8px, env\(safe-area-inset-top\)\)/);
  assert.match(styles, /\.phone-shell\.is-offline \.plan-next-dock \{ top: calc\(max\(8px, env\(safe-area-inset-top\)\) \+ 52px\)/);
  assert.doesNotMatch(app, /下一步：一起确认/);
  assert.match(app, /!e\.nativeEvent\.isComposing/);
  assert.doesNotMatch(app, /e\.currentTarget\.blur\(\); setEditingStageId\(""\)/);
  assert.match(app, /本项延长 \$\{delta\} 分钟，后续时间已顺延/);
  assert.match(app, /本项\$\{delta > 0 \? "后移" : "前移"\}/);
  assert.match(app, /onChange=\{e => updateStageStart\(stage\.id, e\.target\.value\)\}/);
  assert.match(app, /stageTimeEditRef = useRef/);
  assert.match(app, /onFocus=\{\(\) => beginStageTimeEdit\(stage\.id, "start"\)\}/);
  assert.match(app, /endStageTimeEdit\(stage\.id, "start", e\.currentTarget\.value\)/);
  assert.match(app, /这项的时间还没选好，已恢复刚才的安排/);
  assert.match(app, /const baseline = timeEditBaseline\(id, "end"\)/);
  assert.match(app, /调整\$\{stageName\}时长：当前\$\{durationMinutes\(stage\.start, stage\.end\)\}分钟/);
  assert.match(app, /\[1,5,10,15,20,30\]\.map/);
  assert.match(app, /1分钟\\n启动/);
  assert.match(app, /选择后会保留后续节点的间隔一起移动/);
  assert.match(styles, /\.stage-meta \{[^}]*grid-template-columns: repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.task-duration-scale \{[^}]*grid-template-columns: repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(app, /const activeUndoNotice = nightResetUndo/);
  assert.match(app, /const \[clearedPlanUndo, setClearedPlanUndo\] = useState<ClearedPlanUndo \| null>\(null\)/);
  assert.match(app, /setClearedPlanUndo\(\{ stages: snapshot, editingStageId, planStart: data\.planStart, planEnd: data\.planEnd \}\)/);
  assert.match(app, /setTimeout\(\(\) => setClearedPlanUndo\(null\), 30000\)/);
  assert.match(app, /label: "恢复刚才清空的整晚计划"/);
  assert.match(app, /message: `已清空 \$\{clearedPlanUndo\.stages\.length\} 个时间节点`/);
  assert.match(app, /setToast\(`已恢复 \$\{undo\.stages\.length\} 个时间节点`\)/);
  assert.match(app, /const updatePlanStart = \(start: string\) =>/);
  assert.match(app, /applyPlanTimes\(shiftTimedItemsFrom\(baselineTimes, 0, delta\)\)/);
  assert.match(app, /planStart: baselineStart/);
  assert.match(app, /ref=\{planStartInputRef\}/);
  assert.match(app, /planStartInputRef\.current\?\.focus\(\)/);
  assert.match(app, /endPlanWindowEdit\("start", e\.currentTarget\.value\)/);
  assert.match(app, /时间还没选好，已恢复刚才的安排/);
  assert.match(app, /修改开始时间，后续节点会保持间隔一起移动/);
  assert.match(styles, /\.window-shift-note \{[^}]*font-size: var\(--type-micro\)/);
  assert.match(app, /className="home-plan-cta"/);
  assert.match(app, /findPlanInsertionSlot\(data\.planStart, data\.planEnd, stages\)/);
  assert.match(app, /moveTimedItemPreservingGaps\(stages, index, target, data\.planStart\)/);
  assert.match(app, /已调换顺序，原来的时间空档保持不变/);
  assert.match(app, /swapNextPendingItems\(stages, activeIndex, data\.planStart\)/);
  assert.match(app, /后两项已调换，原来的休息空档还在/);
  assert.match(app, /当前事项明天再做/);
  assert.match(app, /deferNextPendingItem\(stages, activeIndex\)/);
  assert.match(app, /这一段结束后即可收尾并保存/);
  assert.match(app, /一起确认调整/);
  assert.match(app, /今晚已经排满，先留出至少5分钟再增加/);
  assert.match(app, /setDeletedStage\(null\);\s+setShiftedPlanUndo\(null\);\s+setClearedPlanUndo\(null\);\s+setFollowUpPlanMessage\(""\);\s+const id = createId\("stage"\)/);
  assert.doesNotMatch(app, /className="draft-summary"/);
  assert.match(app, /const startAnotherPlan = \(\) => \{/);
  assert.match(app, /rebaseFollowUpPlan\(data\.planStart, data\.planEnd, stages, nowTime\)/);
  assert.match(app, /className="follow-up-plan-note" role="status"/);
  assert.match(app, /setFollowUpPlanMessage\(followUp\.items\.length/);
  assert.match(app, /剩余事项保留原时长和顺序，收尾仍是 \$\{followUp\.planEnd\}/);
  assert.match(styles, /\.follow-up-plan-note \{[^}]*min-height: 58px/);
  assert.match(styles, /\.home-plan-cta \{[^}]*min-height: 92px/);
  assert.match(styles, /@media \(max-width: 900px\) and \(max-height: 700px\) \{[\s\S]*?\.running-action-dock:not\(\.due-action-dock\)/);
  assert.match(styles, /\.running-action-dock:not\(\.due-action-dock\) \{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(styles, /\.running-action-dock:not\(\.due-action-dock\) \.primary-button,[\s\S]*?min-height: 48px/);
  assert.match(styles, /@media \(max-width: 900px\) and \(max-height: 640px\) \{[\s\S]*?\.active-stage-card\.is-due/);
  assert.match(styles, /\.due-action-dock \{ position: sticky/);
  assert.match(styles, /\.family-agreement strong \{[^}]*-webkit-line-clamp: 2/);
  assert.match(app, /const \[confirmPlanExpanded, setConfirmPlanExpanded\]/);
  assert.match(app, /const visibleConfirmStages = confirmPlanExpanded \? confirmStages : confirmStages\.slice\(0, 4\)/);
  assert.match(app, /aria-labelledby="confirm-plan-heading"/);
  assert.match(app, /id="confirm-plan-list"/);
  assert.match(app, /先从这里开始 ·/);
  assert.match(app, /查看其余 \$\{confirmStages\.length - 4\} 个节点/);
  assert.match(app, /aria-expanded=\{confirmPlanExpanded\}/);
  assert.match(styles, /\.confirm-plan-overview \{/);
  assert.match(styles, /\.confirm-plan-copy strong \{[^}]*-webkit-line-clamp: 2/);
  assert.doesNotMatch(app, /className="first-stage-confirm"/);
  assert.match(styles, /\.home-plan-copy em \{[^}]*white-space: normal[^}]*-webkit-line-clamp: 2/);
  assert.match(styles, /\.live-resume-card > span:not\(\.live-pulse\) \{ min-width: 0/);
  assert.match(styles, /\.live-resume-card strong \{[^}]*overflow-wrap: anywhere[^}]*-webkit-line-clamp: 2/);
  assert.match(styles, /\.stage-summary-copy strong \{[^}]*-webkit-line-clamp: 2/);
  assert.match(styles, /\.stage-summary-copy small \{[^}]*line-height: 1\.35/);
  assert.match(styles, /\.press-zone > strong \{[^}]*white-space: normal[^}]*-webkit-line-clamp: 2/);
  assert.match(app, /activeNightLabel\}等待共同收尾/);
  assert.match(app, /确认完成情况，保存今晚的记录和能量/);
  assert.match(app, /哪些数据保存在哪里/);
  assert.match(app, /当前版本仅供受邀家庭试用，请不要转发测试入口/);
  assert.match(app, /增加监护人登录与家庭访问保护；如果无法做到，就停止保存云端副本/);
  assert.match(app, /最多保留最近730次晚间收尾和120次期待实现/);
  assert.match(app, /const MAX_SESSION_RECORDS = 730/);
  assert.match(app, /const MAX_REWARD_HISTORY = 120/);
  assert.doesNotMatch(app, /\.slice\(0, 60\)/);
  assert.match(app, /family: data, planDraft, activeSession/);
  assert.match(app, /energy: 0,/);
  assert.match(app, /setPlanHydrated\(false\).*setFamilyId\(""\)/);
  assert.match(app, /aria-current=\{screen === id \? "page"/);
  assert.doesNotMatch(app, /PlanningMode|planningMode|data\.arrival|通常到家/);
  assert.match(app, /const homeContextLabel = liveSessionAvailable/);
  assert.match(app, /今天的计划已记录/);
  assert.match(app, /家庭晚间 · 共同约定/);
  assert.match(app, /const homeHeroCopy = liveSessionAvailable/);
  assert.match(app, /今晚正在按计划进行/);
  assert.match(app, /进度已经保存；继续执行、调整或结束本次计划/);
  assert.match(app, /已存入家庭日历/);
  assert.match(app, /className="empty-plan empty-plan-action"/);
  assert.match(app, /增加第一个时间节点/);
  assert.match(app, /stages\.length > 0 && <button ref=\{addNodeButtonRef\} className="add-node-button"/);
  assert.match(app, /已移除“\$\{deletedStage\.stage\.title\.trim\(\) \|\| "未命名事项"\}”/);
  assert.match(app, /已恢复“\$\{stage\.title\.trim\(\) \|\| "未命名事项"\}”/);
  assert.match(app, /resumeTonightFromWrap/);
  assert.match(app, /还想继续今晚/);
  assert.match(app, /const settlementFooter = settlementFooterCopy\(priorSettlementSessions\.length, hasDeferredStages\)/);
  assert.match(app, /promptReflection \? settlementFooter : `执行感受可以不填 · \$\{settlementFooter\}`/);
  assert.match(app, /if \(profileReturn === "settings"\) back\("settings"\); else go\("plan", "replace"\)/);
  assert.match(app, /保存并安排今晚/);
  assert.match(app, /className=\{`consent-row \$\{consent \? "is-checked" : ""\}`\}/);
  assert.match(app, /我已确认自己是监护人/);
  assert.match(app, /继续设置家庭称呼/);
  assert.match(app, /const profileActionLabel = profileReady/);
  assert.match(app, /profile-continue-button \$\{profileReady \? "is-ready" : "needs-input"\}/);
  assert.doesNotMatch(app, /disabled=\{!data\.childAlias\.trim\(\) \|\| !data\.guardianAlias\.trim\(\)\}/);
  assert.match(app, /target\?\.scrollIntoView\(\{ block: "center", behavior: motionReduced \? "auto" : "smooth" \}\)/);
  assert.match(app, /persist\(next, profileReturn === "settings" \? "家庭设置已更新" : undefined\)/);
  assert.doesNotMatch(app, /家庭称呼已保存，可以安排今晚了/);
  assert.match(app, /今晚，怎么称呼彼此？/);
  assert.doesNotMatch(styles, /\.profile-preferences/);
  assert.match(app, /undoRemoveStage/);
  assert.match(app, /setDeletedStage\(null\), 8000/);
  assert.match(app, /data-screen-heading/);
  assert.match(app, /预计到时间了，可以完成、继续或调整/);
  assert.match(app, /const startRestNow/);
  assert.match(app, /到时间只是提醒，不代表必须完成/);
  assert.match(app, /role="group" aria-label="到点后的选择"/);
  assert.match(app, /休息后再试 10 分钟/);
  assert.match(styles, /\.due-action-grid \{[^}]*grid-template-columns: 1fr 1fr/);
  assert.match(styles, /\.due-choice-button \{[^}]*min-height: 66px/);
  assert.match(app, /再继续 10 分钟/);
  assert.match(app, /先休息 10 分钟/);
  assert.match(app, /setTransitionReason\("completed"\)/);
  assert.match(app, /className=\{`transition-result/);
  assert.match(app, /type StageAdvanceUndo = \{ stages: Stage\[\]; planEnd: string/);
  assert.match(app, /setStageAdvanceUndo\(\{ stages: stages\.map/);
  assert.match(app, /const undoContinueToNext = \(\) =>/);
  assert.match(app, /setStageAdvanceUndo\(null\), 12000/);
  assert.match(app, /const openAdjust = \(\) => \{ setStageAdvanceUndo\(null\)/);
  assert.match(app, /setActiveEndsAt\(stageAdvanceUndo\.activeEndsAt\)/);
  assert.match(app, /planEnd: stageAdvanceUndo\.planEnd/);
  assert.match(app, /已进入“\$\{stageAdvanceUndo\.nextTitle\}”/);
  assert.match(styles, /\.undo-shelf \{[\s\S]*?background: rgba\(255, 255, 255, \.94\)/);
  assert.doesNotMatch(app, /className="undo-toast/);
  assert.match(app, /const resumedCopy = result\.resumedMinutes \? `，之后再试\$\{result\.resumedMinutes\}分钟` : ""/);
  assert.match(app, /先休息10分钟\$\{resumedCopy\}；事项预计\$\{scheduledEndTime\(result\.items, result\.planEnd\)\}结束/);
  assert.match(app, /setData\(current => \(\{ \.\.\.current, planEnd: result\.planEnd \}\)\)/);
  assert.match(app, /事项预计\$\{nextScheduledEnd\}结束/);
  assert.match(app, /今晚进度 · 事项预计 \{formatPlanClock\(liveScheduledEnd, data\.planStart, data\.planEnd\)\} 结束/);
  assert.match(app, /之后只继续剩余时长/);
  assert.match(app, /休息后继续 · \$\{nextPendingDuration\}分钟/);
  assert.match(app, /stageDue \? `从现在休息10分钟，之后再试\$\{restPlanPreview\.resumedMinutes\}分钟/);
  assert.match(app, /跨到次日 · 结束时间按第二天计算/);
  assert.match(app, /const planCrossesMidnight = spansMidnight/);
  assert.match(app, /onChange=\{e => updatePlanStart\(e\.target\.value\)\}/);
  assert.match(app, /setData\(current => \(\{ \.\.\.current, planEnd: e\.target\.value \}\)\)/);
  assert.match(app, /canStartRest && <button className="soft-button" onClick=\{startRestNow\}>先休息 10 分钟<\/button>/);
  assert.match(app, /!activeStageCompleted \? \[\{ id: "extend" as const/);
  assert.match(app, /下一项前休息10分钟/);
  assert.match(app, /收尾保存后 \+\$\{activeStage\.energy\} 家庭能量/);
  assert.match(app, /disabled=\{!effectiveAdjustChoice\}/);
  assert.match(app, /remainingTimerMinutes\(activeEndsAt, startedAt\)/);
  assert.match(app, /!planHydrated \|\| LIVE_SCREENS\.includes\(screen as LiveScreen\)/);
  assert.match(app, /sessionPlanWindowRef\.current = \{ planStart: data\.planStart, planEnd: data\.planEnd \}/);
  assert.match(app, /baselinePlanStart: baseline\.planStart, baselinePlanEnd: baseline\.planEnd/);
  assert.match(app, /planStart: baseline\.planStart, planEnd: baseline\.planEnd/);
  assert.match(app, /setStages\(prepareNextRoundSchedule\(stages, completedStageTitles, baseline\.planStart\)\)/);
  assert.match(app, /legacyRestIcons/);
  assert.match(app, /promptReflection: normalizePromptReflection/);
  assert.match(app, /今晚执行感受（可选）/);
  assert.match(app, /只用于家庭复盘，不影响能量/);
  assert.match(app, /规则建议 · 不评价孩子/);
  assert.match(app, /顺畅反馈/);
  assert.match(app, /normalizeTransitionReason/);
  assert.match(app, /已经告一段落/);
  assert.match(app, /进入今晚收尾/);
  assert.match(app, /restartFromNow \? Date\.now\(\) \+ 10 \* 60_000/);
  assert.match(app, /const audioContextRef = useRef<AudioContext \| null>\(null\)/);
  assert.match(app, /tap: \[\[560, 0, \.11, \.018\]\]/);
  assert.match(app, /complete: \[\[523, 0, \.22, \.028\]/);
  assert.match(app, /playTone\("tap"\); gentleVibrate\(18\)/);
  assert.match(app, /osc\.addEventListener\("ended"/);
  assert.match(app, /osc\.disconnect\(\); gain\.disconnect\(\)/);
  assert.match(app, /轻触确认、阶段转换和收尾各有短音型/);
  assert.match(app, /const liveResumeView/);
  assert.match(app, /activeNightLabel\}计划正在调整 · 进度已保存在本机/);
  assert.match(app, /这一段已完成 · 进度已保存在本机/);
  assert.match(app, /阶段预计到时 · 只提醒一次/);
  assert.match(app, /data-state=\{liveResumeView\.state\}/);
  assert.match(app, /const nextPendingStage/);
  assert.match(app, /className="timeline-disclosure"/);
  assert.match(app, /今晚进度/);
  assert.match(app, /running-action-dock/);
  assert.match(app, /切到其他应用或锁屏时尝试提醒/);
  assert.match(app, /xian-kaishi-background-reminder-v1/);
  assert.match(app, /关闭浏览器后不承诺提醒送达/);
  assert.match(app, /xian-kaishi-family-revision-v1/);
  assert.match(app, /旧状态不会静默覆盖更新的本机记录/);
  assert.match(app, /正在合并另一处更新/);
  assert.match(app, /正在确认这台设备的家庭记录/);
  assert.match(app, /if \(validLocal\) setAppReady\(true\)/);
  assert.match(app, /catch \{ localStorage\.removeItem\(STORAGE_KEY\)/);
  assert.match(app, /finally\(\(\) => setAppReady\(true\)\)/);
  assert.match(app, /const \[rewardDraft, setRewardDraft\]/);
  assert.match(app, /const hasPastReward = data\.rewardHistory\.length > 0/);
  assert.match(app, /能量已经在积累；想好家庭时光后再一起约定/);
  assert.match(app, /先把今晚过舒服，家庭期待可以稍后再一起定/);
  assert.match(app, /一起定下想共度的家庭时光/);
  assert.match(app, /先选家庭时光，再共同商量积累节奏/);
  assert.match(app, /aria-label="家庭期待目标能量"/);
  assert.match(app, /能量快捷选择/);
  assert.match(app, /可以拖动，也可以直接点选/);
  assert.match(app, /aria-pressed=\{stage\.energy === value\}/);
  assert.match(app, /onClick=\{\(\) => go\("plan"\)\}>修改时间表/);
  assert.match(styles, /\.task-energy-scale button\.selected/);
  assert.match(app, /积累到约定点数不会自动开始新一轮/);
  assert.match(app, /家庭活动不需要与孩子的表现一一交换/);
  assert.match(app, /goalRedeemed \? ""/);
  assert.match(styles, /\.reward-idea-grid button\.selected/);
  assert.match(app, /确认已实现，开启新一轮/);
  assert.match(app, /openRewardAchieved\(true\)/);
  assert.match(app, /className="achievement-night-saved"/);
  assert.match(app, /今晚的收尾已经先保存/);
  assert.match(app, /积累到约定点数，不等于已经实现/);
  assert.match(app, /当前 \{data\.energy\} 点会完成这一轮积累/);
  assert.match(app, /energyBeforeReset: data\.energy/);
  assert.match(app, /type RewardRedeemUndo = \{ rewardId:/);
  assert.match(app, /setRewardRedeemUndo\(\{/);
  assert.match(app, /setRewardRedeemUndo\(null\), 30000/);
  assert.match(app, /const undoRedeemReward = \(\) =>/);
  assert.match(app, /restoreRewardRedemption\(data/);
  assert.match(app, /rewardHistory: undo\.rewardHistory\.map/);
  assert.match(app, /已恢复“\$\{undo\.title\}”和这一轮的\$\{undo\.energy\}点能量/);
  assert.match(app, /30秒内可以恢复原来的家庭期待和/);
  assert.match(app, /恢复这一轮/);
  assert.match(styles, /\.reward-undo-panel \{/);
  assert.match(app, /rewardRedeemCancelRef\.current\?\.focus\(\)/);
  assert.match(app, /ref=\{rewardRedeemTriggerRef\}/);
  assert.match(app, /const cancelRedeemConfirmation = \(\) =>/);
  assert.match(app, /ref=\{rewardRedeemCancelRef\}/);
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
  assert.match(app, /hiddenStageTitleCount/);
  assert.match(app, /另有 \$\{selectedSessionSummary\.hiddenStageTitleCount\} 项/);
  assert.match(app, /aria-controls="day-session-details"/);
  assert.match(styles, /\.daily-summary-stats/);
  assert.match(app, /删除这次记录/);
  assert.match(app, /aria-label=\{`删除\$\{sessionTimeLabel\(item\.date\)\}的收尾记录`\}/);
  assert.match(app, /只从日历移除，不改动当前这轮能量/);
  assert.match(app, /removeSessionAndReconcileEnergy\(data\.sessions, record\.id/);
  assert.match(app, /type SessionDeleteUndo = \{ recordId:/);
  assert.match(app, /setSessionDeleteUndo\(\{/);
  assert.match(app, /setSessionDeleteUndo\(null\), 12000/);
  assert.match(app, /const undoDeleteSessionRecord = \(\) =>/);
  assert.match(app, /sessions: undo\.sessions, energy: undo\.energy/);
  assert.match(app, /已恢复这次记录和删除前的能量/);
  assert.match(app, /data-session-delete-id=\{item\.id\}/);
  assert.doesNotMatch(app, /sessionDeleteUndoRef\.current\?\.focus\(\)/);
  assert.match(app, /撤销删除\$\{sessionDeleteUndo\.label\}的收尾记录/);
  assert.match(app, /sessionDeleteCancelRef\.current\?\.focus\(\)/);
  assert.match(app, /const cancelSessionDelete = \(recordId: string\) =>/);
  assert.match(app, /focusSessionDeleteTrigger\(recordId\)/);
  assert.match(app, /ref=\{sessionDeleteCancelRef\}/);
  assert.match(app, /const clearCurrentNightAndRestart = \(\) =>/);
  assert.match(app, /removeNightAndReconcileEnergy\(data\.sessions, currentFamilyNightKey/);
  assert.match(app, /清除今晚，重新安排/);
  assert.match(app, /清除并重新安排/);
  assert.match(app, /setTimeout\(\(\) => setNightResetUndo\(null\), 30000\)/);
  assert.match(app, /const undoNightReset = \(\) =>/);
  assert.match(app, /今晚的记录和能量已恢复/);
  assert.match(styles, /\.night-restart-confirm \{/);
  assert.match(styles, /\.record-delete-confirm \{[^}]*background: #fff6f3/);
  assert.match(app, /aria-current=\{isToday \? "date" : undefined\}/);
  assert.match(app, /className="today-jump"/);
  assert.match(styles, /\.today-jump \{[^}]*min-height: 44px/);
  assert.match(styles, /\.plan-tools button \{[^}]*min-height: 44px/);
  assert.match(styles, /\.confirm-plan-heading button \{[^}]*min-height: 44px/);
  assert.match(styles, /\.due-choice-button \{[^}]*min-height: 66px/);
  assert.match(styles, /\.transition-actions \.text-button \{[^}]*min-height: 44px/);
  assert.match(styles, /\.redeem-confirm \.text-button \{[^}]*min-height: 44px/);
  assert.doesNotMatch(styles, /\.order-actions/);
  assert.match(styles, /\.calendar-grid > button\.is-today/);
  assert.match(app, /最迟到次日清晨5点自动失效/);
  assert.match(app, /nightKey: \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\//);
  assert.match(app, /<strong>今晚已记录<\/strong>/);
  assert.match(app, /再安排一轮会保留今晚记录；清除后可在 30 秒内恢复/);
  assert.match(app, /item\.nightKey===key/);
  assert.match(app, /selectedIncludesAfterMidnightSession/);
  assert.match(app, /晚间记录 · 凌晨收尾仍归这一晚/);
  assert.match(app, /familyNightDisplayLabel\(lastSavedSession\.nightKey, lastSavedSession\.date\)/);
  assert.match(app, /openCalendar=\{\(\) => openCalendar\(currentFamilyNightKey\)\}/);
  assert.doesNotMatch(app, /const cooperationEnergy = 2/);
  assert.match(styles, /\.settled-home-card/);
  assert.match(app, /规则建议 · 不评价孩子/);
  assert.match(app, /只使用本周完成、主动调整和大人的执行感受记录/);
  assert.match(app, /有记录的夜晚和已实现的期待会留在这里/);
  assert.match(app, /这一天没有留下记录/);
  assert.match(app, /日历不要求每天使用/);
  assert.match(app, /还没有本周记录，所以先从一份最短共同计划开始/);
  assert.doesNotMatch(app, /每天收尾和家庭期待都会留在这里/);
  assert.doesNotMatch(app, /这一天还没有记录/);
  assert.match(app, /这周只试这一件 · 给大人的提醒/);
  assert.match(app, /weekKey: weekStartKey/);
  assert.match(styles, /\.one-change-card/);
  assert.match(app, /未完成或暂停不会倒扣、过期/);
  assert.match(app, /保存记录并结束今晚/);
  assert.match(app, /本次新增能量/);
  assert.match(app, /completionUnit: record\.completionUnit === "tasks" \? "tasks" : "nodes"/);
  assert.match(app, /completedCount, completionUnit: "tasks"/);
  assert.match(app, /currentNightSummary\.completionUnit === "tasks" \? "完成事项" : "完成节点"/);
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
  assert.match(styles, /mascot-ready 4\.8s ease-in-out var\(--ambient-cycles\)/);
  assert.match(styles, /@keyframes mascot-ready/);
  assert.match(styles, /halo-breathe 3s ease-in-out var\(--ambient-cycles\)/);
  assert.match(styles, /mascot-nod 2\.8s ease-in-out 2/);
  assert.match(styles, /mascot-listen 3\.4s ease-in-out 2/);
  assert.match(styles, /--attention-cycles: 3/);
  assert.match(styles, /mascot-breathe 3\.6s ease-in-out var\(--ambient-cycles\)/);
  assert.match(styles, /live-soft-pulse 2\.8s ease-in-out var\(--attention-cycles\)/);
  assert.match(styles, /due-gentle 1\.8s ease-in-out var\(--attention-cycles\)/);
  assert.deepEqual(styles.match(/animation:[^;{}]+infinite/g), ["animation: loading-leaf 1.35s ease-in-out infinite"]);
  assert.match(styles, /room-drift 10s ease-in-out var\(--ambient-cycles\) alternate/);
  assert.match(styles, /room-light 5\.5s ease-in-out var\(--ambient-cycles\)/);
  assert.doesNotMatch(styles, /breathing-ring|ring-breathe/);
  assert.match(styles, /mascot-celebrate 1\.9s var\(--ease-out-soft\) 2/);
  assert.match(styles, /spark-pop 1\.9s ease-out 2/);
  assert.match(styles, /energy-rise 2\.4s ease-out 2/);
  assert.match(styles, /\.bottom-nav button \{[^}]*color: #626965/);
  assert.match(styles, /\.bottom-nav button\.active \{ color: #80550f; background:/);
  assert.match(app, /aria-current=\{screen === id \? "page" : undefined\}/);
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
  assert.match(styles, /\.phone-shell \.primary-button, \.phone-shell \.secondary-button \{ min-height: 56px; \}/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /transition-duration: \.001ms !important/);
  assert.match(app, /也会跟随系统设置/);
  assert.match(app, /减少动态与触感/);
  assert.match(styles, /\.reduce-motion \.launch-progress \{ display: none; \}/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.launch-progress \{ display: none; \}/);
  assert.match(app, /navigator\.serviceWorker\.register\("\/sw\.js"\)/);
  assert.match(app, /requestIdleCallback\(registerServiceWorker, \{ timeout: 2500 \}\)/);
  assert.match(app, /window\.setTimeout\(registerServiceWorker, 1200\)/);
  assert.match(app, /document\.readyState === "complete"/);
  assert.match(app, /useSyncExternalStore\(subscribeToNetworkStatus/);
  assert.match(app, /useSyncExternalStore\(subscribeToReducedMotion/);
  assert.match(app, /query\.addEventListener\("change", onChange\)/);
  assert.match(app, /const motionReduced = data\.reducedMotion \|\| systemReducedMotion/);
  assert.match(app, /behavior: motionReduced \? "auto" : "smooth"/);
  assert.match(app, /site-shell \$\{motionReduced \? "reduce-motion"/);
  assert.match(styles, /\.site-shell\.reduce-motion \*,[\s\S]*?animation-duration: \.001ms !important;[\s\S]*?transition-duration: \.001ms !important/);
  assert.match(styles, /\.site-shell\.reduce-motion \.launch-progress \{ display: none; \}/);
  assert.match(app, /已跟随系统减少动画、页面自动滑动和轻触震动/);
  assert.match(app, /aria-describedby="motion-preference-status"/);
  assert.match(app, /id="background-reminder-status"[\s\S]*?role="status" aria-live="polite"/);
  assert.match(app, /className="sync-label" role="status" aria-live="polite"/);
  assert.doesNotMatch(app, /本机更新已补同步/);
  assert.match(app, /\(\) => navigator\.onLine, \(\) => true/);
  assert.doesNotMatch(app, /useState\(\(\) => typeof navigator/);
  assert.match(app, /window\.addEventListener\("offline", handleOffline\)/);
  assert.match(app, /网络已恢复 · 已合并并更新副本/);
  assert.match(app, /离线使用中/);
  assert.match(app, /xian-kaishi-pending-cloud-delete-v1/);
  assert.match(app, /pendingWritesRef\.current\.drain\(\)/);
  assert.match(app, /pendingWritesRef\.current\.track\(syncPromise\)/);
  assert.doesNotMatch(app, /track\(fetch\(/);
  assert.match(app, /deleteInProgressRef\.current\) return/);
  assert.match(app, /联网后继续清理云端副本/);
  assert.match(app, /只暂存随机家庭令牌；联网后自动重试/);
  assert.match(styles, /\.phone-shell\.is-offline \.screen \{ padding-top:/);
  assert.match(app, /共同商量能量/);
  assert.match(app, /先写下事项名称/);
  assert.match(app, /先定名称、时间和完成能量/);
  assert.match(app, /className={`energy-detail-toggle/);
  assert.match(app, /aria-expanded={editingEnergyStageId === stage.id}/);
  assert.match(app, /editingEnergyStageId === stage.id &&/);
  assert.match(app, /className="task-energy-range branded-range"/);
  assert.match(app, /type="range" min="0" max="5"/);
  assert.match(app, /aria-valuetext=\{stageEnergyLabel\(stage\.energy\)\}/);
  assert.match(app, /aria-label=\{`调整\$\{stageName\}完成后的家庭能量：\$\{stageEnergyLabel\(stage\.energy\)\}`\}/);
  assert.match(app, /\[0,1,2,3,4,5\]/);
  assert.match(app, /这一项不计能量/);
  assert.match(app, /energy: 0[^\n]+kind: "rest"/);
  assert.match(styles, /\.task-energy-scale \{[^}]*repeat\(6,1fr\)/);
  assert.match(styles, /\.task-energy \{ grid-column: 1 \/ -1/);
  assert.match(styles, /\.energy-detail-toggle\[aria-expanded="true"\]/);
  assert.match(styles, /\.active-energy\.is-zero/);
  assert.match(app, /rewardThresholdBounds\(data\.energy\)/);
  assert.match(app, /const reviseRewardDraft = \(patch: Partial<RewardGoal>\)/);
  assert.match(app, /setRewardEnergyConfirmed\(false\)/);
  assert.match(app, /约定有变化，请两个人再确认一次/);
  assert.match(app, /ref=\{rewardDateInputRef\} name="reward-date"/);
  assert.match(app, /rewardEnergyConfirmRef\.current\?\.focus\(\)/);
  assert.match(app, /ref=\{rewardEnergyConfirmRef\} type="checkbox"/);
  assert.match(app, /没有截止时间、不要求连续使用，也不用为了更快达成临时加码/);
  assert.doesNotMatch(app, /rewardEstimatedNights/);
  assert.match(app, /const rewardDraftActionLabel = rewardDraftReady/);
  assert.match(app, /ref=\{rewardTitleInputRef\} name="reward-title"/);
  assert.match(app, /rewardTitleInputRef\)\.current/);
  assert.match(app, /rewardEnergyConfirmRef\.current\?\.scrollIntoView/);
  assert.doesNotMatch(app, /disabled=\{!rewardDraftReady\}/);
  assert.match(styles, /\.reward-save-dock \.needs-input/);
  assert.match(app, /onClick=\{\(\) => openNightRecord\(localDateKey\(lastRedeemedReward\.redeemedAt\)\)\}/);
  assert.doesNotMatch(app, /const day = localDateKey\(lastRedeemedReward\.redeemedAt\)/);
  assert.match(app, /max=\{rewardMaximumThreshold\}/);
  assert.match(styles, /\.branded-range::-webkit-slider-runnable-track/);
  assert.match(styles, /height: min\(860px, calc\(100vh - 68px\)\)/);
  assert.match(styles, /\.availability-card \.mascot \{ display: none; \}/);
  assert.match(styles, /\.stage-actions \{ grid-column: 1 \/ -1; grid-row: 2; grid-template-columns: repeat\(3,1fr\); \}/);
  assert.match(styles, /\.stage-meta \{ grid-template-columns: repeat\(3,minmax\(0,1fr\)\); \}/);
  assert.match(app, /`任务 · \$\{effortCopy\[stage\.effort\]\}`/);
  assert.match(app, /className="effort-compact"/);
  assert.match(styles, /\.reward-idea-grid small \{ display: none; \}/);
  assert.match(styles, /\.step-pill \{[^}]*white-space: nowrap/);
  assert.match(styles, /\.welcome-hero \{ grid-template-columns: minmax\(0,1fr\) 76px/);
  assert.match(styles, /\.next-action-list li/);
  assert.match(styles, /\.support-line \{/);
  assert.match(styles, /\.toggle-row input \{[^}]*flex: 0 0 48px;[^}]*min-width: 48px/);
  assert.match(styles, /\.settings-screen \.toggle-row,[^\n]+scroll-margin-bottom: 128px/);
  assert.match(styles, /\.support-call \{[^}]*min-height: 52px/);
  assert.match(styles, /@media \(max-width: 900px\) and \(max-height: 640px\)/);
  assert.match(styles, /\.active-stage-card\.is-due \{ min-height: 0/);
  assert.match(styles, /\.wrap-action-dock \{ position: sticky; bottom: 0; display: grid/);
  assert.match(app, /className="energy-summary settlement-breakdown"/);
  assert.match(app, /执行感受可以不填/);
  assert.match(app, /<h1>今晚已保存<\/h1>/);
  assert.match(styles, /\.night-saved-screen \.saved-actions \{ position: sticky; bottom: 0/);
  assert.match(styles, /\.achievement-screen \.achievement-actions \{ position: sticky; bottom: 0/);
  assert.match(styles, /\.achievement-screen \.redeem-confirm \{ position: sticky; bottom: 0/);
  assert.match(styles, /\.reward-saved-screen \.saved-actions \{ position: sticky; bottom: 0/);
  assert.match(app, /这份期待，<br \/>已经实现/);
  assert.match(styles, /\.effort-screen \.effort-options \{ grid-template-columns: repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.effort-screen \.rest-duration > div\.has-custom-duration \{ grid-template-columns: repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.effort-screen > \.primary-button \{ position: sticky; bottom: 0/);
  assert.match(styles, /\.profile-action-dock \{ position: static; margin-top: 10px; \}/);
  assert.match(styles, /\.welcome-action-dock \{ position: sticky; bottom: 0; margin: auto -4px -22px;/);
  assert.match(styles, /\.welcome-flow small \{ display: none; \}/);
  assert.match(styles, /\.welcome-action-dock > small \{ display: none; \}/);
  assert.match(styles, /\.consent-row\.is-checked/);
  assert.match(styles, /@keyframes consent-ready/);
  assert.match(styles, /\.welcome-screen \{ padding: 14px 18px 22px; \}/);
  assert.match(styles, /\.welcome-hero \{ grid-template-columns: minmax\(0,1fr\) 72px; gap: 4px; \}/);
  assert.match(styles, /\.welcome-boundary > button \{ min-height: 44px;[^}]*padding-top: 5px; \}/);
  assert.match(styles, /\.welcome-action-dock \.primary-button \{ min-height: 50px;[^}]*font-size: 15px; \}/);
  assert.match(styles, /\.profile-screen \{ padding-top: 14px; padding-bottom: 16px; \}/);
  assert.match(styles, /\.profile-essential input \{[^}]*min-height: 48px;[^}]*font-size: 16px; \}/);
  assert.match(styles, /\.profile-action-dock \.primary-button \{ min-height: 50px;[^}]*font-size: 15px; \}/);
  assert.match(styles, /\.reward-save-dock \{ position: static; margin-top: 10px; \}/);
  assert.match(styles, /\.undo-shelf \{[\s\S]*?z-index: 45/);
  assert.match(app, /`\$\{startNowLabel\}—\$\{dualFirstEndLabel\}`/);
  assert.match(app, /`现在开始 · 预计 \$\{formatPlanClock\(shiftedScheduleEndLabel/);
  assert.doesNotMatch(app, /整晚时间会一起顺延/);
  assert.match(app, /const cleanStages = stages\.map/);
  assert.match(app, /shiftTimedPlanToStart\(cleanStages, actualStart\)/);
  assert.match(app, /const DUAL_START_DELAY_MS = 3200/);
  assert.match(app, /setTimeout\(startPlan, DUAL_START_DELAY_MS\)/);
  assert.match(app, /const enterDualStart = \(\) => \{ setGuardianConfirmed\(false\)/);
  assert.match(app, /const \[dualStartPaused, setDualStartPaused\] = useState\(false\)/);
  assert.match(app, /const dualFirstStage = stages\[0\] \?\? FALLBACK_STAGE/);
  assert.match(app, /一起确认，<br \/>然后出发/);
  assert.match(app, /className="start-contract-meta"/);
  assert.match(styles, /\.start-contract-meta \{/);
  assert.match(app, /const calendarDetailRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(app, /const selectCalendarDay = \(key: string\) =>/);
  assert.match(app, /calendarDetailRef\.current\?\.scrollIntoView\(\{ block: "start", behavior: motionReduced \? "auto" : "smooth" \}\)/);
  assert.match(app, /onClick=\{\(\) => selectCalendarDay\(key\)\}/);
  assert.match(app, /ref=\{calendarDetailRef\} key=\{selectedDay\} className="day-detail"/);
  assert.match(app, /className="day-detail-header" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(styles, /\.day-detail \{[^}]*scroll-margin-top: 12px;[^}]*animation: day-detail-arrive/);
  assert.match(styles, /max-height: 700px[\s\S]*?\.review-screen \.review-insight p \{ display: none; \}/);
  assert.match(styles, /max-height: 700px[\s\S]*?\.review-screen \.month-nav h1 \{ font-size: 26px; \}/);
  assert.match(styles, /max-height: 700px[\s\S]*?\.review-screen \.calendar-card \{ padding: 6px 7px; \}/);
  assert.match(styles, /max-height: 700px[\s\S]*?\.running-screen \.active-stage-card:not\(\.is-due\) \{[^}]*grid-template-columns: 68px minmax\(0,1fr\)/);
  assert.match(styles, /\.running-screen \.active-stage-card:not\(\.is-due\) h1 \{[^}]*font-size: 22px;[^}]*-webkit-line-clamp: 3;/);
  assert.match(styles, /\.running-screen \.active-stage-card:not\(\.is-due\) \.stage-timer \{ padding-top: 8px; \}/);
  assert.match(app, /className=\{`adjust-decision-dock \$\{effectiveAdjustChoice \? "is-ready" : "is-waiting"\}`\}/);
  assert.match(app, /aria-label="调整预览与确认"/);
  assert.match(app, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(app, /确认前不会改动 · 调整不扣能量 · 已完成进展会保留/);
  assert.match(styles, /\.adjust-decision-dock\.is-ready \.change-preview/);
  assert.match(styles, /\.adjust-screen \{ padding-bottom: calc\(176px \+ env\(safe-area-inset-bottom\)\); animation-fill-mode: none; \}/);
  assert.match(styles, /\.adjust-decision-dock \{ position: fixed;[^}]*bottom: 0;[^}]*width: min\(560px, calc\(100% - 36px\)\)/);
  assert.match(styles, /\.adjust-decision-dock\.is-waiting \.change-preview \{ min-height: 44px; padding: 6px 9px; \}/);
  assert.match(styles, /\.adjust-decision-dock\.is-waiting \.change-preview small,[\s\S]*?\.adjust-decision-dock\.is-waiting \.adjust-safety-note \{ display: none; \}/);
  assert.match(app, /if \(screenRef\.current === "dual-start" && next !== "dual-start"\)/);
  assert.match(app, /已经停住，可以再商量一下/);
  assert.match(app, /const guardianConfirmRef = useRef<HTMLButtonElement>\(null\)/);
  assert.match(app, /const launchCancelRef = useRef<HTMLButtonElement>\(null\)/);
  assert.match(app, /target\?\.scrollIntoView\(\{ block: "end", behavior: motionReduced \? "auto" : "smooth" \}\)/);
  assert.match(app, /target\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(app, /ref=\{launchCancelRef\} type="button" className="launch-cancel-button"/);
  assert.match(app, /ref=\{guardianConfirmRef\} aria-describedby="dual-start-status dual-touch-privacy"/);
  assert.match(app, /约 3 秒后进入/);
  assert.match(styles, /animation: launch-orbit 3\.2s linear both/);
  assert.match(app, /className="energy-link" data-guardian-ready=\{guardianConfirmed\} data-child-ready=\{childConfirmed\}/);
  assert.match(app, /约定已连接/);
  assert.match(styles, /@keyframes energy-core-connect/);
  assert.match(styles, /@keyframes lamp-power-on/);
  assert.match(app, /const adjustReturnScreen: LiveScreen = activeStage\.status === "done" \? "transition" : "running"/);
  assert.match(app, /pendingAfterActiveCount >= 2 \? \[\{ id: "swap" as const/);
  assert.match(app, /pendingAfterActiveCount >= 1 \? \[\{ id: "tomorrow" as const/);
  assert.match(app, /当前阶段 · \{activeTonightOrdinal\}\/\{tonightStageCount\}/);
  assert.match(app, /这里只记录一次点击，不读取或保存指纹/);
  assert.match(app, /className="fingerprint-ridges"/);
  assert.match(styles, /\.fingerprint-ridges i:nth-child\(5\)/);
  assert.match(styles, /\.dual-start-hero h1 \{[\s\S]*?font-size: 34px/);
  assert.match(styles, /\.press-zone \{[\s\S]*?min-height: 206px/);
  assert.match(app, /可以同时点，也可以轮流点/);
  assert.match(app, /className="launch-cancel-button"/);
  assert.match(app, /className="launch-status-copy"/);
  assert.match(app, /点“先等等”就会停住/);
  assert.match(app, /aria-live="polite" aria-atomic="true"/);
  assert.match(styles, /@keyframes launch-orbit/);
  assert.match(styles, /@media \(max-width: 380px\) and \(max-height: 640px\)[\s\S]*?\.press-zone \{ min-height: 132px/);
  assert.match(app, /activeStage\.kind === "rest" \? "休息放松"/);
  assert.match(app, /点错了，回到这一段/);
  assert.match(app, /这一段已经做完/);
  assert.doesNotMatch(app, /提前完成这一阶段/);
  assert.match(app, /planStart: data\.planStart, planEnd: data\.planEnd, stages/);
  assert.match(app, /planStart: livePlanStart \|\|/);
  assert.match(app, /screen !== "dual-start"/);
  assert.match(app, /Notification\.requestPermission/);
  assert.match(app, /registration\.showNotification\(title, options\)/);
  assert.match(app, /new Notification\(title, options\)/);
  assert.match(app, /打开后再看具体安排/);
  assert.doesNotMatch(app, /body: `\$\{activeStage\.title\}/);
  assert.match(app, /window\.addEventListener\("focus", refreshNotificationPermission\)/);
  assert.match(app, /document\.addEventListener\("visibilitychange", refreshNotificationPermission\)/);
  assert.match(app, /setNotificationPermission\(Notification\.permission\)/);
  assert.match(app, /dueReminderPlayed\.current = restoredStageDue/);
  assert.match(app, /正在等待浏览器授权/);
  assert.match(app, /没有确认前不会开启/);
  assert.match(app, /aria-busy=\{requestingNotificationPermission \|\| undefined\}/);
  assert.match(styles, /\.permission-pending \{[^}]*background: rgba\(255,248,225,\.78\)/);
  assert.match(app, /如需后台提醒，请在浏览器设置中重新允许/);
  assert.match(app, /切到其他应用或锁屏时尝试提醒/);
  assert.match(serviceWorker, /notificationclick/);
  assert.match(serviceWorker, /clients\.matchAll\(\{ type: "window", includeUncontrolled: true \}\)/);
  assert.match(serviceWorker, /existing\.focus\(\)/);
  assert.match(serviceWorker, /clients\.openWindow\(targetUrl\)/);
  assert.match(app, /应用保持打开时，切到其他应用或锁屏会尝试提醒；省电模式可能延迟/);
  assert.match(app, /关闭页面后不会送达/);
  assert.match(app, /const softLanding = shouldShowSoftLanding\(remainingSeconds, stageDue\)/);
  assert.match(app, /完成今晚计划/);
  assert.match(app, /下一步先看一眼/);
  assert.match(app, /role="progressbar" aria-label=\{`\$\{activeStage\.title\}剩余时间`\}/);
  assert.match(styles, /\.active-stage-card\.is-landing/);
  assert.match(styles, /@keyframes soft-landing-arrive/);
  assert.match(styles, /\.next-stage-preview\.is-landing/);
  assert.doesNotMatch(app, /前台提示音和震动仍然有效/);
  assert.doesNotMatch(app, /\{data\.childAlias\}：完成事项/);
  assert.doesNotMatch(app, /className="phone-shell" aria-live/);
  assert.doesNotMatch(`${page}${layout}${app}`, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("ships an installable, privacy-preserving app manifest", async () => {
  const [manifestSource, serviceWorker, offlineAssetSource] = await Promise.all([
    readFile(new URL("../app/manifest.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    readFile(new URL("../public/offline-assets.json", import.meta.url), "utf8"),
  ]);
  const offlineAssetManifest = JSON.parse(offlineAssetSource);
  assert.match(manifestSource, /display: "standalone"/);
  assert.match(manifestSource, /lang: "zh-CN"/);
  assert.match(manifestSource, /sizes: "320x320"/);
  assert.equal(versionedAsset("/assets/icons/home-heart.png"), `/assets/icons/home-heart.png?v=${ASSET_VERSION}`);
  assert.match(manifestSource, /src: versionedAsset\("\/assets\/icons\/home-heart\.png"\)/);
  assert.match(serviceWorker, /clients\.claim\(\)/);
  assert.match(serviceWorker, /CACHE_NAME = `\$\{CACHE_PREFIX\}v3`/);
  assert.match(serviceWorker, /async function pruneOldBuildAssets/);
  assert.match(serviceWorker, /currentBuildReady\.some\(response => !response\)/);
  assert.match(serviceWorker, /await pruneOldBuildAssets\(cache, shellAssets\)/);
  assert.match(serviceWorker, /addEventListener\("fetch"/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/api\/"\)\) return/);
  assert.match(serviceWorker, /request\.mode === "navigate"/);
  assert.match(serviceWorker, /caches\.match\("\/"\)/);
  assert.match(serviceWorker, /cache\.match\(request, \{ ignoreSearch: true \}\)/);
  assert.match(serviceWorker, /Only the public app/);
  assert.equal(offlineAssetManifest.version, 2);
  assert.ok(Array.isArray(offlineAssetManifest.assets));
  assert.ok(offlineAssetManifest.assets.length > 100, "the build-time catalog should cover the complete public icon and mascot library");
  assert.deepEqual([...offlineAssetManifest.assets].sort((left, right) => left.localeCompare(right, "en")), offlineAssetManifest.assets);
  assert.ok(offlineAssetManifest.assets.every(asset => asset.startsWith("/assets/")));
  assert.ok(offlineAssetManifest.assets.every(asset => !asset.startsWith("/api/")));
  assert.ok(Array.isArray(offlineAssetManifest.criticalAssets));
  assert.ok(offlineAssetManifest.criticalAssets.length >= 18, "the core navigation, live-session, and mascot visuals should survive an offline reload");
  assert.ok(offlineAssetManifest.criticalAssets.every(asset => asset.endsWith(".webp")), "first install should prefer the compact visual format; legacy fallbacks cache when actually requested");
  assert.ok(offlineAssetManifest.criticalAssets.length < offlineAssetManifest.assets.length / 2, "first install must not compete with the page by downloading the complete visual library");
  assert.deepEqual([...offlineAssetManifest.criticalAssets].sort((left, right) => left.localeCompare(right, "en")), offlineAssetManifest.criticalAssets);
  assert.ok(offlineAssetManifest.criticalAssets.every(asset => offlineAssetManifest.assets.includes(asset)));
  assert.match(serviceWorker, /manifest\.criticalAssets/);
  assert.doesNotMatch(serviceWorker, /manifest\.assets/);
  await Promise.all(offlineAssetManifest.assets.map(asset => access(new URL(`../public${asset}`, import.meta.url))));
});

test("ships optimized visual assets and persistent-state migration", async () => {
  const app = await readFile(new URL("../app/StartApp.tsx", import.meta.url), "utf8");
  const roomAsset = new URL("../public/assets/energy-room-v3.jpg", import.meta.url);
  const iconDirectory = new URL("../public/assets/icons/", import.meta.url);
  const mascotDirectory = new URL("../public/assets/mascot/", import.meta.url);
  const optimizedIconDirectory = new URL("../public/assets/optimized/icons/", import.meta.url);
  const optimizedMascotDirectory = new URL("../public/assets/optimized/mascot/", import.meta.url);
  const optimizedRoomAsset = new URL("../public/assets/optimized/energy-room-v3.webp", import.meta.url);
  const socialPreview = new URL("../public/og.jpg", import.meta.url);
  await access(roomAsset);
  assert.ok((await stat(roomAsset)).size < 200_000, "energy room should stay below 200KB");
  assert.ok((await stat(optimizedRoomAsset)).size < 60_000, "the modern energy room asset should stay below 60KB");
  const visualAssets = await Promise.all([
    ...(await readdir(iconDirectory)).filter(name => name.endsWith(".png")).map(name => stat(new URL(name, iconDirectory))),
    ...(await readdir(mascotDirectory)).filter(name => name.endsWith(".png")).map(name => stat(new URL(name, mascotDirectory))),
  ]);
  assert.ok(visualAssets.reduce((total, file) => total + file.size, 0) < 1_600_000, "icons and mascot poses should stay below 1.6MB combined");
  assert.ok((await stat(new URL("ready.png", mascotDirectory))).size < 50_000, "the primary mascot pose should stay below 50KB");
  assert.ok((await stat(new URL("home-heart.png", iconDirectory))).size < 35_000, "the primary app icon should stay below 35KB");
  const sourceIconNames = (await readdir(iconDirectory)).filter(name => name.endsWith(".png")).map(name => name.replace(/\.png$/, "")).sort();
  const sourceMascotNames = (await readdir(mascotDirectory)).filter(name => name.endsWith(".png")).map(name => name.replace(/\.png$/, "")).sort();
  const optimizedIconNames = (await readdir(optimizedIconDirectory)).filter(name => name.endsWith(".webp")).map(name => name.replace(/\.webp$/, "")).sort();
  const optimizedMascotNames = (await readdir(optimizedMascotDirectory)).filter(name => name.endsWith(".webp")).map(name => name.replace(/\.webp$/, "")).sort();
  assert.deepEqual(optimizedIconNames, sourceIconNames, "every activity icon should have a modern delivery asset");
  assert.deepEqual(optimizedMascotNames, sourceMascotNames, "every mascot pose should have a modern delivery asset");
  const optimizedAssets = await Promise.all([
    ...optimizedIconNames.map(name => stat(new URL(`${name}.webp`, optimizedIconDirectory))),
    ...optimizedMascotNames.map(name => stat(new URL(`${name}.webp`, optimizedMascotDirectory))),
  ]);
  assert.ok(optimizedAssets.reduce((total, file) => total + file.size, 0) < 600_000, "modern icon and mascot delivery should stay below 600KB combined");
  assert.ok((await stat(socialPreview)).size < 200_000, "the social preview should stay below 200KB");
  assert.match(app, /assets\/optimized\/energy-room-v3\.webp/);
  assert.match(app, /className="achievement-room-art"/);
  await assert.rejects(access(new URL("../public/og.png", import.meta.url)), "the unused legacy social PNG should not ship");
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
  assert.match(route, /privateJson\(\{ conflict: true,[\s\S]*\}, 409\)/);
  assert.match(route, /FAMILY_TOKEN_PATTERN/);
  assert.match(route, /request\.headers\.get\("x-family-token"\)/);
  assert.match(route, /"cache-control": "private, no-store"/);
  assert.match(route, /privateJson\(\{ ok: false, localOnly: true \}, 503\)/);
});

test("removes local worker state before production packaging", async () => {
  const [packageSource, cleanupSource] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../scripts/clean-generated-state.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(packageSource, /node scripts\/clean-generated-state\.mjs && node scripts\/generate-offline-assets\.mjs/);
  assert.match(cleanupSource, /dist\/server\/\.wrangler/);
  assert.match(cleanupSource, /recursive: true, force: true/);
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

test("moves the whole schedule with a cross-midnight availability start", () => {
  const delta = clockDeltaMinutes("23:40", "00:10");
  const shifted = shiftTimedItemsFrom([
    { title: "阅读", start: "23:50", end: "00:10" },
    { title: "整理", start: "00:20", end: "00:35" },
  ], 0, delta);
  assert.equal(delta, 30);
  assert.deepEqual(shifted.map(item => [item.start, item.end]), [["00:20", "00:40"], ["00:50", "01:05"]]);
});

test("aligns the next live stage to the real start while preserving gaps and tomorrow", () => {
  const aligned = alignLiveStagesToStart([
    { title: "阅读", start: "18:00", end: "18:20", status: "done" },
    { title: "整理", start: "18:20", end: "18:40", status: "pending" },
    { title: "洗漱", start: "18:50", end: "19:05", status: "pending" },
    { title: "背诵", start: "19:10", end: "19:30", status: "tomorrow" },
  ], 1, "18:08");

  assert.deepEqual(aligned.map(item => [item.start, item.end]), [
    ["18:00", "18:20"],
    ["18:08", "18:28"],
    ["18:38", "18:53"],
    ["19:10", "19:30"],
  ]);
});

test("inserts a new node into the earliest full gap without moving the family boundary", () => {
  const slot = findPlanInsertionSlot("18:00", "20:00", [
    { title: "晚餐", start: "18:00", end: "18:20" },
    { title: "阅读", start: "18:50", end: "19:10" },
  ]);
  assert.deepEqual(slot, { status: "available", start: "18:20", end: "18:40", minutes: 20, insertIndex: 1, usedShortGap: false });
});

test("uses the largest short gap when no twenty-minute gap remains", () => {
  const slot = findPlanInsertionSlot("18:00", "19:00", [
    { title: "晚餐", start: "18:00", end: "18:10" },
    { title: "阅读", start: "18:20", end: "18:40" },
    { title: "整理", start: "18:55", end: "19:00" },
  ]);
  assert.deepEqual(slot, { status: "available", start: "18:40", end: "18:55", minutes: 15, insertIndex: 2, usedShortGap: true });
});

test("finds a cross-midnight gap and refuses full or invalid plans", () => {
  const overnight = findPlanInsertionSlot("23:30", "00:30", [
    { title: "阅读", start: "23:30", end: "23:50" },
    { title: "整理", start: "00:10", end: "00:30" },
  ]);
  assert.deepEqual(overnight, { status: "available", start: "23:50", end: "00:10", minutes: 20, insertIndex: 1, usedShortGap: false });

  assert.deepEqual(findPlanInsertionSlot("18:00", "18:30", [
    { title: "阅读", start: "18:00", end: "18:30" },
  ]), { status: "full" });
  assert.deepEqual(findPlanInsertionSlot("18:00", "19:00", [
    { title: "阅读", start: "18:00", end: "18:40" },
    { title: "整理", start: "18:30", end: "18:50" },
  ]), { status: "invalid" });

  assert.deepEqual(findPlanInsertionSlot("18:00", "20:00", [
    { title: "阅读", start: "18:50", end: "19:10" },
    { title: "晚餐", start: "18:00", end: "18:20" },
  ]), { status: "invalid" });
});

test("moves unequal tasks while preserving leading and between-stage gaps", () => {
  const result = moveTimedItemPreservingGaps([
    { title: "短任务", start: "18:10", end: "18:30" },
    { title: "长任务", start: "18:45", end: "19:15" },
    { title: "收尾", start: "19:25", end: "19:35" },
  ], 2, 0, "18:00");
  assert.equal(result.moved, true);
  assert.deepEqual(result.items.map(item => [item.title, item.start, item.end]), [
    ["收尾", "18:10", "18:20"],
    ["短任务", "18:35", "18:55"],
    ["长任务", "19:05", "19:35"],
  ]);
});

test("preserves a cross-midnight gap when swapping tasks", () => {
  const result = moveTimedItemPreservingGaps([
    { title: "阅读", start: "23:30", end: "23:50" },
    { title: "整理", start: "00:00", end: "00:20" },
  ], 0, 1, "23:20");
  assert.equal(result.moved, true);
  assert.deepEqual(result.items.map(item => [item.title, item.start, item.end]), [
    ["整理", "23:30", "23:50"],
    ["阅读", "00:00", "00:20"],
  ]);
  assert.equal(moveTimedItemPreservingGaps([
    { title: "阅读", start: "18:30", end: "19:00" },
    { title: "整理", start: "18:50", end: "19:10" },
  ], 0, 1, "18:00").moved, false);
});

test("swaps upcoming live items even when an overlapping item is already deferred", () => {
  const result = swapNextPendingItems([
    { id: "language", start: "04:31", end: "04:51", status: "tomorrow" },
    { id: "rest", start: "04:37", end: "04:47", status: "active" },
    { id: "math", start: "04:47", end: "05:06", status: "pending" },
    { id: "reading", start: "05:06", end: "05:26", status: "pending" },
  ], 1, "04:31");

  assert.equal(result.moved, true);
  assert.deepEqual(result.items.map(item => [item.id, item.start, item.end, item.status]), [
    ["language", "04:31", "04:51", "tomorrow"],
    ["rest", "04:37", "04:47", "active"],
    ["reading", "04:47", "05:07", "pending"],
    ["math", "05:07", "05:26", "pending"],
  ]);
});

test("moves the next item to tomorrow and closes its slot for the remaining evening", () => {
  const result = deferNextPendingItem([
    { id: "rest", start: "04:37", end: "04:47", status: "active" },
    { id: "reading", start: "04:47", end: "05:07", status: "pending" },
    { id: "math", start: "05:07", end: "05:26", status: "pending" },
  ], 0);

  assert.equal(result.moved, true);
  assert.equal(result.minutes, 20);
  assert.deepEqual(result.items.map(item => [item.id, item.start, item.end, item.status]), [
    ["rest", "04:37", "04:47", "active"],
    ["reading", "04:47", "05:07", "tomorrow"],
    ["math", "04:47", "05:06", "pending"],
  ]);
});

test("swaps non-adjacent pending positions without moving the intervening status", () => {
  const result = swapTimedItemsPreservingGaps([
    { title: "当前", start: "18:00", end: "18:20", status: "active" },
    { title: "阅读", start: "18:30", end: "18:50", status: "pending" },
    { title: "明天再做", start: "19:00", end: "19:10", status: "tomorrow" },
    { title: "整理", start: "19:20", end: "19:50", status: "pending" },
  ], 1, 3, "18:00");
  assert.equal(result.moved, true);
  assert.deepEqual(result.items.map(item => [item.title, item.start, item.end, item.status]), [
    ["当前", "18:00", "18:20", "active"],
    ["整理", "18:30", "19:00", "pending"],
    ["明天再做", "19:10", "19:20", "tomorrow"],
    ["阅读", "19:30", "19:50", "pending"],
  ]);
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

test("separates the last scheduled item from the wider family availability window", () => {
  assert.equal(scheduledEndTime([
    { title: "阅读", start: "18:00", end: "18:20", status: "done" },
    { title: "明天再做", start: "18:30", end: "19:00", status: "tomorrow" },
  ], "20:30"), "18:20");
  assert.equal(scheduledEndTime([], "20:30"), "20:30");
});

test("keeps completed rest breaks out of the completed task count", () => {
  assert.equal(countCompletedTasks([
    { status: "done", kind: "rest" },
    { status: "done", kind: "task" },
    { status: "pending", kind: "task" },
  ]), 1);
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

test("suggests a first planning window that still makes sense when the family arrives", () => {
  assert.deepEqual(suggestInitialEveningWindow(new Date(2026, 6, 13, 9, 12)), { planStart: "18:00", planEnd: "20:30" });
  assert.deepEqual(suggestInitialEveningWindow(new Date(2026, 6, 13, 15, 59)), { planStart: "18:00", planEnd: "20:30" });
  assert.deepEqual(suggestInitialEveningWindow(new Date(2026, 6, 13, 16, 0)), { planStart: "16:00", planEnd: "18:00" });
  assert.deepEqual(suggestInitialEveningWindow(new Date(2026, 6, 13, 18, 3)), { planStart: "18:10", planEnd: "20:10" });
  assert.deepEqual(suggestInitialEveningWindow(new Date(2026, 6, 13, 20, 47)), { planStart: "20:50", planEnd: "21:50" });
  assert.deepEqual(suggestInitialEveningWindow(new Date(2026, 6, 13, 21, 29)), { planStart: "21:30", planEnd: "22:30" });
  assert.deepEqual(suggestInitialEveningWindow(new Date(2026, 6, 13, 21, 30)), { planStart: "18:00", planEnd: "20:30" });
  assert.deepEqual(suggestInitialEveningWindow(new Date(2026, 6, 13, 23, 57)), { planStart: "18:00", planEnd: "20:30" });
  assert.deepEqual(suggestInitialEveningWindow(new Date(2026, 6, 13, 4, 58)), { planStart: "18:00", planEnd: "20:30" });
  assert.deepEqual(suggestInitialEveningWindow(new Date(2026, 6, 13, 5, 0)), { planStart: "18:00", planEnd: "20:30" });
  assert.deepEqual(suggestInitialEveningWindow(new Date(Number.NaN)), { planStart: "18:00", planEnd: "20:30" });
});

test("distinguishes a future planned start from a start time that has already passed", () => {
  assert.equal(clockMinutesUntil("15:10", "18:00"), 170);
  assert.equal(clockMinutesUntil("05:00", "18:00"), 780);
  assert.equal(clockMinutesUntil("18:10", "18:00"), -10);
  assert.equal(clockMinutesUntil("23:57", "00:00"), 3);
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

test("rebases a same-night follow-up without extending an end time that still fits", () => {
  const result = rebaseFollowUpPlan("18:00", "20:00", [
    { title: "阅读", start: "18:00", end: "18:20" },
    { title: "整理书包", start: "18:30", end: "18:45" },
  ], "19:00");
  assert.equal(result.planStart, "19:00");
  assert.equal(result.planEnd, "20:00");
  assert.equal(result.keptPlanEnd, true);
  assert.deepEqual(result.items.map(item => [item.start, item.end]), [["19:00", "19:20"], ["19:30", "19:45"]]);
});

test("rebases a follow-up and moves the end only when the old window no longer fits", () => {
  const result = rebaseFollowUpPlan("18:00", "20:00", [
    { title: "阅读", start: "18:00", end: "18:30" },
    { title: "整理书包", start: "18:30", end: "19:00" },
  ], "19:40");
  assert.equal(result.planStart, "19:40");
  assert.equal(result.planEnd, "20:40");
  assert.equal(result.keptPlanEnd, false);
  assert.deepEqual(result.items.map(item => [item.start, item.end]), [["19:40", "20:10"], ["20:10", "20:40"]]);
});

test("preserves a cross-midnight follow-up window when its remaining time is enough", () => {
  const result = rebaseFollowUpPlan("23:20", "00:40", [
    { title: "阅读", start: "23:20", end: "23:40" },
  ], "00:05");
  assert.equal(result.planStart, "00:05");
  assert.equal(result.planEnd, "00:40");
  assert.equal(result.keptPlanEnd, true);
  assert.deepEqual(result.items.map(item => [item.start, item.end]), [["00:05", "00:25"]]);
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
  assert.equal(shouldUseHapticCue(false, false), true);
  assert.equal(shouldUseHapticCue(true, false), false);
  assert.equal(shouldUseHapticCue(false, true), false);
  assert.equal(shouldShowSoftLanding(61, false), false);
  assert.equal(shouldShowSoftLanding(60, false), true);
  assert.equal(shouldShowSoftLanding(1, false), true);
  assert.equal(shouldShowSoftLanding(0, false), false);
  assert.equal(shouldShowSoftLanding(30, true), false);
  assert.equal(shouldShowSoftLanding(30, false, 0), false);
  assert.equal(foregroundCueStatus(true, false), "页面内仍会显示提醒；提示音和轻触反馈按设备支持");
  assert.equal(foregroundCueStatus(true, true), "页面内仍会显示提醒；提示音开启，触感已关闭");
  assert.equal(foregroundCueStatus(false, false), "页面内仍会显示提醒；提示音关闭，轻触反馈按设备支持");
  assert.equal(foregroundCueStatus(false, true), "页面内仍会显示提醒；提示音与触感均已关闭");
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

test("labels early-morning wrap-up with the family night it belongs to", () => {
  assert.equal(familyNightDisplayLabel("2026-07-13", "2026-07-14T04:20:00+08:00"), "7月13日晚 · 凌晨收尾");
  assert.equal(familyNightDisplayLabel("2026-07-14", "2026-07-14T21:20:00+08:00"), "7月14日 · 今晚记录");
  assert.equal(familyNightDisplayLabel("invalid", "2026-07-14T21:20:00+08:00"), "这一晚 · 家庭记录");
});

test("awards shared-night bonuses only once while allowing later task energy", () => {
  assert.deepEqual(calculateNightBonus([], 1), { cooperationEnergy: 2, adjustmentEnergy: 1 });
  assert.deepEqual(calculateNightBonus([{ adjustmentEnergy: 1 }], 2), { cooperationEnergy: 0, adjustmentEnergy: 0 });
  assert.deepEqual(calculateNightBonus([{ adjustmentEnergy: 0 }], 1), { cooperationEnergy: 0, adjustmentEnergy: 1 });
});

test("keeps the wrap-up promise consistent with the actual settlement state", () => {
  assert.equal(settlementFooterCopy(0, false), "保存后写入家庭日历；不会公开，也不会用于比较");
  assert.equal(settlementFooterCopy(0, true), "未完成事项留到明天；不会扣掉已经获得的能量");
  assert.equal(settlementFooterCopy(1, false), "保存后继续写入同一晚；合作与调整能量不重复记录");
  assert.equal(settlementFooterCopy(1, true), "未完成事项留到明天；本夜合作与调整能量不重复记录");
});

test("advances restored live stages without leaving two active items", () => {
  const advanced = advanceStageStatuses([
    { title: "上一段", status: "active" },
    { title: "下一段", status: "pending" },
    { title: "稍后", status: "active" },
  ], 0, 1);
  assert.deepEqual(advanced.map(item => item.status), ["done", "active", "pending"]);
  assert.equal(advanced.filter(item => item.status === "active").length, 1);

  const alreadyCompleted = advanceStageStatuses([
    { title: "上一段", status: "done" },
    { title: "下一段", status: "pending" },
  ], 0, 1);
  assert.deepEqual(alreadyCompleted.map(item => item.status), ["done", "active"]);
});

test("moves the current stuck stage to tomorrow and activates exactly one next stage", () => {
  const deferred = deferActiveStage([
    { id: "language", status: "active" },
    { id: "math", status: "pending" },
    { id: "reading", status: "pending" },
  ], 0, 1);
  assert.deepEqual(deferred.map(item => [item.id, item.status]), [
    ["language", "tomorrow"],
    ["math", "active"],
    ["reading", "pending"],
  ]);
  assert.equal(deferred.filter(item => item.status === "active").length, 1);
});

test("deletes one settlement without corrupting nightly bonuses or a later energy cycle", () => {
  const sessions = [
    { id: "first", date: "2026-07-13T12:00:00.000Z", nightKey: "2026-07-13", adjustments: 1, cooperationEnergy: 2, adjustmentEnergy: 1, energyEarned: 6 },
    { id: "second", date: "2026-07-13T13:00:00.000Z", nightKey: "2026-07-13", adjustments: 1, cooperationEnergy: 0, adjustmentEnergy: 0, energyEarned: 2 },
  ];
  const currentCycle = removeSessionAndReconcileEnergy(sessions, "first", 8, []);
  assert.equal(currentCycle.currentCycleAdjusted, true);
  assert.equal(currentCycle.removedEnergy, 3);
  assert.equal(currentCycle.energy, 5);
  assert.deepEqual(currentCycle.sessions.map(item => [item.id, item.cooperationEnergy, item.adjustmentEnergy, item.energyEarned]), [["second", 2, 1, 5]]);
  assert.deepEqual(sessions.map(item => item.energyEarned), [6, 2]);

  const historical = removeSessionAndReconcileEnergy(sessions, "first", 4, ["2026-07-14T08:00:00.000Z"]);
  assert.equal(historical.currentCycleAdjusted, false);
  assert.equal(historical.energy, 4);

  const missing = removeSessionAndReconcileEnergy(sessions, "missing", 8, []);
  assert.equal(missing.sessions, sessions);
  assert.equal(missing.energy, 8);

  const invalidLegacy = removeSessionAndReconcileEnergy([{ ...sessions[0], date: "unknown" }], "first", 8, []);
  assert.equal(invalidLegacy.currentCycleAdjusted, false);
  assert.equal(invalidLegacy.energy, 8);
});

test("clears one family night while preserving history and settled reward cycles", () => {
  const sessions = [
    { id: "older", date: "2026-07-12T12:00:00.000Z", nightKey: "2026-07-12", adjustments: 0, cooperationEnergy: 2, adjustmentEnergy: 0, energyEarned: 4 },
    { id: "first", date: "2026-07-13T12:00:00.000Z", nightKey: "2026-07-13", adjustments: 1, cooperationEnergy: 2, adjustmentEnergy: 1, energyEarned: 6 },
    { id: "second", date: "2026-07-13T13:00:00.000Z", nightKey: "2026-07-13", adjustments: 0, cooperationEnergy: 0, adjustmentEnergy: 0, energyEarned: 2 },
  ];
  const currentCycle = removeNightAndReconcileEnergy(sessions, "2026-07-13", 10, []);
  assert.equal(currentCycle.removedCount, 2);
  assert.equal(currentCycle.removedEnergy, 8);
  assert.equal(currentCycle.energy, 2);
  assert.deepEqual(currentCycle.sessions.map(item => item.id), ["older"]);

  const afterRewardReset = removeNightAndReconcileEnergy(sessions, "2026-07-13", 3, ["2026-07-14T08:00:00.000Z"]);
  assert.equal(afterRewardReset.removedEnergy, 0);
  assert.equal(afterRewardReset.energy, 3);

  const missing = removeNightAndReconcileEnergy(sessions, "2026-07-11", 10, []);
  assert.equal(missing.sessions, sessions);
  assert.equal(missing.removedCount, 0);
});

test("keeps the newest bounded history across imports and sync merges", () => {
  const records = [
    { id: "old", date: "2025-01-01T00:00:00.000Z" },
    { id: "invalid", date: "unknown" },
    { id: "new", date: "2026-07-13T00:00:00.000Z" },
    { id: "middle", date: "2026-01-01T00:00:00.000Z" },
  ];
  assert.deepEqual(keepNewestRecords(records, item => item.date, 3).map(item => item.id), ["new", "middle", "old"]);
  assert.deepEqual(records.map(item => item.id), ["old", "invalid", "new", "middle"]);
  assert.deepEqual(keepNewestRecords(records, item => item.date, 10).map(item => item.id), ["new", "middle", "old", "invalid"]);
  assert.deepEqual(keepNewestRecords(records, item => item.date, 0), []);
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

test("keeps stage energy optional without corrupting legacy values", () => {
  assert.equal(normalizeStageEnergy(0), 0);
  assert.equal(normalizeStageEnergy("0"), 0);
  assert.equal(normalizeStageEnergy(-3), 0);
  assert.equal(normalizeStageEnergy(2.6), 3);
  assert.equal(normalizeStageEnergy(8), 5);
  assert.equal(normalizeStageEnergy(undefined, 0), 0);
  assert.equal(normalizeStageEnergy(undefined, 1), 1);
  assert.equal(normalizeStageEnergy("not-a-number", 1), 1);
  assert.equal(stageEnergyLabel(0), "不计家庭能量");
  assert.equal(stageEnergyLabel(3), "3点家庭能量");
});

test("restores only the matching latest reward cycle without overwriting changed history", () => {
  const current = { energy: 0, rewardGoal: { title: "", redeemed: true }, rewardHistory: [{ id: "new", title: "桌游" }], untouched: "family" };
  const undo = { rewardId: "new", energy: 36, rewardGoal: { title: "周末桌游", redeemed: false }, rewardHistory: [{ id: "old", title: "公园" }] };
  assert.deepEqual(restoreRewardRedemption(current, undo), { energy: 36, rewardGoal: undo.rewardGoal, rewardHistory: undo.rewardHistory, untouched: "family" });
  assert.equal(restoreRewardRedemption({ ...current, rewardHistory: [] }, undo), null);
  assert.equal(restoreRewardRedemption({ ...current, energy: 2 }, undo), null);
  assert.equal(restoreRewardRedemption({ ...current, rewardGoal: { ...current.rewardGoal, redeemed: false } }, undo), null);
  assert.equal(restoreRewardRedemption({ ...current, rewardHistory: [{ id: "newer", title: "公园" }, ...current.rewardHistory] }, undo), null);
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
