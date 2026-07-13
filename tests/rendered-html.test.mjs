import assert from "node:assert/strict";
import { access, readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";
import { addMinutes, alignLiveStagesToStart, analyzePlan, canInsertRestBreak, clockDeltaMinutes, clockMinutesUntil, clockTimeFromDate, durationMinutes, findPlanInsertionSlot, formatPlanClock, gentleRemainingLabel, insertRestBreak, moveTimedItemPreservingGaps, prepareNextRoundPlan, prepareNextRoundSchedule, rebaseFollowUpPlan, reflowTimedItemsFrom, remainingTimerMinutes, shiftFollowingForEndChange, shiftTimedItemsFrom, shiftTimedPlanToStart, spansMidnight, suggestInitialEveningWindow, swapTimedItemsPreservingGaps } from "../app/plan-utils.ts";
import { foregroundCueStatus, shouldShowSoftLanding, shouldUseBackgroundReminder, shouldUseForegroundCue, shouldUseHapticCue } from "../app/reminder-utils.ts";
import { normalizeStageEnergy, restoreRewardRedemption, rewardThresholdBounds, stageEnergyLabel } from "../app/reward-utils.ts";
import { suggestWeeklyFocus } from "../app/review-utils.ts";
import { advanceStageStatuses, calculateNightBonus, familyNightKey, isLiveSessionFresh, keepNewestRecords, liveNightLabel, removeSessionAndReconcileEnergy, settlementFooterCopy } from "../app/session-utils.ts";
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
  assert.match(app, /childAlias: ""/);
  assert.match(app, /guardianAlias: ""/);
  assert.match(app, /rewardGoal: \{ threshold: 20, title: "", icon: "game", date: "周六", participants: \[\], redeemed: true/);
  assert.match(app, /const \[stages, setStages\] = useState<Stage\[]>\(\[\]\)/);
  assert.match(app, /if \(!Array\.isArray\(value\)\) return \[\]/);
  assert.match(app, /name="child-alias" aria-label="孩子化名" placeholder="例如：小橙"/);
  assert.match(app, /name="guardian-alias" aria-label="大人称呼" placeholder="例如：妈妈"/);
  assert.match(app, /familyDataRef\.current\.consent \? \{\} : suggestInitialEveningWindow\(new Date\(\)\)/);
  assert.match(app, /window\.addEventListener\("popstate", handlePopState\)/);
  assert.match(app, /familyDataRef\.current\.consent && \(target === "welcome" \|\| target === "profile"\)/);
  assert.match(app, /window\.history\.replaceState\(\{ xianKaishi: true, screen: "home", depth \}/);
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
  assert.match(styles, /\.toast, \.undo-toast \{ left: max\(18px, env\(safe-area-inset-left\)\); right: max\(18px, env\(safe-area-inset-right\)\); width: auto; \}/);
  assert.match(styles, /@media \(max-width: 900px\) and \(orientation: landscape\) and \(min-width: 600px\) \{[\s\S]*?\.screen \{ width: min\(600px, 100%\); margin-inline: auto; \}/);
  assert.match(styles, /\.offline-ribbon,[\s\S]*?\.undo-toast \{ left: 50%; right: auto; width: min\(560px, calc\(100% - 36px\)\); transform: translateX\(-50%\); \}/);
  assert.equal(ASSET_VERSION, "2026-07-13-2");
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
  assert.match(app, /删除全部家庭数据/);
  assert.doesNotMatch(app, /删除孩子全部数据/);
  assert.match(app, /旧家庭的云端副本等待清理/);
  assert.match(app, /只保留随机家庭 ID 作为删除凭证/);
  assert.match(app, /先暂停流程，陪孩子稳定下来/);
  assert.match(app, /只记发生时间、场景、持续多久和已经尝试过什么/);
  assert.match(app, /儿童保健科、发育行为儿科、儿科或精神心理相关门诊/);
  assert.match(app, /全国统一心理援助热线 12356/);
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
  assert.match(app, /planNeedsTime \? "has-error" : "needs-input"/);
  assert.match(app, /draftReady \? openConfirmPlan\(\) : startAnotherPlan\(\)/);
  assert.match(app, /保存时间表，稍后开始/);
  assert.match(app, /const plannedStartPassed = plannedStartOffset < 0/);
  assert.match(app, /const startShiftVerb = plannedStartPassed \? "顺延" : "前移"/);
  assert.match(app, /const shiftedPlanEndLabel = addMinutes\(startNowLabel, Math\.max\(1, durationMinutes\(data\.planStart, data\.planEnd\)\)\)/);
  assert.match(app, /原定 \$\{plannedStartLabel\} 已过；现在开始会整体顺延/);
  assert.match(app, /如果现在开始，时间会比原定 \$\{plannedStartLabel\} 整体前移/);
  assert.match(app, /从现在一起开始，时间整体顺延/);
  assert.match(app, /现在一起开始，时间整体前移/);
  assert.match(app, /plannedStartOffset === 0 \? "最晚" : "原计划最晚"/);
  assert.match(styles, /\.confirm-timing-note\.is-late/);
  assert.match(app, /时间表会留在首页/);
  assert.match(styles, /@media \(max-width: 900px\) and \(max-height: 640px\) \{[\s\S]*?\.confirm-action-dock \{ position: sticky; bottom: 0;[^}]*grid-template-columns: minmax\(0,1fr\) 106px/);
  assert.match(styles, /\.confirm-action-dock \.confirm-secondary-action \{[^}]*min-height: 50px[^}]*font-size: 11px/);
  assert.doesNotMatch(styles, /\.confirm-action-dock, \.reward-save-dock \{ position: static/);
  assert.match(styles, /\.plan-balance\.needs-input/);
  assert.match(styles, /\.stage-editor\.needs-title/);
  assert.match(styles, /\.confirm-secondary-action/);
  assert.match(app, /stages\.length >= MAX_PLAN_STAGES/);
  assert.match(app, /今晚最多保留\$\{MAX_PLAN_STAGES\}个节点/);
  assert.match(app, /id="plan-node-guidance"/);
  assert.match(app, /当前 \$\{stages\.length\}\/\$\{MAX_PLAN_STAGES\} 个节点/);
  assert.match(styles, /\.add-node-button:disabled/);
  assert.match(app, /className=\{`plan-next-dock \$\{planHasErrors \? "needs-fix" : "is-ready"\}`\}/);
  assert.match(app, /aria-label="安排进度与下一步"/);
  assert.match(app, /时间表已经可以确认/);
  assert.match(app, /还差一点就能确认/);
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
  assert.match(app, /shiftedPlanUndo && <div className="undo-toast"/);
  assert.match(app, /const \[clearedPlanUndo, setClearedPlanUndo\] = useState<ClearedPlanUndo \| null>\(null\)/);
  assert.match(app, /setClearedPlanUndo\(\{ stages: snapshot, editingStageId, planStart: data\.planStart, planEnd: data\.planEnd \}\)/);
  assert.match(app, /setTimeout\(\(\) => setClearedPlanUndo\(null\), 30000\)/);
  assert.match(app, /aria-label="恢复刚才清空的整晚计划"/);
  assert.match(app, /已清空 \{clearedPlanUndo\.stages\.length\} 个时间节点/);
  assert.match(app, /setToast\(`已恢复 \$\{undo\.stages\.length\} 个时间节点`\)/);
  assert.match(app, /const updatePlanStart = \(start: string\) =>/);
  assert.match(app, /applyPlanTimes\(shiftTimedItemsFrom\(baselineTimes, 0, delta\)\)/);
  assert.match(app, /planStart: baselineStart/);
  assert.match(app, /ref=\{planStartInputRef\}/);
  assert.match(app, /planStartInputRef\.current\?\.focus\(\)/);
  assert.match(app, /endPlanWindowEdit\("start", e\.currentTarget\.value\)/);
  assert.match(app, /时间还没选好，已恢复刚才的安排/);
  assert.match(app, /改开始时间，下面节点会保留间隔一起移动/);
  assert.match(styles, /\.window-shift-note \{[^}]*font-size: var\(--type-micro\)/);
  assert.match(app, /className="home-plan-cta"/);
  assert.match(app, /findPlanInsertionSlot\(data\.planStart, data\.planEnd, stages\)/);
  assert.match(app, /moveTimedItemPreservingGaps\(stages, index, target, data\.planStart\)/);
  assert.match(app, /已调换顺序，原来的时间空档保持不变/);
  assert.match(app, /swapTimedItemsPreservingGaps\(stages, pending\[0\]\.index, pending\[1\]\.index, data\.planStart\)/);
  assert.match(app, /后两项已调换，原来的休息空档还在/);
  assert.match(app, /今晚已经排满，先留出至少5分钟再增加/);
  assert.match(app, /setDeletedStage\(null\);\s+setShiftedPlanUndo\(null\);\s+setClearedPlanUndo\(null\);\s+const id = createId\("stage"\)/);
  assert.doesNotMatch(app, /className="draft-summary"/);
  assert.match(app, /const startAnotherPlan = \(\) => \{/);
  assert.match(app, /rebaseFollowUpPlan\(data\.planStart, data\.planEnd, stages, nowTime\)/);
  assert.match(app, /className="follow-up-plan-note" role="status"/);
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
  assert.match(app, /activeNightLabel\}等待温和收尾/);
  assert.match(app, /愿意一起停下来/);
  assert.match(app, /哪些数据保存在哪里/);
  assert.match(app, /随机家庭 ID 不是正式账号鉴权/);
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
  assert.match(app, /今天的记录已保存 · 可以放松了/);
  assert.match(app, /家庭晚间 · 一起商量/);
  assert.match(app, /const homeHeroCopy = liveSessionAvailable/);
  assert.match(app, /今晚正在进行，按自己的节奏来/);
  assert.match(app, /进度已经保存；继续、调整或先收尾都可以/);
  assert.match(app, /家庭日历已记录/);
  assert.match(app, /className="empty-plan empty-plan-action"/);
  assert.match(app, /增加第一个节点/);
  assert.match(app, /stages\.length > 0 && <button ref=\{addNodeButtonRef\} className="add-node-button"/);
  assert.match(app, /已移除“\{deletedStage\.stage\.title\.trim\(\) \|\| "未命名事项"\}”/);
  assert.match(app, /已恢复“\$\{stage\.title\.trim\(\) \|\| "未命名事项"\}”/);
  assert.match(app, /resumeTonightFromWrap/);
  assert.match(app, /还想继续今晚/);
  assert.match(app, /const settlementFooter = settlementFooterCopy\(priorSettlementSessions\.length, hasDeferredStages\)/);
  assert.match(app, /promptReflection \? settlementFooter : `催促感可以不填 · \$\{settlementFooter\}`/);
  assert.match(app, /if \(profileReturn === "settings"\) back\("settings"\); else go\("plan", "replace"\)/);
  assert.match(app, /保存并安排今晚/);
  assert.match(app, /今晚，怎么称呼彼此？/);
  assert.doesNotMatch(styles, /\.profile-preferences/);
  assert.match(app, /undoRemoveStage/);
  assert.match(app, /setDeletedStage\(null\), 8000/);
  assert.match(app, /data-screen-heading/);
  assert.match(app, /预计到时间了，可以完成、继续或调整/);
  assert.match(app, /const startRestNow/);
  assert.match(app, /到时间只是提醒，不代表必须完成/);
  assert.match(app, /role="group" aria-label="到点后的选择"/);
  assert.match(app, /之后只继续剩余时间/);
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
  assert.match(app, /已进入“\{stageAdvanceUndo\.nextTitle\}”/);
  assert.match(styles, /\.live-undo-toast \{ bottom: calc\(210px/);
  assert.match(styles, /max-height: 700px[\s\S]*?\.live-undo-toast \{ bottom: calc\(76px/);
  assert.match(app, /现在休息10分钟，最晚\$\{result\.planEnd\}收尾/);
  assert.match(app, /setData\(current => \(\{ \.\.\.current, planEnd: result\.planEnd \}\)\)/);
  assert.match(app, /最晚\$\{nextPlanEnd\}收尾/);
  assert.match(app, /今晚进度 · 最晚 \{formatPlanClock\(data\.planEnd, data\.planStart, data\.planEnd\)\} 收尾/);
  assert.match(app, /之后只继续剩余时长/);
  assert.match(app, /跨到次日 · 结束时间按第二天计算/);
  assert.match(app, /const planCrossesMidnight = spansMidnight/);
  assert.match(app, /onChange=\{e => updatePlanStart\(e\.target\.value\)\}/);
  assert.match(app, /setData\(current => \(\{ \.\.\.current, planEnd: e\.target\.value \}\)\)/);
  assert.match(app, /canStartRest && <button className="soft-button" onClick=\{startRestNow\}>先休息 10 分钟<\/button>/);
  assert.match(app, /!activeStageCompleted \? \[\{ id: "extend" as const/);
  assert.match(app, /下一项前休息10分钟/);
  assert.match(app, /收尾保存后 \+\$\{activeStage\.energy\} 家庭能量/);
  assert.match(app, /disabled=\{!effectiveAdjustChoice\}/);
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
  assert.match(app, /切到其他页面时尝试提醒/);
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
  assert.match(app, /sessionDeleteUndoRef\.current\?\.focus\(\)/);
  assert.match(app, /撤销删除\$\{sessionDeleteUndo\.label\}的收尾记录/);
  assert.match(app, /sessionDeleteCancelRef\.current\?\.focus\(\)/);
  assert.match(app, /const cancelSessionDelete = \(recordId: string\) =>/);
  assert.match(app, /focusSessionDeleteTrigger\(recordId\)/);
  assert.match(app, /ref=\{sessionDeleteCancelRef\}/);
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
  assert.match(styles, /mascot-ready 4\.8s ease-in-out var\(--ambient-cycles\)/);
  assert.match(styles, /@keyframes mascot-ready/);
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
  assert.match(app, /减少动态与触感/);
  assert.match(styles, /\.reduce-motion \.launch-progress \{ display: none; \}/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.launch-progress \{ display: none; \}/);
  assert.match(app, /navigator\.serviceWorker\.register\("\/sw\.js"\)/);
  assert.match(app, /useSyncExternalStore\(subscribeToNetworkStatus/);
  assert.match(app, /useSyncExternalStore\(subscribeToReducedMotion/);
  assert.match(app, /query\.addEventListener\("change", onChange\)/);
  assert.match(app, /const motionReduced = data\.reducedMotion \|\| systemReducedMotion/);
  assert.match(app, /behavior: motionReduced \? "auto" : "smooth"/);
  assert.match(app, /site-shell \$\{motionReduced \? "reduce-motion"/);
  assert.match(app, /已跟随系统减少动画、页面自动滑动和轻触震动/);
  assert.match(app, /aria-describedby="motion-preference-status"/);
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
  assert.match(app, /先写名称/);
  assert.match(app, /时间与 1 点能量已先放好，随后都能调整/);
  assert.match(app, /className={`energy-detail-toggle/);
  assert.match(app, /aria-expanded={editingEnergyStageId === stage.id}/);
  assert.match(app, /editingEnergyStageId === stage.id &&/);
  assert.match(app, /className="task-energy-range branded-range"/);
  assert.match(app, /type="range" min="0" max="5"/);
  assert.match(app, /aria-valuetext=\{stageEnergyLabel\(stage\.energy\)\}/);
  assert.match(app, /\[0,1,2,3,4,5\]/);
  assert.match(app, /这一项不计能量/);
  assert.match(app, /energy: 0[^\n]+kind: "rest"/);
  assert.match(styles, /\.task-energy-scale \{[^}]*repeat\(6,1fr\)/);
  assert.match(styles, /\.task-energy \{ grid-column: 1 \/ -1/);
  assert.match(styles, /\.energy-detail-toggle\[aria-expanded="true"\]/);
  assert.match(styles, /\.active-energy\.is-zero/);
  assert.match(app, /rewardThresholdBounds\(data\.energy\)/);
  assert.match(app, /max=\{rewardMaximumThreshold\}/);
  assert.match(styles, /\.branded-range::-webkit-slider-runnable-track/);
  assert.match(styles, /height: min\(860px, calc\(100vh - 68px\)\)/);
  assert.match(styles, /\.availability-card \.mascot \{ display: none; \}/);
  assert.match(styles, /\.stage-actions \{ grid-column: 1 \/ -1; grid-row: 2; grid-template-columns: repeat\(3,1fr\); \}/);
  assert.match(styles, /\.reward-idea-grid small \{ display: none; \}/);
  assert.match(styles, /\.step-pill \{[^}]*white-space: nowrap/);
  assert.match(styles, /\.welcome-hero \{ grid-template-columns: minmax\(0,1fr\) 76px/);
  assert.match(styles, /\.next-action-list li/);
  assert.match(styles, /\.support-line \{/);
  assert.match(styles, /@media \(max-width: 900px\) and \(max-height: 640px\)/);
  assert.match(styles, /\.active-stage-card\.is-due \{ min-height: 0/);
  assert.match(styles, /\.wrap-action-dock \{ position: sticky; bottom: 0; display: grid/);
  assert.match(app, /className="energy-summary settlement-breakdown"/);
  assert.match(app, /催促感可以不填/);
  assert.match(app, /今晚，已经<br \/>好好收尾/);
  assert.match(styles, /\.night-saved-screen \.saved-actions \{ position: sticky; bottom: 0/);
  assert.match(styles, /\.achievement-screen \.achievement-actions \{ position: sticky; bottom: 0/);
  assert.match(styles, /\.achievement-screen \.redeem-confirm \{ position: sticky; bottom: 0/);
  assert.match(styles, /\.reward-saved-screen \.saved-actions \{ position: sticky; bottom: 0/);
  assert.match(app, /这份期待，<br \/>已经实现/);
  assert.match(styles, /\.effort-screen \.effort-options \{ grid-template-columns: repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.effort-screen \.rest-duration > div\.has-custom-duration \{ grid-template-columns: repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.effort-screen > \.primary-button \{ position: sticky; bottom: 0/);
  assert.match(styles, /\.welcome-action-dock, \.profile-action-dock \{ position: static; margin-top: 10px; \}/);
  assert.match(styles, /\.welcome-screen \{ padding: 14px 18px 22px; \}/);
  assert.match(styles, /\.welcome-hero \{ grid-template-columns: minmax\(0,1fr\) 72px; gap: 4px; \}/);
  assert.match(styles, /\.welcome-boundary > button \{ min-height: 36px;[^}]*padding-top: 5px; \}/);
  assert.match(styles, /\.welcome-action-dock \.primary-button \{ min-height: 50px;[^}]*font-size: 15px; \}/);
  assert.match(styles, /\.reward-save-dock \{ position: static; margin-top: 10px; \}/);
  assert.match(styles, /\.undo-toast \{ z-index: 51/);
  assert.match(app, /\{startNowLabel\}—\{dualFirstEndLabel\}/);
  assert.match(app, /整晚一起\$\{startShiftVerb\}/);
  assert.doesNotMatch(app, /整晚时间会一起顺延/);
  assert.match(app, /const cleanStages = stages\.map/);
  assert.match(app, /shiftTimedPlanToStart\(cleanStages, actualStart\)/);
  assert.match(app, /const DUAL_START_DELAY_MS = 3200/);
  assert.match(app, /setTimeout\(startPlan, DUAL_START_DELAY_MS\)/);
  assert.match(app, /const enterDualStart = \(\) => \{ setGuardianConfirmed\(false\)/);
  assert.match(app, /const \[dualStartPaused, setDualStartPaused\] = useState\(false\)/);
  assert.match(app, /const dualFirstStage = stages\[0\] \?\? FALLBACK_STAGE/);
  assert.match(app, /两个名字都亮起后 · 第一小步/);
  assert.match(app, /className="start-contract-meta"/);
  assert.match(styles, /\.start-contract-meta \{/);
  assert.match(app, /const calendarDetailRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(app, /const selectCalendarDay = \(key: string\) =>/);
  assert.match(app, /calendarDetailRef\.current\?\.scrollIntoView\(\{ block: "start", behavior: motionReduced \? "auto" : "smooth" \}\)/);
  assert.match(app, /onClick=\{\(\) => selectCalendarDay\(key\)\}/);
  assert.match(app, /ref=\{calendarDetailRef\} key=\{selectedDay\} className="day-detail"/);
  assert.match(app, /className="day-detail-header" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(styles, /\.day-detail \{[^}]*scroll-margin-top: 12px;[^}]*animation: day-detail-arrive/);
  assert.match(app, /className=\{`adjust-decision-dock \$\{effectiveAdjustChoice \? "is-ready" : "is-waiting"\}`\}/);
  assert.match(app, /aria-label="调整预览与确认"/);
  assert.match(app, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(app, /确认前不会改动 · 调整不扣能量 · 已完成进展会保留/);
  assert.match(styles, /\.adjust-decision-dock\.is-ready \.change-preview/);
  assert.match(styles, /\.adjust-screen \{ padding-bottom: calc\(176px \+ env\(safe-area-inset-bottom\)\); animation-fill-mode: none; \}/);
  assert.match(styles, /\.adjust-decision-dock \{ position: fixed;[^}]*bottom: 0;[^}]*width: min\(560px, calc\(100% - 36px\)\)/);
  assert.match(app, /if \(screenRef\.current === "dual-start" && next !== "dual-start"\)/);
  assert.match(app, /已经停住，可以再商量一下/);
  assert.match(app, /const guardianConfirmRef = useRef<HTMLButtonElement>\(null\)/);
  assert.match(app, /const launchCancelRef = useRef<HTMLButtonElement>\(null\)/);
  assert.match(app, /target\?\.scrollIntoView\(\{ block: "end", behavior: motionReduced \? "auto" : "smooth" \}\)/);
  assert.match(app, /target\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(app, /ref=\{launchCancelRef\} type="button" className="launch-cancel-button"/);
  assert.match(app, /ref=\{guardianConfirmRef\} aria-describedby="dual-start-status"/);
  assert.match(app, /约 3 秒后开始/);
  assert.match(styles, /animation: launch-fill 3\.2s linear both/);
  assert.match(app, /const adjustReturnScreen: LiveScreen = activeStage\.status === "done" \? "transition" : "running"/);
  assert.match(app, /pendingAfterActiveCount >= 2 \? \[\{ id: "swap" as const/);
  assert.match(app, /pendingAfterActiveCount >= 1 \? \[\{ id: "tomorrow" as const/);
  assert.match(app, /当前阶段 · \{activeTonightOrdinal\}\/\{tonightStageCount\}/);
  assert.match(app, /这不是指纹或身份验证/);
  assert.match(app, /卡住时随时可以调整/);
  assert.match(app, /可以同时点，也可以轮流点/);
  assert.match(app, /className="launch-cancel-button"/);
  assert.match(app, /className="launch-status-copy"/);
  assert.match(app, /即将进入/);
  assert.match(app, /aria-live="polite" aria-atomic="true"/);
  assert.match(styles, /@keyframes launch-fill/);
  assert.match(styles, /@media \(max-width: 380px\) and \(max-height: 640px\)[\s\S]*?\.press-zone \{ min-height: 132px/);
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
  assert.match(app, /window\.addEventListener\("focus", refreshNotificationPermission\)/);
  assert.match(app, /document\.addEventListener\("visibilitychange", refreshNotificationPermission\)/);
  assert.match(app, /setNotificationPermission\(Notification\.permission\)/);
  assert.match(app, /如需后台提醒，请在浏览器设置中重新允许/);
  assert.match(app, /锁屏或省电模式可能延迟/);
  assert.match(app, /const softLanding = shouldShowSoftLanding\(remainingSeconds, stageDue\)/);
  assert.match(app, /这一分钟，慢慢收一收/);
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
  const iconDirectory = new URL("../public/assets/icons/", import.meta.url);
  const mascotDirectory = new URL("../public/assets/mascot/", import.meta.url);
  await access(roomAsset);
  assert.ok((await stat(roomAsset)).size < 200_000, "energy room should stay below 200KB");
  const visualAssets = await Promise.all([
    ...(await readdir(iconDirectory)).filter(name => name.endsWith(".png")).map(name => stat(new URL(name, iconDirectory))),
    ...(await readdir(mascotDirectory)).filter(name => name.endsWith(".png")).map(name => stat(new URL(name, mascotDirectory))),
  ]);
  assert.ok(visualAssets.reduce((total, file) => total + file.size, 0) < 1_600_000, "icons and mascot poses should stay below 1.6MB combined");
  assert.ok((await stat(new URL("ready.png", mascotDirectory))).size < 50_000, "the primary mascot pose should stay below 50KB");
  assert.ok((await stat(new URL("home-heart.png", iconDirectory))).size < 35_000, "the primary app icon should stay below 35KB");
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
  assert.deepEqual(suggestInitialEveningWindow(new Date(2026, 6, 13, 21, 57)), { planStart: "22:00", planEnd: "23:30" });
  assert.deepEqual(suggestInitialEveningWindow(new Date(2026, 6, 13, 23, 57)), { planStart: "00:00", planEnd: "01:30" });
  assert.deepEqual(suggestInitialEveningWindow(new Date(2026, 6, 13, 4, 58)), { planStart: "05:00", planEnd: "06:30" });
  assert.deepEqual(suggestInitialEveningWindow(new Date(2026, 6, 13, 5, 0)), { planStart: "18:00", planEnd: "20:30" });
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
