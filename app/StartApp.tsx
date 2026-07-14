"use client";

import type { CSSProperties } from "react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ASSET_VERSION } from "./asset-version";
import { addMinutes, alignLiveStagesToStart, analyzePlan, canInsertRestBreak, clockDeltaMinutes, clockMinutesUntil, clockTimeFromDate, countCompletedTasks, deferNextPendingItem, durationMinutes, findPlanInsertionSlot, formatPlanClock, gentleRemainingLabel, insertRestBreak, millisecondsUntilNextMinute, moveTimedItemPreservingGaps, prepareNextRoundSchedule, rebaseFollowUpPlan, remainingTimerMinutes, scheduledEndTime, shiftFollowingForEndChange, shiftTimedItemsFrom, shiftTimedPlanToStart, spansMidnight, suggestInitialEveningWindow, swapNextPendingItems, titleAfterIconChoice } from "./plan-utils";
import { foregroundCueStatus, ReminderPermission, shouldShowSoftLanding, shouldUseBackgroundReminder, shouldUseForegroundCue, shouldUseHapticCue } from "./reminder-utils";
import { resolveHistoryTarget } from "./navigation-utils";
import { shiftCalendarSelection } from "./calendar-utils";
import { normalizeStageEnergy, restoreRewardRedemption, rewardThresholdBounds, stageEnergyLabel } from "./reward-utils";
import { suggestWeeklyFocus } from "./review-utils";
import { advanceStageStatuses, calculateNightBonus, deferActiveStage, familyNightDisplayLabel, familyNightKey, isLiveSessionFresh, keepNewestRecords, liveNightLabel, removeSessionAndReconcileEnergy, settlementFooterCopy } from "./session-utils";
import { compareSyncSnapshots, mergeUniqueById, PendingWrites } from "./sync-utils";
import { cleanShortText } from "./text-utils";

type Effort = 1 | 2 | 3;
type StageStatus = "pending" | "active" | "done" | "tomorrow";
type PromptReflection = "less" | "same" | "more";
type TransitionReason = "completed" | "due";
type AdjustmentChoice = "extend" | "rest" | "defer" | "swap" | "tomorrow" | "finish";
type Screen = "welcome" | "privacy" | "profile" | "home" | "plan" | "icon-picker" | "effort" | "confirm" | "dual-start" | "running" | "transition" | "adjust" | "wrap" | "night-saved" | "energy" | "reward-setup" | "reward-achieved" | "reward-saved" | "review" | "settings" | "risk";
type LiveScreen = "running" | "transition" | "adjust" | "wrap";
type NavigationMode = "push" | "replace";
type AppHistoryState = { xianKaishi: true; screen: Screen; depth: number };

type Stage = {
  id: string;
  title: string;
  icon: string;
  start: string;
  end: string;
  effort: Effort;
  energy: number;
  status: StageStatus;
  kind: "task" | "rest";
};

type RewardGoal = {
  threshold: number;
  title: string;
  icon: "game" | "book" | "move";
  date: string;
  participants: string[];
  redeemed: boolean;
  acknowledged: boolean;
};

type SessionRecord = {
  id: string;
  date: string;
  nightKey: string;
  stageCount: number;
  completedCount: number;
  completionUnit?: "tasks" | "nodes";
  adjustments: number;
  taskEnergy: number;
  cooperationEnergy: number;
  adjustmentEnergy: number;
  energyEarned: number;
  stageTitles: string[];
  promptReflection: PromptReflection | null;
};

type RewardHistory = { id: string; title: string; icon: "game" | "book" | "move"; threshold: number; energyBeforeReset: number; redeemedAt: string };
type RewardRedeemUndo = { rewardId: string; title: string; energy: number; rewardGoal: RewardGoal; rewardHistory: RewardHistory[] };
type WeeklyFocus = { weekKey: string; text: string; createdAt: string };
type PlanDraft = { updatedAt: string; planStart: string; planEnd: string; stages: Stage[] };
type PlanWindow = { planStart: string; planEnd: string };
type ShiftedPlanUndo = { times: Array<Pick<Stage, "id" | "start" | "end">>; message: string; planStart?: string; focusStageId?: string };
type ClearedPlanUndo = { stages: Stage[]; editingStageId: string; planStart: string; planEnd: string };
type StageAdvanceUndo = { stages: Stage[]; planEnd: string; activeIndex: number; activeEndsAt: number; stageDue: boolean; transitionReason: TransitionReason; nextTitle: string };
type SessionDeleteUndo = { recordId: string; label: string; sessions: SessionRecord[]; energy: number; message: string };
type LiveSessionDraft = { startedAt: string; updatedAt: string; screen: LiveScreen; planStart: string; planEnd: string; baselinePlanStart: string; baselinePlanEnd: string; stages: Stage[]; activeIndex: number; adjustments: number; activeEndsAt: number; stageDue: boolean; promptReflection: PromptReflection | null; transitionReason: TransitionReason };

type AppData = {
  consent: boolean;
  childAlias: string;
  guardianAlias: string;
  planStart: string;
  planEnd: string;
  energy: number;
  sound: boolean;
  reducedMotion: boolean;
  rewardGoal: RewardGoal;
  rewardHistory: RewardHistory[];
  sessions: SessionRecord[];
  weeklyFocus: WeeklyFocus | null;
};

const STORAGE_KEY = "xian-kaishi-family-v2";
const PLAN_DRAFT_KEY = "xian-kaishi-plan-draft-v1";
const LIVE_SESSION_KEY = "xian-kaishi-live-session-v1";
const REMINDER_PREF_KEY = "xian-kaishi-background-reminder-v1";
const FAMILY_REVISION_KEY = "xian-kaishi-family-revision-v1";
const FAMILY_UPDATED_AT_KEY = "xian-kaishi-family-updated-at-v1";
const PENDING_DELETE_KEY = "xian-kaishi-pending-cloud-delete-v1";
const LIVE_SCREENS: LiveScreen[] = ["running", "transition", "adjust", "wrap"];
const SCREEN_NAMES: Screen[] = ["welcome", "privacy", "profile", "home", "plan", "icon-picker", "effort", "confirm", "dual-start", "running", "transition", "adjust", "wrap", "night-saved", "energy", "reward-setup", "reward-achieved", "reward-saved", "review", "settings", "risk"];
const DUAL_START_DELAY_MS = 3200;
const MAX_PLAN_STAGES = 20;
const MAX_SESSION_RECORDS = 730;
const MAX_REWARD_HISTORY = 120;

const DEFAULT_DATA: AppData = {
  consent: false,
  childAlias: "",
  guardianAlias: "",
  planStart: "18:10",
  planEnd: "20:30",
  energy: 0,
  sound: true,
  reducedMotion: false,
  rewardGoal: { threshold: 20, title: "", icon: "game", date: "周六", participants: [], redeemed: true, acknowledged: false },
  rewardHistory: [],
  sessions: [],
  weeklyFocus: null,
};

const FALLBACK_STAGE: Stage = { id: "fallback", title: "当前阶段", icon: "custom", start: "18:10", end: "18:20", effort: 1, energy: 0, status: "pending", kind: "task" };

const ICON_LIBRARY = [
  ["custom","自定义"],["book","阅读"],["chinese","语文"],["english","英语"],["abacus","口算"],["science","科学"],["handwriting","书写"],["recite","朗读"],
  ["art","绘画"],["piano","钢琴"],["violin","小提琴"],["craft","手工"],["coding","编程"],["blocks","积木"],["chess","棋类"],["speech","表达"],
  ["rope","跳绳"],["basketball","篮球"],["badminton","羽毛球"],["move","活动"],["walk","散步"],["eye-rest","眼睛休息"],["quiet","安静休息"],["free-play","自由活动"],
  ["snack","加餐"],["dinner","晚餐"],["shower","洗澡"],["teeth","刷牙"],["clothes","整理衣物"],["lunchbox","准备餐盒"],["bedtime","睡前"],["alarm","准备出发"],
  ["backpack","整理书包"],["chores","家务"],["watering","浇水"],["pet","照顾宠物"],["dishes","洗碗"],["family-talk","家庭交流"],["family","亲子一起"],["plant","照顾植物"],
] as const;
const COMMON_ICON_NAMES = new Set<string>(["custom", "book", "chinese", "english", "abacus", "handwriting", "move", "walk", "quiet", "free-play", "snack", "dinner", "shower", "bedtime", "backpack", "family-talk"]);

const REWARD_IDEAS: Array<{ icon: RewardGoal["icon"]; label: string; title: string }> = [
  { icon: "game", label: "一起玩", title: "周末一起玩桌游" },
  { icon: "move", label: "去户外", title: "周末一起去公园" },
  { icon: "book", label: "选故事", title: "一起选一本睡前故事" },
];
const REWARD_DATE_IDEAS = ["周六", "周日", "下周末"];

function normalizeStages(value: unknown, preserveStatus = false): Stage[] {
  if (!Array.isArray(value)) return [];
  const allowedIcons = new Set<string>(ICON_LIBRARY.map(([icon]) => icon));
  const legacyRestIcons = new Set(["snack", "dinner", "move", "walk", "eye-rest", "quiet", "free-play", "shower", "teeth", "bedtime"]);
  return value.slice(0, MAX_PLAN_STAGES).flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Partial<Stage>;
    const effort: Effort = item.effort === 2 || item.effort === 3 ? item.effort : 1;
    const start = /^\d{2}:\d{2}$/.test(String(item.start)) ? String(item.start) : addMinutes("18:10", index * 20);
    const end = /^\d{2}:\d{2}$/.test(String(item.end)) ? String(item.end) : addMinutes(start, 20);
    const icon = allowedIcons.has(String(item.icon)) ? String(item.icon) : "custom";
    const kind = item.kind === "rest" || (!item.kind && legacyRestIcons.has(icon)) ? "rest" : "task";
    const energy = normalizeStageEnergy(item.energy, kind === "rest" ? 0 : 1);
    return [{
      id: String(item.id || createId("stage")), title: cleanShortText(String(item.title ?? ""), 24),
      icon, start, end, effort, energy, kind,
      status: preserveStatus && (item.status === "active" || item.status === "done" || item.status === "tomorrow") ? item.status : "pending" as const,
    }];
  });
}

function createId(prefix: string) {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `${prefix}-${suffix}`;
}

function interactionTimestamp() {
  return Date.now();
}

function localDateKey(date: string | Date) {
  return new Date(date).toLocaleDateString("en-CA");
}

function sessionTimeLabel(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }) : "这次";
}

function summarizeSessions(items: SessionRecord[]) {
  if (!items.length) return null;
  const uniqueStageTitles = Array.from(new Set(items.flatMap(item => item.stageTitles)));
  return {
    settlements: items.length,
    completed: items.reduce((sum, item) => sum + item.completedCount, 0),
    completionUnit: items.every(item => item.completionUnit === "tasks") ? "tasks" as const : "nodes" as const,
    adjustments: items.reduce((sum, item) => sum + item.adjustments, 0),
    energy: items.reduce((sum, item) => sum + item.energyEarned, 0),
    reflection: items.find(item => item.promptReflection)?.promptReflection ?? null,
    stageTitles: uniqueStageTitles.slice(0, 6),
    hiddenStageTitleCount: Math.max(0, uniqueStageTitles.length - 6),
  };
}

function normalizePromptReflection(value: unknown): PromptReflection | null {
  return value === "less" || value === "same" || value === "more" ? value : null;
}

function normalizeTransitionReason(value: unknown, wasDue = false): TransitionReason {
  return value === "completed" || value === "due" ? value : wasDue ? "due" : "completed";
}

function subscribeToNetworkStatus(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => { window.removeEventListener("online", onChange); window.removeEventListener("offline", onChange); };
}

function useOnlineStatus() {
  return useSyncExternalStore(subscribeToNetworkStatus, () => navigator.onLine, () => true);
}

function subscribeToReducedMotion(onChange: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }
  query.addListener(onChange);
  return () => query.removeListener(onChange);
}

function useSystemReducedMotion() {
  return useSyncExternalStore(subscribeToReducedMotion, () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => false);
}

async function retryPendingCloudDeletion() {
  const pendingFamilyId = localStorage.getItem(PENDING_DELETE_KEY) || "";
  if (!pendingFamilyId) return true;
  try {
    const response = await familyStateRequest(pendingFamilyId, { method: "DELETE" });
    const result = await readFamilyStateResponse(response);
    if (response.ok && result.ok && !result.localOnly) {
      localStorage.removeItem(PENDING_DELETE_KEY);
      return true;
    }
  } catch { /* retry after the browser reports that the network is back */ }
  return false;
}

function familyStateRequest(familyToken: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-family-token", familyToken);
  return fetch("/api/state", { ...init, headers, cache: "no-store" });
}

type FamilyStateResponse = {
  data?: unknown;
  updatedAt?: string;
  revision?: number;
  ok?: boolean;
  localOnly?: boolean;
};

function readFamilyStateResponse(response: Response) {
  return response.json() as Promise<FamilyStateResponse>;
}

function AppIcon({ name, className = "", loading = "eager" }: { name: string; className?: string; loading?: "eager" | "lazy" }) {
  return <picture className={`app-icon ${className}`}>
    <source srcSet={`/assets/optimized/icons/${name}.webp?v=${ASSET_VERSION}`} type="image/webp" />
    <img className="app-icon-image" src={`/assets/icons/${name}.png?v=${ASSET_VERSION}`} width="320" height="320" loading={loading} decoding="async" alt="" aria-hidden="true" />
  </picture>;
}

function Mascot({ mood = "ready", compact = false }: { mood?: "ready" | "confirm" | "breathe" | "support" | "celebrate"; compact?: boolean }) {
  return <div className={`mascot mascot-${mood} ${compact ? "mascot-compact" : ""}`} aria-hidden="true">
    <div className="mascot-halo" />
    <picture className="optimized-picture">
      <source srcSet={`/assets/optimized/mascot/${mood}.webp?v=${ASSET_VERSION}`} type="image/webp" />
      <img className="mascot-pose" src={`/assets/mascot/${mood}.png?v=${ASSET_VERSION}`} width="640" height="640" decoding="async" alt="" />
    </picture>
    {mood === "ready" && <picture className="optimized-picture">
      <source srcSet={`/assets/optimized/mascot/blink.webp?v=${ASSET_VERSION}`} type="image/webp" />
      <img className="mascot-pose mascot-blink-frame" src={`/assets/mascot/blink.png?v=${ASSET_VERSION}`} width="640" height="640" loading="lazy" decoding="async" fetchPriority="low" alt="" />
    </picture>}
    {mood === "celebrate" && <><i className="mascot-spark spark-one" /><i className="mascot-spark spark-two" /><i className="mascot-spark spark-three" /></>}
  </div>;
}

function Header({ title, back, backLabel = "返回上一页", step }: { title?: string; back?: () => void; backLabel?: string; step?: string }) {
  return <header className="app-header">
    {back ? <button className="icon-button" onClick={back} aria-label={backLabel}>‹</button> : <span className="header-spacer" />}
    <strong data-screen-heading={title ? "true" : undefined} tabIndex={title ? -1 : undefined}>{title}</strong>
    {step ? <span className="step-pill">{step}</span> : <span className="header-spacer" />}
  </header>;
}

function BottomNav({ screen, go, openCalendar }: { screen: Screen; go: (screen: Screen) => void; openCalendar: () => void }) {
  const items: Array<[Screen, string, string]> = [["home", "home-heart", "首页"], ["review", "chart", "日历"], ["energy", "plant", "能量"], ["settings", "privacy", "设置"]];
  return <nav className="bottom-nav" aria-label="主导航">{items.map(([id, icon, label]) => <button key={id} aria-current={screen === id ? "page" : undefined} className={screen === id ? "active" : ""} onClick={id === "review" ? openCalendar : () => go(id)}><AppIcon name={icon} /><small>{label}</small></button>)}</nav>;
}

function normalizeData(value: unknown): AppData {
  if (!value || typeof value !== "object") return DEFAULT_DATA;
  const old = value as Record<string, unknown>;
  const childAlias = String(old.childAlias ?? old.alias ?? "孩子").slice(0, 12);
  const guardianAlias = String(old.guardianAlias ?? "大人").slice(0, 12);
  const goal = old.rewardGoal && typeof old.rewardGoal === "object" ? old.rewardGoal as Partial<RewardGoal> : DEFAULT_DATA.rewardGoal;
  const goalRedeemed = Boolean(goal.redeemed);
  const goalIcon: RewardGoal["icon"] = goal.icon === "book" || goal.icon === "move" || goal.icon === "game" ? goal.icon : String(goal.title).includes("故事") ? "book" : String(goal.title).includes("散步") ? "move" : "game";
  const goalThreshold = Math.max(10, Math.min(100, Math.round(Number(goal.threshold) || DEFAULT_DATA.rewardGoal.threshold)));
  const sessions = Array.isArray(old.sessions) ? keepNewestRecords(old.sessions.map((item, index) => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const legacyTasks = Array.isArray(record.tasks) ? record.tasks.length : 0;
    const date = String(record.date ?? new Date().toISOString());
    const storedNightKey = String(record.nightKey ?? "");
    return {
      id: String(record.id ?? `legacy-${index}`), date, nightKey: /^\d{4}-\d{2}-\d{2}$/.test(storedNightKey) ? storedNightKey : familyNightKey(date),
      stageCount: Number(record.stageCount ?? legacyTasks), completedCount: Number(record.completedCount ?? legacyTasks),
      completionUnit: record.completionUnit === "tasks" ? "tasks" : "nodes",
      adjustments: Number(record.adjustments ?? 0),
      taskEnergy: Number(record.taskEnergy ?? record.childEnergy ?? 0), cooperationEnergy: Number(record.cooperationEnergy ?? record.guardianEnergy ?? record.parentEnergy ?? 0),
      adjustmentEnergy: Number(record.adjustmentEnergy ?? Math.max(0, Number(record.energyEarned ?? 0) - Number(record.taskEnergy ?? record.childEnergy ?? 0) - Number(record.cooperationEnergy ?? record.guardianEnergy ?? record.parentEnergy ?? 0))),
      energyEarned: Number(record.energyEarned ?? (Number(record.taskEnergy ?? record.childEnergy ?? 0) + Number(record.cooperationEnergy ?? record.guardianEnergy ?? record.parentEnergy ?? 0))),
      stageTitles: Array.isArray(record.stageTitles) ? record.stageTitles.map(item => cleanShortText(String(item), 24)) : Array.isArray(record.tasks) ? record.tasks.map(item => cleanShortText(String(item), 24)) : [],
      promptReflection: normalizePromptReflection(record.promptReflection),
    } satisfies SessionRecord;
  }), item => item.date, MAX_SESSION_RECORDS) : [];
  const focus = old.weeklyFocus && typeof old.weeklyFocus === "object" ? old.weeklyFocus as Partial<WeeklyFocus> : null;
  return {
    consent: Boolean(old.consent ?? DEFAULT_DATA.consent), childAlias, guardianAlias,
    planStart: String(old.planStart ?? DEFAULT_DATA.planStart), planEnd: String(old.planEnd ?? DEFAULT_DATA.planEnd), energy: Math.max(0, Number(old.energy ?? DEFAULT_DATA.energy) || 0),
    sound: typeof old.sound === "boolean" ? old.sound : DEFAULT_DATA.sound,
    reducedMotion: typeof old.reducedMotion === "boolean" ? old.reducedMotion : DEFAULT_DATA.reducedMotion,
    rewardGoal: { ...DEFAULT_DATA.rewardGoal, ...goal, threshold: goalThreshold, icon: goalIcon, title: goalRedeemed ? "" : String(goal.title || DEFAULT_DATA.rewardGoal.title).slice(0, 24), date: String(goal.date || DEFAULT_DATA.rewardGoal.date).slice(0, 16), participants: [guardianAlias, childAlias], redeemed: goalRedeemed, acknowledged: Boolean(goal.acknowledged) },
    rewardHistory: Array.isArray(old.rewardHistory) ? keepNewestRecords(old.rewardHistory.flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Partial<RewardHistory>;
      const icon: RewardHistory["icon"] = record.icon === "book" || record.icon === "move" || record.icon === "game" ? record.icon : "game";
      const threshold = Math.max(0, Number(record.threshold) || 0);
      return [{ id: String(record.id || `reward-${index}`), title: String(record.title || "家庭期待").slice(0, 24), icon, threshold, energyBeforeReset: Math.max(threshold, Number(record.energyBeforeReset) || threshold), redeemedAt: String(record.redeemedAt || new Date().toISOString()) }];
    }), item => item.redeemedAt, MAX_REWARD_HISTORY) : [], sessions,
    weeklyFocus: focus && /^\d{4}-\d{2}-\d{2}$/.test(String(focus.weekKey)) && String(focus.text).trim() ? { weekKey: String(focus.weekKey), text: String(focus.text).slice(0, 80), createdAt: String(focus.createdAt || new Date().toISOString()) } : null,
  };
}

function mergeFamilyData(preferred: AppData, other: AppData): AppData {
  return {
    ...other,
    ...preferred,
    sessions: keepNewestRecords(mergeUniqueById(preferred.sessions, other.sessions), item => item.date, MAX_SESSION_RECORDS),
    rewardHistory: keepNewestRecords(mergeUniqueById(preferred.rewardHistory, other.rewardHistory), item => item.redeemedAt, MAX_REWARD_HISTORY),
  };
}

export function StartApp() {
  const [data, setData] = useState(DEFAULT_DATA);
  const [appReady, setAppReady] = useState(false);
  const [familyId, setFamilyId] = useState("");
  const [screen, setScreen] = useState<Screen>("welcome");
  const [consent, setConsent] = useState(false);
  const [stages, setStages] = useState<Stage[]>([]);
  const [editingStageId, setEditingStageId] = useState("");
  const [editingDurationStageId, setEditingDurationStageId] = useState("");
  const [editingEnergyStageId, setEditingEnergyStageId] = useState("");
  const [showAllIcons, setShowAllIcons] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [adjustments, setAdjustments] = useState(0);
  const [adjustChoice, setAdjustChoice] = useState<AdjustmentChoice | null>(null);
  const [guardianConfirmed, setGuardianConfirmed] = useState(false);
  const [childConfirmed, setChildConfirmed] = useState(false);
  const [dualStartPaused, setDualStartPaused] = useState(false);
  const [selectedDay, setSelectedDay] = useState(() => localDateKey(new Date()));
  const [calendarCursor, setCalendarCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [toast, setToast] = useState("");
  const [followUpPlanMessage, setFollowUpPlanMessage] = useState("");
  const [syncLabel, setSyncLabel] = useState("本机已保存");
  const isOnline = useOnlineStatus();
  const systemReducedMotion = useSystemReducedMotion();
  const motionReduced = data.reducedMotion || systemReducedMotion;
  const [deletingData, setDeletingData] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [pendingCloudDeletion, setPendingCloudDeletion] = useState(false);
  const [deletionNotice, setDeletionNotice] = useState<"complete" | "pending" | null>(null);
  const [activeEndsAt, setActiveEndsAt] = useState(0);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [stageDue, setStageDue] = useState(false);
  const [planHydrated, setPlanHydrated] = useState(false);
  const [draftUpdatedAt, setDraftUpdatedAt] = useState("");
  const [clearPlanArmed, setClearPlanArmed] = useState(false);
  const [liveSessionAvailable, setLiveSessionAvailable] = useState(false);
  const [liveResumeScreen, setLiveResumeScreen] = useState<LiveScreen>("running");
  const [liveSessionStartedAt, setLiveSessionStartedAt] = useState("");
  const [privacyReturn, setPrivacyReturn] = useState<"welcome" | "settings">("welcome");
  const [profileReturn, setProfileReturn] = useState<"welcome" | "settings">("welcome");
  const [deletedStage, setDeletedStage] = useState<{ stage: Stage; index: number } | null>(null);
  const [shiftedPlanUndo, setShiftedPlanUndo] = useState<ShiftedPlanUndo | null>(null);
  const [clearedPlanUndo, setClearedPlanUndo] = useState<ClearedPlanUndo | null>(null);
  const [stageAdvanceUndo, setStageAdvanceUndo] = useState<StageAdvanceUndo | null>(null);
  const [sessionDeleteArmedId, setSessionDeleteArmedId] = useState("");
  const [sessionDeleteUndo, setSessionDeleteUndo] = useState<SessionDeleteUndo | null>(null);
  const [promptReflection, setPromptReflection] = useState<PromptReflection | null>(null);
  const [transitionReason, setTransitionReason] = useState<TransitionReason>("completed");
  const [rewardDraft, setRewardDraft] = useState<RewardGoal>(DEFAULT_DATA.rewardGoal);
  const [rewardEnergyConfirmed, setRewardEnergyConfirmed] = useState(false);
  const [lastSavedSession, setLastSavedSession] = useState<SessionRecord | null>(null);
  const [lastRedeemedReward, setLastRedeemedReward] = useState<RewardHistory | null>(null);
  const [rewardRedeemUndo, setRewardRedeemUndo] = useState<RewardRedeemUndo | null>(null);
  const [rewardReachedFromNight, setRewardReachedFromNight] = useState(false);
  const [dayDetailsExpanded, setDayDetailsExpanded] = useState(false);
  const [confirmPlanExpanded, setConfirmPlanExpanded] = useState(false);
  const [redeemArmed, setRedeemArmed] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<ReminderPermission>(() => typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported");
  const [backgroundReminder, setBackgroundReminder] = useState(() => typeof window !== "undefined" && localStorage.getItem(REMINDER_PREF_KEY) === "true");
  const [requestingNotificationPermission, setRequestingNotificationPermission] = useState(false);
  const dueReminderPlayed = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const phoneShellRef = useRef<HTMLElement>(null);
  const addNodeButtonRef = useRef<HTMLButtonElement>(null);
  const planStartInputRef = useRef<HTMLInputElement>(null);
  const childAliasInputRef = useRef<HTMLInputElement>(null);
  const guardianAliasInputRef = useRef<HTMLInputElement>(null);
  const rewardTitleInputRef = useRef<HTMLInputElement>(null);
  const rewardDateInputRef = useRef<HTMLInputElement>(null);
  const rewardEnergyConfirmRef = useRef<HTMLInputElement>(null);
  const clearPlanArmedRef = useRef(false);
  const clearPlanArmSequence = useRef(0);
  const finishNightLock = useRef(false);
  const redeemRewardLock = useRef(false);
  const familyRevisionRef = useRef(0);
  const familyUpdatedAtRef = useRef("");
  const familyDataRef = useRef<AppData>(DEFAULT_DATA);
  const pendingWritesRef = useRef(new PendingWrites());
  const deleteInProgressRef = useRef(false);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const deleteConfirmRef = useRef<HTMLButtonElement>(null);
  const sessionDeleteCancelRef = useRef<HTMLButtonElement>(null);
  const sessionDeleteUndoRef = useRef<HTMLButtonElement>(null);
  const calendarDetailRef = useRef<HTMLDivElement>(null);
  const rewardRedeemTriggerRef = useRef<HTMLButtonElement>(null);
  const rewardRedeemCancelRef = useRef<HTMLButtonElement>(null);
  const deleteReturnFocusRef = useRef<HTMLElement | null>(null);
  const screenRef = useRef<Screen>("welcome");
  const historyReadyRef = useRef(false);
  const historyDepthRef = useRef(0);
  const stageTimeEditRef = useRef<{ id: string; field: "start" | "end"; times: Array<Pick<Stage, "id" | "start" | "end">> } | null>(null);
  const planWindowEditRef = useRef<{ field: "start" | "end"; planStart: string; planEnd: string; times: Array<Pick<Stage, "id" | "start" | "end">> } | null>(null);
  const guardianConfirmRef = useRef<HTMLButtonElement>(null);
  const launchCancelRef = useRef<HTMLButtonElement>(null);
  const rewardExitHandlerRef = useRef<() => void>(() => undefined);
  const sessionPlanWindowRef = useRef<PlanWindow | null>(null);

  const focusSessionDeleteTrigger = (recordId: string) => {
    window.requestAnimationFrame(() => {
      const button = Array.from(phoneShellRef.current?.querySelectorAll<HTMLButtonElement>("[data-session-delete-id]") ?? [])
        .find(item => item.dataset.sessionDeleteId === recordId);
      button?.focus();
    });
  };

  const showScreen = (next: Screen) => {
    if (screenRef.current === "dual-start" && next !== "dual-start") {
      setGuardianConfirmed(false); setChildConfirmed(false); setDualStartPaused(false);
    }
    if (screenRef.current === "reward-achieved" && next !== "reward-achieved") {
      rewardExitHandlerRef.current();
    }
    if (LIVE_SCREENS.includes(next as LiveScreen)) { setLiveResumeScreen(next as LiveScreen); setLiveSessionStartedAt(value => value || new Date().toISOString()); setLiveSessionAvailable(true); }
    screenRef.current = next;
    setScreen(next);
    phoneShellRef.current?.scrollTo({ top: 0, behavior: "auto" });
    window.requestAnimationFrame(() => {
      const heading = phoneShellRef.current?.querySelector<HTMLElement>("[data-screen-heading], h1");
      if (!heading) return;
      if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    });
  };

  const go = (next: Screen, mode: NavigationMode = "push") => {
    const current = screenRef.current;
    if (next === current) return;
    const replace = mode === "replace" || LIVE_SCREENS.includes(current as LiveScreen) || (current !== "home" && LIVE_SCREENS.includes(next as LiveScreen));
    if (historyReadyRef.current) {
      const depth = replace ? historyDepthRef.current : historyDepthRef.current + 1;
      const state: AppHistoryState = { xianKaishi: true, screen: next, depth };
      window.history[replace ? "replaceState" : "pushState"](state, "");
      historyDepthRef.current = depth;
    }
    showScreen(next);
  };

  const back = (fallback: Screen) => {
    const state = window.history.state as Partial<AppHistoryState> | null;
    if (historyReadyRef.current && state?.xianKaishi && historyDepthRef.current > 0) window.history.back();
    else go(fallback, "replace");
  };

  useEffect(() => {
    screenRef.current = screen;
    if (!appReady || !historyReadyRef.current) return;
    const state = window.history.state as Partial<AppHistoryState> | null;
    if (state?.xianKaishi && state.screen !== screen) window.history.replaceState({ xianKaishi: true, screen, depth: historyDepthRef.current } satisfies AppHistoryState, "");
  }, [appReady, screen]);

  useEffect(() => {
    if (!appReady) return;
    if (!historyReadyRef.current) {
      const initial: AppHistoryState = { xianKaishi: true, screen: screenRef.current, depth: 0 };
      window.history.replaceState(initial, ""); historyReadyRef.current = true; historyDepthRef.current = 0;
    }
    const handlePopState = (event: PopStateEvent) => {
      const state = event.state as Partial<AppHistoryState> | null;
      if (!state?.xianKaishi || !SCREEN_NAMES.includes(state.screen as Screen)) return;
      const current = screenRef.current;
      const target = state.screen as Screen;
      if (familyDataRef.current.consent && (target === "welcome" || target === "profile")) {
        const depth = Math.max(0, Number(state.depth) || 0);
        historyDepthRef.current = depth;
        window.history.replaceState({ xianKaishi: true, screen: "home", depth } satisfies AppHistoryState, "");
        showScreen("home");
        return;
      }
      const resolved = resolveHistoryTarget(current, target);
      if (resolved.blocked) {
        window.history.pushState({ xianKaishi: true, screen: current, depth: historyDepthRef.current } satisfies AppHistoryState, "");
        setToast("今晚还在进行，可以调整计划或结束本次计划"); return;
      }
      if (resolved.collapseToRoot && Number(state.depth) > 0) {
        screenRef.current = "home"; setScreen("home"); historyDepthRef.current = 0; window.history.go(-Number(state.depth)); return;
      }
      historyDepthRef.current = Math.max(0, Number(state.depth) || 0);
      showScreen(resolved.screen as Screen);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
    // The listener reads changing navigation state through refs.
  }, [appReady]);

  const openPrivacy = (from: "welcome" | "settings") => { setPrivacyReturn(from); go("privacy"); };
  const openProfile = (from: "welcome" | "settings") => { setProfileReturn(from); if (from === "welcome") setDeletionNotice(null); go("profile"); };
  const openAdjust = () => { setStageAdvanceUndo(null); setAdjustChoice(null); go("adjust"); };
  const openConfirmPlan = () => { setConfirmPlanExpanded(false); setClockNow(interactionTimestamp()); go("confirm"); };
  const enterDualStart = () => { setGuardianConfirmed(false); setChildConfirmed(false); setDualStartPaused(false); setClockNow(interactionTimestamp()); go("dual-start"); };
  const leaveDualStart = () => { setGuardianConfirmed(false); setChildConfirmed(false); setDualStartPaused(false); back("confirm"); };
  const cancelDualLaunch = () => {
    setGuardianConfirmed(false); setChildConfirmed(false); setDualStartPaused(true);
    window.requestAnimationFrame(() => {
      const target = guardianConfirmRef.current;
      target?.scrollIntoView({ block: "center", behavior: motionReduced ? "auto" : "smooth" });
      target?.focus({ preventScroll: true });
    });
  };
  const toggleParticipant = (role: "guardian" | "child") => {
    setDualStartPaused(false);
    playTone("tap"); gentleVibrate(18);
    if (role === "guardian") setGuardianConfirmed(value => !value);
    else setChildConfirmed(value => !value);
  };
  const openRewardSetup = () => {
    const next = data.rewardGoal.redeemed ? { ...data.rewardGoal, title: "", icon: "game" as const, threshold: 20, redeemed: false, acknowledged: false } : { ...data.rewardGoal };
    setRewardDraft(next); setRewardEnergyConfirmed(false); go("reward-setup");
  };

  const reviseRewardDraft = (patch: Partial<RewardGoal>) => {
    setRewardDraft(current => ({ ...current, ...patch }));
    if (rewardEnergyConfirmed) setToast("约定有变化，请两个人再确认一次");
    setRewardEnergyConfirmed(false);
  };

  const openRewardAchieved = (fromNight = false) => {
    redeemRewardLock.current = false;
    setRedeemArmed(false);
    setRewardReachedFromNight(fromNight);
    go("reward-achieved");
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const pendingDeletionId = localStorage.getItem(PENDING_DELETE_KEY) || "";
      if (pendingDeletionId) {
        [STORAGE_KEY, "xian-kaishi-family-v1", PLAN_DRAFT_KEY, LIVE_SESSION_KEY, REMINDER_PREF_KEY, FAMILY_REVISION_KEY, FAMILY_UPDATED_AT_KEY, "xian-kaishi-family-id"].forEach(key => localStorage.removeItem(key));
        setPendingCloudDeletion(true); setDeletionNotice("pending");
        void retryPendingCloudDeletion().then(cleared => { setPendingCloudDeletion(!cleared); if (cleared) setDeletionNotice("complete"); });
      }
      const id = localStorage.getItem("xian-kaishi-family-id") || createId("family");
      localStorage.setItem("xian-kaishi-family-id", id);
      setFamilyId(id);
      const localDraft = localStorage.getItem(PLAN_DRAFT_KEY);
      let parsedDraft: Partial<PlanDraft> | null = null;
      if (localDraft) {
        try {
          parsedDraft = JSON.parse(localDraft) as Partial<PlanDraft>;
          setStages(normalizeStages(parsedDraft.stages)); setDraftUpdatedAt(String(parsedDraft.updatedAt ?? ""));
        } catch { /* keep the editable starter plan */ }
      }
      const localLive = localStorage.getItem(LIVE_SESSION_KEY);
      let livePlanStart = ""; let livePlanEnd = "";
      if (localLive) {
        try {
          const live = JSON.parse(localLive) as Partial<LiveSessionDraft>;
          const startedAt = String(live.startedAt || live.updatedAt || "");
          const updatedAt = String(live.updatedAt || "");
          const fresh = isLiveSessionFresh(startedAt, updatedAt);
          const liveStages = normalizeStages(live.stages, true);
          const savedScreen = LIVE_SCREENS.includes(live.screen as LiveScreen) ? live.screen as LiveScreen : "running";
          if (fresh && liveStages.length) {
            livePlanStart = /^\d{2}:\d{2}$/.test(String(live.planStart)) ? String(live.planStart) : liveStages[0].start;
            livePlanEnd = /^\d{2}:\d{2}$/.test(String(live.planEnd)) ? String(live.planEnd) : liveStages.at(-1)?.end ?? livePlanStart;
            const draftPlanStart = /^\d{2}:\d{2}$/.test(String(parsedDraft?.planStart)) ? String(parsedDraft?.planStart) : livePlanStart;
            const draftPlanEnd = /^\d{2}:\d{2}$/.test(String(parsedDraft?.planEnd)) ? String(parsedDraft?.planEnd) : livePlanEnd;
            sessionPlanWindowRef.current = {
              planStart: /^\d{2}:\d{2}$/.test(String(live.baselinePlanStart)) ? String(live.baselinePlanStart) : draftPlanStart,
              planEnd: /^\d{2}:\d{2}$/.test(String(live.baselinePlanEnd)) ? String(live.baselinePlanEnd) : draftPlanEnd,
            };
            setStages(liveStages); setActiveIndex(Math.max(0, Math.min(liveStages.length - 1, Number(live.activeIndex) || 0)));
            setAdjustments(Math.max(0, Number(live.adjustments) || 0)); setActiveEndsAt(Math.max(0, Number(live.activeEndsAt) || 0));
            const restoredStageDue = Boolean(live.stageDue);
            dueReminderPlayed.current = restoredStageDue;
            setStageDue(restoredStageDue); setTransitionReason(normalizeTransitionReason(live.transitionReason, restoredStageDue)); setPromptReflection(normalizePromptReflection(live.promptReflection)); setLiveResumeScreen(savedScreen); setLiveSessionStartedAt(startedAt); setLiveSessionAvailable(true);
          } else localStorage.removeItem(LIVE_SESSION_KEY);
        } catch { localStorage.removeItem(LIVE_SESSION_KEY); }
      }
      const withDraftWindow = (next: AppData): AppData => ({
        ...next,
        planStart: livePlanStart || (/^\d{2}:\d{2}$/.test(String(parsedDraft?.planStart)) ? String(parsedDraft?.planStart) : next.planStart),
        planEnd: livePlanEnd || (/^\d{2}:\d{2}$/.test(String(parsedDraft?.planEnd)) ? String(parsedDraft?.planEnd) : next.planEnd),
      });
      const local = localStorage.getItem(STORAGE_KEY) || localStorage.getItem("xian-kaishi-family-v1");
      let validLocal = false;
      if (local) {
        try {
          const next = withDraftWindow(normalizeData(JSON.parse(local)));
          const revision = Math.max(0, Math.floor(Number(localStorage.getItem(FAMILY_REVISION_KEY)) || 0));
          const updatedAt = localStorage.getItem(FAMILY_UPDATED_AT_KEY) || new Date().toISOString();
          familyDataRef.current = next; familyRevisionRef.current = revision; familyUpdatedAtRef.current = updatedAt;
          localStorage.setItem(FAMILY_UPDATED_AT_KEY, updatedAt);
          validLocal = true;
          setData(next); setConsent(next.consent); setScreen(next.consent ? "home" : "welcome");
        } catch { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem("xian-kaishi-family-v1"); }
      }
      setPlanHydrated(true);
      if (validLocal) setAppReady(true);
      familyStateRequest(id).then(readFamilyStateResponse).then(result => {
        const hasLocal = validLocal || familyRevisionRef.current > 0;
        if (result.data) {
          const remote = withDraftWindow(normalizeData(result.data));
          const remoteRevision = Math.max(0, Math.floor(Number(result.revision) || 0));
          const remoteUpdatedAt = String(result.updatedAt || "");
          const winner = hasLocal ? compareSyncSnapshots(
            { revision: familyRevisionRef.current, updatedAt: familyUpdatedAtRef.current },
            { revision: remoteRevision, updatedAt: remoteUpdatedAt },
          ) : "remote";
          if (winner === "remote") {
            familyDataRef.current = remote; familyRevisionRef.current = remoteRevision; familyUpdatedAtRef.current = remoteUpdatedAt;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(remote)); localStorage.setItem(FAMILY_REVISION_KEY, String(remoteRevision)); localStorage.setItem(FAMILY_UPDATED_AT_KEY, remoteUpdatedAt);
            setData(remote); setConsent(remote.consent); setScreen(remote.consent ? "home" : "welcome"); setSyncLabel("云端副本已更新");
          } else if (winner === "local") {
            const localRevision = familyRevisionRef.current <= remoteRevision ? remoteRevision + 1 : familyRevisionRef.current;
            familyRevisionRef.current = localRevision; localStorage.setItem(FAMILY_REVISION_KEY, String(localRevision)); setSyncLabel("正在补传本机更新…");
            const initialSync = familyStateRequest(id, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: familyDataRef.current, revision: localRevision }) })
              .then(readFamilyStateResponse).then(sync => setSyncLabel(sync.ok ? "云端副本已更新" : "已保留本机更新"))
              .catch(() => setSyncLabel("仅保存在本机"));
            void pendingWritesRef.current.track(initialSync);
          } else setSyncLabel("云端副本已更新");
        } else if (hasLocal) {
          const localRevision = Math.max(1, familyRevisionRef.current); familyRevisionRef.current = localRevision;
          localStorage.setItem(FAMILY_REVISION_KEY, String(localRevision)); setSyncLabel("正在补传本机更新…");
          const initialSync = familyStateRequest(id, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: familyDataRef.current, revision: localRevision }) })
            .then(readFamilyStateResponse).then(sync => setSyncLabel(sync.ok ? "云端副本已更新" : "已保留本机更新"))
            .catch(() => setSyncLabel("仅保存在本机"));
          void pendingWritesRef.current.track(initialSync);
        }
      }).catch(() => setSyncLabel("仅保存在本机")).finally(() => setAppReady(true));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!planHydrated || LIVE_SCREENS.includes(screen as LiveScreen)) return;
    const timer = window.setTimeout(() => {
      const updatedAt = new Date().toISOString();
      const safeStages = stages.map(item => ({ ...item, status: "pending" as const }));
      localStorage.setItem(PLAN_DRAFT_KEY, JSON.stringify({ updatedAt, planStart: data.planStart, planEnd: data.planEnd, stages: safeStages } satisfies PlanDraft));
      setDraftUpdatedAt(updatedAt);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [data.planEnd, data.planStart, planHydrated, screen, stages]);

  useEffect(() => {
    if (!planHydrated || !LIVE_SCREENS.includes(screen as LiveScreen) || !stages.length) return;
    const updatedAt = new Date().toISOString();
    const liveScreen = screen as LiveScreen;
    const startedAt = liveSessionStartedAt || updatedAt;
    const baseline = sessionPlanWindowRef.current ?? { planStart: data.planStart, planEnd: data.planEnd };
    localStorage.setItem(LIVE_SESSION_KEY, JSON.stringify({ startedAt, updatedAt, screen: liveScreen, planStart: data.planStart, planEnd: data.planEnd, baselinePlanStart: baseline.planStart, baselinePlanEnd: baseline.planEnd, stages, activeIndex, adjustments, activeEndsAt, stageDue, promptReflection, transitionReason } satisfies LiveSessionDraft));
  }, [activeEndsAt, activeIndex, adjustments, data.planEnd, data.planStart, liveSessionStartedAt, planHydrated, promptReflection, screen, stageDue, stages, transitionReason]);

  useEffect(() => {
    if (!toast) return;
    const readableDuration = Math.min(5200, Math.max(3000, 2000 + toast.length * 90));
    const timer = window.setTimeout(() => setToast(""), readableDuration);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => () => {
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== "closed") void context.close();
  }, []);

  useEffect(() => {
    if (!stageAdvanceUndo) return;
    const timer = window.setTimeout(() => setStageAdvanceUndo(null), 12000);
    return () => window.clearTimeout(timer);
  }, [stageAdvanceUndo]);

  useEffect(() => {
    if (!sessionDeleteUndo) return;
    const timer = window.setTimeout(() => setSessionDeleteUndo(null), 12000);
    const focusFrame = window.requestAnimationFrame(() => sessionDeleteUndoRef.current?.focus());
    return () => { window.clearTimeout(timer); window.cancelAnimationFrame(focusFrame); };
  }, [sessionDeleteUndo]);

  useEffect(() => {
    if (!rewardRedeemUndo) return;
    const timer = window.setTimeout(() => setRewardRedeemUndo(null), 30000);
    return () => window.clearTimeout(timer);
  }, [rewardRedeemUndo]);

  useEffect(() => {
    if (!sessionDeleteArmedId) return;
    const recordId = sessionDeleteArmedId;
    const focusFrame = window.requestAnimationFrame(() => sessionDeleteCancelRef.current?.focus());
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); setSessionDeleteArmedId(""); focusSessionDeleteTrigger(recordId);
    };
    window.addEventListener("keydown", handleEscape);
    return () => { window.cancelAnimationFrame(focusFrame); window.removeEventListener("keydown", handleEscape); };
  }, [sessionDeleteArmedId]);

  useEffect(() => {
    if (!redeemArmed) return;
    const focusFrame = window.requestAnimationFrame(() => rewardRedeemCancelRef.current?.focus());
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); setRedeemArmed(false);
      window.requestAnimationFrame(() => rewardRedeemTriggerRef.current?.focus());
    };
    window.addEventListener("keydown", handleEscape);
    return () => { window.cancelAnimationFrame(focusFrame); window.removeEventListener("keydown", handleEscape); };
  }, [redeemArmed]);

  useEffect(() => {
    if (!("Notification" in window)) return;
    const refreshNotificationPermission = () => {
      if (document.visibilityState === "visible") setNotificationPermission(Notification.permission);
    };
    window.addEventListener("focus", refreshNotificationPermission);
    document.addEventListener("visibilitychange", refreshNotificationPermission);
    return () => {
      window.removeEventListener("focus", refreshNotificationPermission);
      document.removeEventListener("visibilitychange", refreshNotificationPermission);
    };
  }, []);

  useEffect(() => {
    if (!deleteArmed) return;
    const focusTimer = window.requestAnimationFrame(() => deleteCancelRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (deletingData) return;
      if (event.key === "Escape") {
        setDeleteArmed(false);
        window.requestAnimationFrame(() => deleteReturnFocusRef.current?.focus());
        return;
      }
      if (event.key !== "Tab") return;
      const first = deleteCancelRef.current;
      const last = deleteConfirmRef.current;
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => { window.cancelAnimationFrame(focusTimer); window.removeEventListener("keydown", handleKeyDown); };
  }, [deleteArmed, deletingData]);

  useEffect(() => {
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    let workerIdleHandle = 0;
    let workerTimer = 0;
    const registerServiceWorker = () => {
      if ("serviceWorker" in navigator && window.isSecureContext) void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    };
    const scheduleServiceWorker = () => {
      if (idleWindow.requestIdleCallback) workerIdleHandle = idleWindow.requestIdleCallback(registerServiceWorker, { timeout: 2500 });
      else workerTimer = window.setTimeout(registerServiceWorker, 1200);
    };
    if (document.readyState === "complete") scheduleServiceWorker();
    else window.addEventListener("load", scheduleServiceWorker, { once: true });
    const handleOffline = () => {
      setSyncLabel("离线 · 已保存在本机");
      setToast("网络暂时不可用，今晚仍会保存在本机");
    };
    const handleOnline = async () => {
      if (deleteInProgressRef.current) return;
      const hadPendingDeletion = Boolean(localStorage.getItem(PENDING_DELETE_KEY));
      const deletionCleared = await retryPendingCloudDeletion();
      setPendingCloudDeletion(!deletionCleared);
      if (hadPendingDeletion) setDeletionNotice(deletionCleared ? "complete" : "pending");
      if (deleteInProgressRef.current) return;
      const activeFamilyId = localStorage.getItem("xian-kaishi-family-id") || "";
      const revision = familyRevisionRef.current;
      if (!activeFamilyId || revision < 1) { setSyncLabel("网络已恢复"); return; }
      setSyncLabel("网络已恢复，正在更新云端副本…");
      const syncPromise = (async () => {
        try {
          const response = await familyStateRequest(activeFamilyId, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: familyDataRef.current, revision }) });
          const result = await readFamilyStateResponse(response);
          if (revision !== familyRevisionRef.current || deleteInProgressRef.current) return;
          if (response.status === 409 && result.data) {
            const merged = mergeFamilyData(familyDataRef.current, normalizeData(result.data));
            const retryRevision = Math.max(revision, Math.floor(Number(result.revision) || 0)) + 1;
            const retryUpdatedAt = new Date().toISOString();
            familyDataRef.current = merged; familyRevisionRef.current = retryRevision; familyUpdatedAtRef.current = retryUpdatedAt;
            setData(merged); localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); localStorage.setItem(FAMILY_REVISION_KEY, String(retryRevision)); localStorage.setItem(FAMILY_UPDATED_AT_KEY, retryUpdatedAt);
            const retry = await familyStateRequest(activeFamilyId, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: merged, revision: retryRevision }) });
            const retryResult = await readFamilyStateResponse(retry);
            if (retryRevision !== familyRevisionRef.current || deleteInProgressRef.current) return;
            if (retry.ok && retryResult.updatedAt) { familyUpdatedAtRef.current = retryResult.updatedAt; localStorage.setItem(FAMILY_UPDATED_AT_KEY, retryResult.updatedAt); }
            setSyncLabel(retry.ok ? "网络已恢复 · 已合并并更新副本" : "网络已恢复 · 已保留本机更新"); return;
          }
          if (response.ok && result.updatedAt) { familyUpdatedAtRef.current = result.updatedAt; localStorage.setItem(FAMILY_UPDATED_AT_KEY, result.updatedAt); }
          setSyncLabel(response.ok ? "网络已恢复 · 云端副本已更新" : "网络已恢复 · 已保留本机更新");
        } catch {
          setSyncLabel("仅保存在本机");
        }
      })();
      await pendingWritesRef.current.track(syncPromise);
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("load", scheduleServiceWorker);
      if (workerIdleHandle) idleWindow.cancelIdleCallback?.(workerIdleHandle);
      if (workerTimer) window.clearTimeout(workerTimer);
      window.removeEventListener("offline", handleOffline); window.removeEventListener("online", handleOnline);
    };
  }, []);

  useEffect(() => {
    if (screen !== "confirm" && screen !== "dual-start" && screen !== "adjust") return;
    let minuteTimer = 0;
    const tick = () => setClockNow(Date.now());
    tick();
    const alignmentTimer = window.setTimeout(() => {
      tick();
      minuteTimer = window.setInterval(tick, 60_000);
    }, millisecondsUntilNextMinute(Date.now()));
    const syncVisibleClock = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", syncVisibleClock);
    return () => {
      window.clearTimeout(alignmentTimer);
      window.clearInterval(minuteTimer);
      document.removeEventListener("visibilitychange", syncVisibleClock);
    };
  }, [screen]);

  useEffect(() => {
    if (!deletedStage) return;
    const timer = window.setTimeout(() => setDeletedStage(null), 8000);
    return () => window.clearTimeout(timer);
  }, [deletedStage]);

  useEffect(() => {
    if (!shiftedPlanUndo) return;
    const timer = window.setTimeout(() => setShiftedPlanUndo(null), 8000);
    return () => window.clearTimeout(timer);
  }, [shiftedPlanUndo]);

  useEffect(() => {
    if (!clearedPlanUndo) return;
    const timer = window.setTimeout(() => setClearedPlanUndo(null), 30000);
    return () => window.clearTimeout(timer);
  }, [clearedPlanUndo]);

  const persist = (next: AppData, message?: string) => {
    if (deleteInProgressRef.current) return;
    const activeFamilyId = familyId || createId("family");
    if (!familyId) { localStorage.setItem("xian-kaishi-family-id", activeFamilyId); setFamilyId(activeFamilyId); }
    const revision = Math.max(familyRevisionRef.current, Math.floor(Number(localStorage.getItem(FAMILY_REVISION_KEY)) || 0)) + 1;
    const updatedAt = new Date().toISOString();
    familyDataRef.current = next; familyRevisionRef.current = revision; familyUpdatedAtRef.current = updatedAt;
    setData(next); localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); localStorage.setItem(FAMILY_REVISION_KEY, String(revision)); localStorage.setItem(FAMILY_UPDATED_AT_KEY, updatedAt); setSyncLabel("本机已保存 · 正在更新云端副本…");
    if (message) setToast(message);
    const syncPromise = familyStateRequest(activeFamilyId, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: next, revision }) })
      .then(async response => {
        const result = await readFamilyStateResponse(response);
        if (revision !== familyRevisionRef.current || deleteInProgressRef.current) return;
        if (response.status === 409 && result.data) {
          const merged = mergeFamilyData(next, normalizeData(result.data));
          const retryRevision = Math.max(revision, Math.floor(Number(result.revision) || 0)) + 1;
          const retryUpdatedAt = new Date().toISOString();
          familyDataRef.current = merged; familyRevisionRef.current = retryRevision; familyUpdatedAtRef.current = retryUpdatedAt;
          setData(merged); localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); localStorage.setItem(FAMILY_REVISION_KEY, String(retryRevision)); localStorage.setItem(FAMILY_UPDATED_AT_KEY, retryUpdatedAt); setSyncLabel("正在合并另一处更新…");
          const retry = await familyStateRequest(activeFamilyId, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: merged, revision: retryRevision }) });
          const retryResult = await readFamilyStateResponse(retry);
          if (retryRevision !== familyRevisionRef.current || deleteInProgressRef.current) return;
          if (retry.ok && retryResult.updatedAt) { familyUpdatedAtRef.current = retryResult.updatedAt; localStorage.setItem(FAMILY_UPDATED_AT_KEY, retryResult.updatedAt); }
          setSyncLabel(retry.ok ? "已合并 · 云端副本已更新" : "已保留本机更新"); return;
        }
        if (response.ok && result.updatedAt) { familyUpdatedAtRef.current = result.updatedAt; localStorage.setItem(FAMILY_UPDATED_AT_KEY, result.updatedAt); }
        setSyncLabel(result.localOnly ? "仅保存在本机" : response.ok ? "云端副本已更新" : "已保留本机更新");
      }).catch(() => { if (!deleteInProgressRef.current) setSyncLabel("本机已保存 · 云端副本待更新"); });
    void pendingWritesRef.current.track(syncPromise);
  };

  useEffect(() => {
    rewardExitHandlerRef.current = () => {
      setRedeemArmed(false);
      const current = familyDataRef.current;
      if (redeemRewardLock.current || current.rewardGoal.acknowledged) return;
      const nextGoal = { ...current.rewardGoal, acknowledged: true };
      persist({ ...current, rewardGoal: nextGoal }, `能量会保留，计划到${current.rewardGoal.date}再一起看看`);
    };
  });

  const changeBackgroundReminder = async (enabled: boolean) => {
    if (!enabled) { localStorage.setItem(REMINDER_PREF_KEY, "false"); setBackgroundReminder(false); setToast("后台系统提醒已关闭"); return; }
    if (!("Notification" in window)) { setNotificationPermission("unsupported"); setToast("当前浏览器不支持系统提醒，前台提醒仍然有效"); return; }
    setRequestingNotificationPermission(true);
    try {
      let permission = Notification.permission;
      if (permission === "default") permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      const granted = permission === "granted";
      localStorage.setItem(REMINDER_PREF_KEY, String(granted)); setBackgroundReminder(granted);
      setToast(granted ? "后台系统提醒已开启" : "系统提醒未开启，可在浏览器设置中重新允许");
    } catch {
      localStorage.setItem(REMINDER_PREF_KEY, "false"); setBackgroundReminder(false); setToast("暂时无法开启系统提醒，前台提醒仍然有效");
    } finally {
      setRequestingNotificationPermission(false);
    }
  };

  const showBackgroundSystemReminder = async () => {
    const title = "这一段预计到时间了";
    const options: NotificationOptions = {
      body: "完成、继续或调整，都可以。打开后再看具体安排。",
      icon: `/assets/icons/alarm.png?v=${ASSET_VERSION}`,
      badge: `/assets/icons/alarm.png?v=${ASSET_VERSION}`,
      tag: "xian-kaishi-stage-due",
      data: { url: "/" },
    };
    try {
      if ("serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration) {
          await registration.showNotification(title, options);
          return true;
        }
      }
      const reminder = new Notification(title, options);
      reminder.onclick = () => { window.focus(); reminder.close(); };
      return true;
    } catch {
      return false;
    }
  };

  const playTone = (kind: "tap" | "confirm" | "transition" | "complete") => {
    if (!data.sound || typeof window === "undefined") return;
    const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    try {
      let ctx = audioContextRef.current;
      if (!ctx || ctx.state === "closed") { ctx = new AudioCtx(); audioContextRef.current = ctx; }
      if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
      const motifs = {
        tap: [[560, 0, .11, .018]],
        confirm: [[523, 0, .17, .027], [659, .11, .23, .024]],
        transition: [[440, 0, .25, .029], [523, .17, .29, .024]],
        complete: [[523, 0, .22, .028], [659, .13, .27, .026], [784, .29, .34, .022]],
      } as const;
      const start = ctx.currentTime + .01;
      motifs[kind].forEach(([frequency, offset, duration, peak]) => {
        const osc = ctx.createOscillator(); const gain = ctx.createGain(); const noteStart = start + offset;
        osc.type = "sine"; osc.frequency.setValueAtTime(frequency, noteStart);
        gain.gain.setValueAtTime(.0001, noteStart); gain.gain.exponentialRampToValueAtTime(peak, noteStart + .018); gain.gain.exponentialRampToValueAtTime(.0001, noteStart + duration);
        osc.addEventListener("ended", () => { osc.disconnect(); gain.disconnect(); }, { once: true });
        osc.connect(gain).connect(ctx.destination); osc.start(noteStart); osc.stop(noteStart + duration + .02);
      });
    } catch { /* visual feedback remains available when browser audio is blocked */ }
  };

  const gentleVibrate = (pattern: number | number[]) => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return;
    if (shouldUseHapticCue(data.reducedMotion, systemReducedMotion)) navigator.vibrate?.(pattern);
  };

  const finishProfile = () => {
    const childAlias = cleanShortText(data.childAlias, 12);
    const guardianAlias = cleanShortText(data.guardianAlias, 12);
    if (!childAlias || !guardianAlias) {
      const target = (childAlias ? guardianAliasInputRef : childAliasInputRef).current;
      target?.scrollIntoView({ block: "center", behavior: motionReduced ? "auto" : "smooth" });
      target?.focus({ preventScroll: true });
      return;
    }
    const initialWindow = familyDataRef.current.consent ? {} : suggestInitialEveningWindow(new Date());
    const next = { ...data, ...initialWindow, childAlias, guardianAlias, consent: true, rewardGoal: { ...data.rewardGoal, participants: [guardianAlias, childAlias] } };
    setPlanHydrated(true); persist(next, profileReturn === "settings" ? "家庭设置已更新" : undefined); playTone("confirm");
    if (profileReturn === "settings") back("settings"); else go("plan", "replace");
  };

  const addStage = () => {
    if (stages.length >= MAX_PLAN_STAGES) { setToast(`今晚最多保留${MAX_PLAN_STAGES}个节点，已有内容不会自动删除`); return; }
    const slot = findPlanInsertionSlot(data.planStart, data.planEnd, stages);
    if (slot.status !== "available") {
      setToast(slot.status === "invalid" ? "先调整标出的时间，再增加节点" : "今晚已经排满，先留出至少5分钟再增加");
      return;
    }
    setDeletedStage(null);
    setShiftedPlanUndo(null);
    setClearedPlanUndo(null);
    setFollowUpPlanMessage("");
    const id = createId("stage");
    setStages(items => {
      const next = [...items];
      next.splice(slot.insertIndex, 0, { id, title: "", icon: "custom", start: slot.start, end: slot.end, effort: 1, energy: 1, status: "pending", kind: "task" });
      return next;
    });
    setEditingStageId(id);
    setEditingDurationStageId("");
    setEditingEnergyStageId("");
    if (slot.usedShortGap) setToast(`已放进 ${slot.minutes} 分钟空档，可继续调整`);
    else if (slot.insertIndex < stages.length) setToast("已放进时间表中的20分钟空档");
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const input = phoneShellRef.current?.querySelector<HTMLInputElement>(`[data-stage-id="${id}"] [data-stage-title]`);
      input?.scrollIntoView({ block: "center", behavior: motionReduced ? "auto" : "smooth" }); input?.focus({ preventScroll: true }); input?.select();
    }));
  };

  const updateStage = (id: string, patch: Partial<Stage>) => {
    setFollowUpPlanMessage("");
    setStages(items => items.map(item => item.id === id ? { ...item, ...patch } : item));
  };
  const focusPlanTarget = (stageId?: string) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const stageContainer = stageId
        ? Array.from(phoneShellRef.current?.querySelectorAll<HTMLElement>("[data-stage-id]") ?? []).find(element => element.dataset.stageId === stageId)
        : null;
      const target = stageContainer?.querySelector<HTMLButtonElement>(".stage-summary") ?? addNodeButtonRef.current;
      target?.scrollIntoView({ block: "center", behavior: motionReduced ? "auto" : "smooth" });
      target?.focus({ preventScroll: true });
    }));
  };
  const focusStageDetails = (stageId: string) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const stageContainer = Array.from(phoneShellRef.current?.querySelectorAll<HTMLElement>("[data-stage-id]") ?? []).find(element => element.dataset.stageId === stageId);
      const target = stageContainer?.querySelector<HTMLButtonElement>(".effort-pill");
      target?.scrollIntoView({ block: "center", behavior: motionReduced ? "auto" : "smooth" });
      target?.focus({ preventScroll: true });
    }));
  };
  const planTimeSnapshot = () => stages.map(({ id, start, end }) => ({ id, start, end }));
  const beginPlanWindowEdit = (field: "start" | "end") => {
    if (planWindowEditRef.current?.field === field) return;
    planWindowEditRef.current = { field, planStart: data.planStart, planEnd: data.planEnd, times: planTimeSnapshot() };
  };
  const endPlanWindowEdit = (field: "start" | "end", value: string) => {
    const baseline = planWindowEditRef.current?.field === field ? planWindowEditRef.current : null;
    if (!value && baseline) {
      if (field === "start") {
        setData(current => ({ ...current, planStart: baseline.planStart }));
        applyPlanTimes(baseline.times);
      } else {
        setData(current => ({ ...current, planEnd: baseline.planEnd }));
      }
      setShiftedPlanUndo(null);
      setToast("时间还没选好，已恢复刚才的安排");
    }
    if (planWindowEditRef.current?.field === field) planWindowEditRef.current = null;
  };
  const beginStageTimeEdit = (id: string, field: "start" | "end") => {
    if (stageTimeEditRef.current?.id === id && stageTimeEditRef.current.field === field) return;
    stageTimeEditRef.current = { id, field, times: planTimeSnapshot() };
  };
  const endStageTimeEdit = (id: string, field: "start" | "end", value: string) => {
    const baseline = stageTimeEditRef.current?.id === id && stageTimeEditRef.current.field === field ? stageTimeEditRef.current : null;
    if (!value && baseline) {
      applyPlanTimes(baseline.times);
      setShiftedPlanUndo(null);
      setToast("这项的时间还没选好，已恢复刚才的安排");
    }
    if (stageTimeEditRef.current?.id === id && stageTimeEditRef.current.field === field) stageTimeEditRef.current = null;
  };
  const timeEditBaseline = (id: string, field: "start" | "end") => {
    const activeEdit = stageTimeEditRef.current;
    return activeEdit?.id === id && activeEdit.field === field ? activeEdit.times : planTimeSnapshot();
  };
  const applyPlanTimes = (times: Array<Pick<Stage, "id" | "start" | "end">>) => {
    const byId = new Map(times.map(item => [item.id, item]));
    setStages(items => items.map(item => {
      const next = byId.get(item.id);
      return next ? { ...item, start: next.start, end: next.end } : item;
    }));
  };
  const updatePlanStart = (start: string) => {
    const activeEdit = planWindowEditRef.current?.field === "start" ? planWindowEditRef.current : null;
    const baselineStart = activeEdit?.planStart ?? data.planStart;
    const baselineTimes = activeEdit?.times ?? planTimeSnapshot();
    setFollowUpPlanMessage("");
    if (!start) { setData(current => ({ ...current, planStart: start })); return; }
    const delta = clockDeltaMinutes(baselineStart, start);
    if (!delta) { setData(current => ({ ...current, planStart: start })); return; }
    setDeletedStage(null);
    setShiftedPlanUndo({
      times: baselineTimes,
      planStart: baselineStart,
      message: stages.length
        ? `今晚开始时间已${delta > 0 ? "后移" : "提前"} ${Math.abs(delta)} 分钟，所有节点已一起调整`
        : `今晚开始时间已${delta > 0 ? "后移" : "提前"} ${Math.abs(delta)} 分钟`,
    });
    applyPlanTimes(shiftTimedItemsFrom(baselineTimes, 0, delta));
    setData(current => ({ ...current, planStart: start }));
  };
  const updateStageStart = (id: string, start: string) => {
    const index = stages.findIndex(item => item.id === id);
    const baseline = timeEditBaseline(id, "start");
    const current = baseline[index];
    if (!current) return;
    if (!start) { updateStage(id, { start }); return; }
    const delta = clockDeltaMinutes(current.start, start);
    if (!delta) { updateStage(id, { start }); return; }
    setDeletedStage(null);
    setShiftedPlanUndo({
      times: baseline,
      focusStageId: id,
      message: index < stages.length - 1
        ? `本项${delta > 0 ? "后移" : "前移"} ${Math.abs(delta)} 分钟，后续时间已一起调整`
        : `本项已${delta > 0 ? "后移" : "前移"} ${Math.abs(delta)} 分钟`,
    });
    applyPlanTimes(shiftTimedItemsFrom(baseline, index, delta));
  };
  const updateStageEnd = (id: string, end: string) => {
    const index = stages.findIndex(item => item.id === id);
    const baseline = timeEditBaseline(id, "end");
    const current = baseline[index];
    if (!current) return;
    if (!end) { updateStage(id, { end }); return; }
    const delta = clockDeltaMinutes(current.end, end);
    if (!delta) { updateStage(id, { end }); return; }
    const hasFollowing = index < stages.length - 1;
    setDeletedStage(null);
    setShiftedPlanUndo({
      times: baseline,
      focusStageId: id,
      message: hasFollowing
        ? delta > 0 ? `本项延长 ${delta} 分钟，后续时间已顺延` : `本项缩短 ${Math.abs(delta)} 分钟，后续时间已提前`
        : `本项已${delta > 0 ? "延长" : "缩短"} ${Math.abs(delta)} 分钟`,
    });
    applyPlanTimes(shiftFollowingForEndChange(baseline, index, end));
  };
  const undoPlanShift = () => {
    if (!shiftedPlanUndo) return;
    const undo = shiftedPlanUndo;
    const previousPlanStart = undo.planStart;
    const previousTimes = new Map(shiftedPlanUndo.times.map(item => [item.id, item]));
    setStages(items => items.map(item => {
      const previous = previousTimes.get(item.id);
      return previous ? { ...item, start: previous.start, end: previous.end } : item;
    }));
    if (previousPlanStart !== undefined) setData(current => ({ ...current, planStart: previousPlanStart }));
    setShiftedPlanUndo(null); setToast("已恢复调整前的时间");
    window.requestAnimationFrame(() => {
      if (previousPlanStart !== undefined) planStartInputRef.current?.focus();
      else if (undo.focusStageId) focusPlanTarget(undo.focusStageId);
    });
  };
  const removeStage = (stage: Stage, index: number) => {
    const remaining = stages.filter(item => item.id !== stage.id); setStages(remaining);
    const nextStageId = remaining[Math.min(index, remaining.length - 1)]?.id;
    if (editingStageId === stage.id) setEditingStageId(nextStageId ?? "");
    setShiftedPlanUndo(null); setDeletedStage({ stage, index });
    focusPlanTarget(nextStageId);
  };
  const undoRemoveStage = () => {
    if (!deletedStage) return;
    const { stage, index } = deletedStage;
    setStages(items => { const next = [...items]; next.splice(Math.min(index, next.length), 0, stage); return next; });
    setEditingStageId(stage.id); setDeletedStage(null); setToast(`已恢复“${stage.title.trim() || "未命名事项"}”`);
    focusPlanTarget(stage.id);
  };
  const clearPlan = () => {
    if (!clearPlanArmedRef.current) {
      clearPlanArmedRef.current = true;
      const sequence = ++clearPlanArmSequence.current;
      setClearPlanArmed(true); setToast("再点一次确认清空");
      window.setTimeout(() => {
        if (clearPlanArmedRef.current && clearPlanArmSequence.current === sequence) {
          clearPlanArmedRef.current = false; setClearPlanArmed(false);
        }
      }, 3200); return;
    }
    const snapshot = stages.map(stage => ({ ...stage }));
    clearPlanArmedRef.current = false; clearPlanArmSequence.current += 1;
    setDeletedStage(null); setShiftedPlanUndo(null);
    setClearedPlanUndo({ stages: snapshot, editingStageId, planStart: data.planStart, planEnd: data.planEnd });
    setStages([]); setEditingStageId(""); setClearPlanArmed(false); setToast("时间表已清空，可以重新安排"); focusPlanTarget();
  };
  const undoClearPlan = () => {
    if (!clearedPlanUndo) return;
    const undo = clearedPlanUndo;
    const focusStageId = undo.stages.some(stage => stage.id === undo.editingStageId) ? undo.editingStageId : undo.stages[0]?.id;
    setData(current => ({ ...current, planStart: undo.planStart, planEnd: undo.planEnd }));
    setStages(undo.stages.map(stage => ({ ...stage })));
    setEditingStageId(undo.editingStageId);
    setClearedPlanUndo(null);
    setToast(`已恢复 ${undo.stages.length} 个时间节点`);
    if (screenRef.current !== "plan") go("plan");
    focusPlanTarget(focusStageId);
  };
  const moveStage = (index: number, delta: -1 | 1) => {
    const target = index + delta; if (target < 0 || target >= stages.length) return;
    const movedStageId = stages[index].id;
    const result = moveTimedItemPreservingGaps(stages, index, target, data.planStart);
    if (!result.moved) { setToast("先调整标出的时间，再调换顺序"); return; }
    setDeletedStage(null); setShiftedPlanUndo(null); setStages(result.items); setToast("已调换顺序，原来的时间空档保持不变");
    focusPlanTarget(movedStageId);
  };

  const startPlan = () => {
    const startedAt = interactionTimestamp(); const actualStart = clockTimeFromDate(new Date(startedAt));
    sessionPlanWindowRef.current = { planStart: data.planStart, planEnd: data.planEnd };
    const cleanStages = stages.map(item => ({ ...item, title: cleanShortText(item.title, 24) }));
    const startedStages = shiftTimedPlanToStart(cleanStages, actualStart).map((item, index) => ({ ...item, status: index === 0 ? "active" as const : "pending" as const }));
    const windowMinutes = Math.max(1, durationMinutes(data.planStart, data.planEnd));
    setStages(startedStages); setData(current => ({ ...current, planStart: actualStart, planEnd: addMinutes(actualStart, windowMinutes) }));
    const firstDuration = Math.max(1, durationMinutes(startedStages[0]?.start ?? actualStart, startedStages[0]?.end ?? addMinutes(actualStart, 1)));
    setActiveEndsAt(startedAt + firstDuration * 60_000); setClockNow(startedAt); setStageDue(false); setLiveSessionStartedAt(new Date(startedAt).toISOString()); dueReminderPlayed.current = false;
    finishNightLock.current = false; setLastSavedSession(null); setActiveIndex(0); setAdjustments(0); setPromptReflection(null); setTransitionReason("completed"); setGuardianConfirmed(false); setChildConfirmed(false); playTone("confirm"); go("running");
  };

  useEffect(() => {
    if (screen === "dual-start" && guardianConfirmed && childConfirmed) {
      const timer = window.setTimeout(startPlan, DUAL_START_DELAY_MS); return () => window.clearTimeout(timer);
    }
    // startPlan intentionally reads the latest plan only after both confirmations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guardianConfirmed, childConfirmed, screen]);

  useEffect(() => {
    if (screen !== "dual-start" || !guardianConfirmed || !childConfirmed) return;
    const frame = window.requestAnimationFrame(() => {
      const target = launchCancelRef.current;
      target?.scrollIntoView({ block: "end", behavior: motionReduced ? "auto" : "smooth" });
      target?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [childConfirmed, guardianConfirmed, motionReduced, screen]);

  // Planning screens intentionally allow an empty list. Keep live-only derived
  // copy total during that brief state so clearing a draft cannot crash React.
  const activeStage = stages[activeIndex] ?? stages[0] ?? FALLBACK_STAGE;
  const nextPendingIndex = (from: number) => stages.findIndex((item, index) => index > from && item.status === "pending");
  const hasNextPending = nextPendingIndex(activeIndex) >= 0;
  const nextPendingStage = stages[nextPendingIndex(activeIndex)];
  const remainingSeconds = activeEndsAt ? Math.max(0, Math.ceil((activeEndsAt - clockNow) / 1000)) : 0;
  const activeStageSeconds = Math.max(60, durationMinutes(activeStage.start, activeStage.end) * 60);
  const softLanding = shouldShowSoftLanding(remainingSeconds, stageDue);
  const canStartRest = canInsertRestBreak(activeStage.kind);
  const effectiveAdjustChoice: AdjustmentChoice | null = !canStartRest && adjustChoice === "rest" ? null : adjustChoice;
  const adjustReturnScreen: LiveScreen = activeStage.status === "done" ? "transition" : "running";
  const returnFromAdjust = () => go(adjustReturnScreen);

  useEffect(() => {
    if (screen !== "running" || !activeEndsAt) return;
    const tick = () => {
      const now = Date.now(); setClockNow(now);
      if (now >= activeEndsAt && !dueReminderPlayed.current) {
        dueReminderPlayed.current = true; setStageDue(true);
        const visibility = document.visibilityState;
        if (shouldUseBackgroundReminder(backgroundReminder, visibility, notificationPermission)) {
          void showBackgroundSystemReminder();
        } else if (shouldUseForegroundCue(visibility)) { playTone("transition"); gentleVibrate([25, 35, 25]); }
      }
    };
    tick(); const timer = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
    // playTone uses the latest experience preference; the interval is recreated for each stage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEndsAt, activeStage.title, backgroundReminder, notificationPermission, screen]);

  const stageFinished = () => {
    setStageAdvanceUndo(null);
    setTransitionReason("completed");
    setStages(items => items.map((item, index) => index === activeIndex ? { ...item, status: "done" } : item));
    playTone("confirm"); gentleVibrate(20); go("transition");
  };

  const undoStageFinished = () => {
    const now = Date.now();
    const isDueNow = activeEndsAt > 0 && now >= activeEndsAt;
    setStages(items => items.map((item, index) => index === activeIndex ? { ...item, status: "active" } : item));
    setClockNow(now); setStageDue(isDueNow); dueReminderPlayed.current = isDueNow;
    setToast("已回到这一段，按原来的节奏继续"); go("running");
  };

  const continueToNext = () => {
    const nextIndex = nextPendingIndex(activeIndex);
    if (nextIndex < 0) { go("wrap"); return; }
    const nextStage = stages[nextIndex];
    const startedAt = Date.now();
    const actualStart = clockTimeFromDate(new Date(startedAt));
    const scheduleDelta = clockDeltaMinutes(nextStage.start, actualStart);
    const alignedStages = alignLiveStagesToStart(stages, nextIndex, actualStart);
    setStageAdvanceUndo({ stages: stages.map(item => ({ ...item })), planEnd: data.planEnd, activeIndex, activeEndsAt, stageDue, transitionReason, nextTitle: nextStage.title });
    setStages(advanceStageStatuses(alignedStages, activeIndex, nextIndex));
    if (scheduleDelta > 0) setData(current => ({ ...current, planEnd: addMinutes(current.planEnd, scheduleDelta) }));
    setActiveEndsAt(startedAt + Math.max(1, durationMinutes(nextStage.start, nextStage.end)) * 60_000); setClockNow(startedAt); setStageDue(false); dueReminderPlayed.current = false;
    setActiveIndex(nextIndex); go("running");
  };

  const undoContinueToNext = () => {
    if (!stageAdvanceUndo) return;
    setStages(stageAdvanceUndo.stages.map(item => ({ ...item })));
    setData(current => ({ ...current, planEnd: stageAdvanceUndo.planEnd }));
    setActiveIndex(stageAdvanceUndo.activeIndex); setActiveEndsAt(stageAdvanceUndo.activeEndsAt); setClockNow(Date.now());
    setStageDue(stageAdvanceUndo.stageDue); dueReminderPlayed.current = stageAdvanceUndo.stageDue; setTransitionReason(stageAdvanceUndo.transitionReason);
    setStageAdvanceUndo(null); setToast("已返回上一段的选择"); go("transition");
  };

  const extendCurrent = () => {
    setStageAdvanceUndo(null);
    const restartFromNow = activeStage.status === "done";
    const nextStages = shiftTimedItemsFrom(stages, activeIndex + 1, 10).map((item, index) => index === activeIndex ? { ...item, end: addMinutes(item.end, 10), status: "active" as const } : item);
    const nextScheduledEnd = scheduledEndTime(nextStages, addMinutes(data.planEnd, 10));
    setStages(nextStages);
    setData(current => ({ ...current, planEnd: addMinutes(current.planEnd, 10) }));
    setActiveEndsAt(value => restartFromNow ? Date.now() + 10 * 60_000 : Math.max(value, Date.now()) + 10 * 60_000); setClockNow(Date.now()); setStageDue(false); dueReminderPlayed.current = false;
    setAdjustments(value => value + 1); setToast(`已延长10分钟，事项预计${nextScheduledEnd}结束`); go("running");
  };

  const startRestNow = () => {
    setStageAdvanceUndo(null);
    if (!canStartRest) { extendCurrent(); return; }
    const startedAt = Date.now();
    const result = insertRestBreak<Stage>(
      stages,
      activeIndex,
      { id: createId("rest"), title: "安静休息", icon: "quiet", start: "", end: "", effort: 1, energy: 0, status: "active", kind: "rest" },
      clockTimeFromDate(new Date(startedAt)),
      remainingTimerMinutes(activeEndsAt, startedAt),
      10,
      10,
      data.planEnd,
    );
    setStages(result.items); setData(current => ({ ...current, planEnd: result.planEnd }));
    setActiveIndex(result.restIndex); setActiveEndsAt(startedAt + 10 * 60_000); setClockNow(startedAt); setStageDue(false); dueReminderPlayed.current = false;
    const resumedCopy = result.resumedMinutes ? `，之后再试${result.resumedMinutes}分钟` : "";
    setAdjustments(value => value + 1); setToast(`先休息10分钟${resumedCopy}；事项预计${scheduledEndTime(result.items, result.planEnd)}结束`); go("running");
  };

  const deferCurrentStage = () => {
    setStageAdvanceUndo(null);
    const nextIndex = nextPendingIndex(activeIndex);
    if (!canStartRest || activeStage.status === "done" || nextIndex < 0) { setToast("当前状态不需要移到明天"); return; }
    const nextStage = stages[nextIndex];
    const startedAt = Date.now();
    const actualStart = clockTimeFromDate(new Date(startedAt));
    const scheduleDelta = clockDeltaMinutes(nextStage.start, actualStart);
    const alignedStages = alignLiveStagesToStart(stages, nextIndex, actualStart);
    setStages(deferActiveStage(alignedStages, activeIndex, nextIndex));
    if (scheduleDelta > 0) setData(current => ({ ...current, planEnd: addMinutes(current.planEnd, scheduleDelta) }));
    setActiveIndex(nextIndex); setActiveEndsAt(startedAt + Math.max(1, durationMinutes(nextStage.start, nextStage.end)) * 60_000);
    setClockNow(startedAt); setStageDue(false); dueReminderPlayed.current = false;
    setAdjustments(value => value + 1); setToast(`“${activeStage.title}”已移到明天，现在进入“${nextStage.title}”`); go("running");
  };

  const applyAdjustment = () => {
    if (!effectiveAdjustChoice) { setToast("先一起选择一种调整方式"); return; }
    if (effectiveAdjustChoice === "finish") { endTonightEarly(); return; }
    if (effectiveAdjustChoice === "extend") { extendCurrent(); return; }
    if (effectiveAdjustChoice === "rest") { startRestNow(); return; }
    if (effectiveAdjustChoice === "defer") { deferCurrentStage(); return; }
    if (effectiveAdjustChoice === "swap") {
      const result = swapNextPendingItems(stages, activeIndex, data.planStart);
      if (!result.moved) { setToast("当前时间表需要先调整，暂时不能调换"); return; }
      setStages(result.items); setToast("后两项已调换，原来的休息空档还在");
    } else {
      const result = deferNextPendingItem(stages, activeIndex);
      if (!result.moved) { setToast("后面已经没有待安排的事项"); returnFromAdjust(); return; }
      setStages(result.items); setToast(`“${nextPendingStage?.title ?? "下一项"}”已移到明天，今晚预计提前${result.minutes}分钟结束`);
    }
    setAdjustments(value => value + 1); returnFromAdjust();
  };

  const endTonightEarly = () => {
    finishNightLock.current = false;
    setStages(items => items.map(item => item.status === "done" ? item : { ...item, status: "tomorrow" }));
    setAdjustments(value => value + 1); setToast("已保留进展，今晚先到这里"); go("wrap");
  };

  const resumeTonightFromWrap = () => {
    const nextIndex = stages.findIndex(item => item.status === "tomorrow");
    if (nextIndex < 0) return;
    const resumedStage = stages[nextIndex];
    setStages(items => items.map((item, index) => item.status === "done" ? item : { ...item, status: index === nextIndex ? "active" : "pending" }));
    setActiveIndex(nextIndex); setActiveEndsAt(Date.now() + Math.max(1, durationMinutes(resumedStage.start, resumedStage.end)) * 60_000);
    finishNightLock.current = false; setClockNow(Date.now()); setStageDue(false); dueReminderPlayed.current = false; setToast("已回到今晚，继续也来得及"); go("running");
  };

  const finishNight = () => {
    if (finishNightLock.current) return;
    finishNightLock.current = true;
    const recordDate = new Date().toISOString();
    const nightKey = familyNightKey(liveSessionStartedAt || recordDate);
    const priorNightSessions = data.sessions.filter(item => item.nightKey === nightKey);
    const completedCount = countCompletedTasks(stages);
    const completedStageTitles = stages.filter(item => item.status === "done").map(item => item.title);
    const taskEnergy = stages.filter(item => item.status === "done").reduce((sum, item) => sum + item.energy, 0);
    const { cooperationEnergy, adjustmentEnergy } = calculateNightBonus(priorNightSessions, adjustments);
    const nextEnergy = data.energy + taskEnergy + cooperationEnergy + adjustmentEnergy;
    const record: SessionRecord = { id: createId("session"), date: recordDate, nightKey, stageCount: stages.filter(item => item.kind !== "rest").length, completedCount, completionUnit: "tasks", adjustments, taskEnergy, cooperationEnergy, adjustmentEnergy, energyEarned: taskEnergy + cooperationEnergy + adjustmentEnergy, stageTitles: completedStageTitles, promptReflection };
    const baseline = sessionPlanWindowRef.current ?? { planStart: data.planStart, planEnd: data.planEnd };
    const next = { ...data, planStart: baseline.planStart, planEnd: baseline.planEnd, energy: nextEnergy, sessions: keepNewestRecords([record, ...data.sessions], item => item.date, MAX_SESSION_RECORDS) };
    setLastSavedSession(record); setStages(prepareNextRoundSchedule(stages, completedStageTitles, baseline.planStart));
    localStorage.removeItem(LIVE_SESSION_KEY); setLiveSessionAvailable(false); setLiveSessionStartedAt("");
    sessionPlanWindowRef.current = null;
    persist(next, "今晚已经留在家庭日历"); playTone("complete");
    if (!next.rewardGoal.redeemed && !next.rewardGoal.acknowledged && nextEnergy >= next.rewardGoal.threshold) openRewardAchieved(true); else go("night-saved");
  };

  const redeemReward = () => {
    if (redeemRewardLock.current) return;
    redeemRewardLock.current = true;
    const redeemedAt = new Date().toISOString();
    const history: RewardHistory = { id: createId("reward"), title: data.rewardGoal.title, icon: data.rewardGoal.icon, threshold: data.rewardGoal.threshold, energyBeforeReset: data.energy, redeemedAt };
    const next: AppData = {
      ...data, energy: 0, rewardHistory: keepNewestRecords([history, ...data.rewardHistory], item => item.redeemedAt, MAX_REWARD_HISTORY),
      rewardGoal: { threshold: 20, title: "", icon: "game", date: "周六", participants: [data.guardianAlias, data.childAlias], redeemed: true, acknowledged: false },
    };
    setRewardRedeemUndo({
      rewardId: history.id,
      title: history.title,
      energy: data.energy,
      rewardGoal: { ...data.rewardGoal, participants: [...data.rewardGoal.participants] },
      rewardHistory: data.rewardHistory.map(item => ({ ...item })),
    });
    setLastRedeemedReward(history);
    setRedeemArmed(false); persist(next, "已经留在家庭日历"); playTone("complete"); go("reward-saved");
  };

  const undoRedeemReward = () => {
    if (!rewardRedeemUndo) return;
    const undo = rewardRedeemUndo;
    const restored = restoreRewardRedemption(data, {
      ...undo,
      rewardGoal: { ...undo.rewardGoal, participants: [...undo.rewardGoal.participants] },
      rewardHistory: undo.rewardHistory.map(item => ({ ...item })),
    });
    if (!restored) { setRewardRedeemUndo(null); setToast("这份记录已经发生变化，当前状态没有被覆盖"); return; }
    redeemRewardLock.current = false; setRewardRedeemUndo(null); setLastRedeemedReward(null);
    persist(restored, `已恢复“${undo.title}”和这一轮的${undo.energy}点能量`); go("energy");
  };

  const keepRewardForLater = () => {
    setRewardReachedFromNight(false);
    go("energy");
  };

  const cancelRedeemConfirmation = () => {
    setRedeemArmed(false);
    window.requestAnimationFrame(() => rewardRedeemTriggerRef.current?.focus());
  };

  const saveRewardDraft = () => {
    const title = cleanShortText(rewardDraft.title, 24); const date = cleanShortText(rewardDraft.date, 16);
    if (!title || !date) {
      const target = (title ? rewardDateInputRef : rewardTitleInputRef).current;
      target?.scrollIntoView({ block: "center", behavior: motionReduced ? "auto" : "smooth" });
      target?.focus({ preventScroll: true });
      return;
    }
    if (!rewardEnergyConfirmed) {
      rewardEnergyConfirmRef.current?.scrollIntoView({ block: "center", behavior: motionReduced ? "auto" : "smooth" });
      rewardEnergyConfirmRef.current?.focus({ preventScroll: true });
      return;
    }
    const nextGoal: RewardGoal = { ...rewardDraft, title, date, participants: [data.guardianAlias, data.childAlias], redeemed: false, acknowledged: false };
    setRewardRedeemUndo(null);
    persist({ ...data, rewardGoal: nextGoal }, "家庭期待已保存"); go("energy");
  };

  const exportData = () => {
    const planDraft: PlanDraft = { updatedAt: draftUpdatedAt || new Date().toISOString(), planStart: data.planStart, planEnd: data.planEnd, stages: stages.map(item => ({ ...item, status: "pending" })) };
    const baseline = sessionPlanWindowRef.current ?? { planStart: data.planStart, planEnd: data.planEnd };
    const activeSession: LiveSessionDraft | null = liveSessionAvailable ? { startedAt: liveSessionStartedAt || new Date().toISOString(), updatedAt: new Date().toISOString(), screen: liveResumeScreen, planStart: data.planStart, planEnd: data.planEnd, baselinePlanStart: baseline.planStart, baselinePlanEnd: baseline.planEnd, stages, activeIndex, adjustments, activeEndsAt, stageDue, promptReflection, transitionReason } : null;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), family: data, planDraft, activeSession }, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "先开始-家庭数据.json"; a.click(); URL.revokeObjectURL(url); setToast("家庭数据已导出");
  };

  const requestDeleteData = () => {
    deleteReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDeleteArmed(true);
  };

  const cancelDeleteData = () => {
    if (deletingData) return;
    setDeleteArmed(false);
    window.requestAnimationFrame(() => deleteReturnFocusRef.current?.focus());
  };

  const deleteData = async () => {
    if (!deleteArmed || deleteInProgressRef.current) return;
    deleteInProgressRef.current = true; setDeletingData(true);
    const activeFamilyId = familyId || localStorage.getItem("xian-kaishi-family-id") || "";
    if (activeFamilyId) localStorage.setItem(PENDING_DELETE_KEY, activeFamilyId);
    await pendingWritesRef.current.drain();
    const cloudDeleted = await retryPendingCloudDeletion();
    setPendingCloudDeletion(!cloudDeleted); setDeletionNotice(cloudDeleted ? "complete" : "pending");
    localStorage.removeItem(STORAGE_KEY); localStorage.removeItem("xian-kaishi-family-v1"); localStorage.removeItem(PLAN_DRAFT_KEY); localStorage.removeItem(LIVE_SESSION_KEY); localStorage.removeItem(REMINDER_PREF_KEY); localStorage.removeItem(FAMILY_REVISION_KEY); localStorage.removeItem(FAMILY_UPDATED_AT_KEY); localStorage.removeItem("xian-kaishi-family-id"); familyDataRef.current = DEFAULT_DATA; familyRevisionRef.current = 0; familyUpdatedAtRef.current = ""; sessionPlanWindowRef.current = null; setPlanHydrated(false); setFamilyId(""); setData(DEFAULT_DATA); setConsent(false); setStages([]); setDraftUpdatedAt(""); setPromptReflection(null); setBackgroundReminder(false); setLiveSessionAvailable(false); setLiveSessionStartedAt(""); setDeleteArmed(false); go("welcome", "replace");
    setToast(cloudDeleted ? "本机与云端家庭数据已经删除" : "本机数据已删除；联网后继续清理云端副本");
    deleteInProgressRef.current = false; setDeletingData(false);
  };

  const effortCopy = { 1: "一小步", 2: "需要专注", 3: "今天比较费力" } as const;
  const promptReflectionCopy: Record<PromptReflection, string> = { less: "共同执行更顺畅", same: "和往常差不多", more: "共同执行更费力" };
  const progress = Math.max(0, data.rewardGoal.threshold - data.energy);
  const { minimum: rewardMinimumThreshold, maximum: rewardMaximumThreshold } = rewardThresholdBounds(data.energy);
  const rewardDraftValid = Boolean(rewardDraft.title.trim() && rewardDraft.date.trim());
  const rewardDraftReady = rewardDraftValid && rewardEnergyConfirmed;
  const rewardDraftActionLabel = rewardDraftReady
    ? data.rewardGoal.redeemed ? "一起确认这个期待" : "保存共同调整"
    : !rewardDraft.title.trim()
      ? "去填写家庭期待"
      : !rewardDraft.date.trim() ? "去填写实现时间" : "去确认能量节奏";
  const goalReady = !data.rewardGoal.redeemed && progress === 0;
  const goalState: "empty" | "building" | "ready" = data.rewardGoal.redeemed ? "empty" : goalReady ? "ready" : "building";
  const hasPastReward = data.rewardHistory.length > 0;
  const hasDeferredStages = stages.some(item => item.status === "tomorrow");
  const monthStart = calendarCursor;
  const calendarYear = monthStart.getFullYear(); const calendarMonth = monthStart.getMonth();
  const firstWeekday = monthStart.getDay(); const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const monthKeyPrefix = `${calendarYear}-${String(calendarMonth + 1).padStart(2, "0")}`;
  const monthSessions = data.sessions.filter(item => item.nightKey.startsWith(monthKeyPrefix));
  const monthRewards = data.rewardHistory.filter(item => { const date = new Date(item.redeemedAt); return date.getFullYear() === calendarYear && date.getMonth() === calendarMonth; });
  const today = new Date(); const todayKey = localDateKey(today);
  const showTodayJump = selectedDay !== todayKey || calendarYear !== today.getFullYear() || calendarMonth !== today.getMonth();
  const metrics = !monthSessions.length && !monthRewards.length ? null : { nights: new Set(monthSessions.map(item => item.nightKey)).size, adjustments: monthSessions.reduce((sum, item) => sum + item.adjustments, 0), lessPromptNights: monthSessions.filter(item => item.promptReflection === "less").length };
  const selectedSessions = data.sessions.filter(item => item.nightKey === selectedDay);
  const selectedRewards = data.rewardHistory.filter(item => localDateKey(item.redeemedAt) === selectedDay);
  const selectedIncludesAfterMidnightSession = selectedSessions.some(item => localDateKey(item.date) !== item.nightKey);
  const selectedDate = new Date(`${selectedDay}T12:00:00`);
  const selectedDateLabel = Number.isFinite(selectedDate.getTime()) ? selectedDate.toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short" }) : selectedDay;
  const selectedSessionSummary = summarizeSessions(selectedSessions);
  const currentFamilyNightKey = familyNightKey(new Date());
  const currentNightSessions = data.sessions.filter(item => item.nightKey === currentFamilyNightKey);
  const currentNightSummary = summarizeSessions(currentNightSessions);
  const weekStart = new Date(); weekStart.setHours(0, 0, 0, 0); weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekStartKey = localDateKey(weekStart);
  const weeklySessions = data.sessions.filter(item => item.nightKey >= weekStartKey);
  const weeklyNights = new Set(weeklySessions.map(item => item.nightKey)).size;
  const weeklyReflections = weeklySessions.filter(item => item.promptReflection);
  const weeklyLessPromptNights = weeklySessions.filter(item => item.promptReflection === "less").length;
  const weeklyMorePromptNights = weeklySessions.filter(item => item.promptReflection === "more").length;
  const weeklyAdjustments = weeklySessions.reduce((sum, item) => sum + item.adjustments, 0);
  const recentCompletedFirstStep = weeklySessions.find(item => item.stageTitles.length)?.stageTitles[0];
  const reviewSuggestion = suggestWeeklyFocus({ nights: weeklyNights, morePromptNights: weeklyMorePromptNights, lessPromptNights: weeklyLessPromptNights, adjustments: weeklyAdjustments, recentCompletedFirstStep });
  const currentWeekFocus = data.weeklyFocus?.weekKey === weekStartKey ? data.weeklyFocus : null;
  const planAnalysis = analyzePlan(data.planStart, data.planEnd, stages);
  const { availableMinutes, scheduledMinutes, itemErrors: planItemErrors, hasErrors: planHasErrors, balanceMinutes: planBalance } = planAnalysis;
  const planNeedsTitle = planItemErrors.some(item => item.title);
  const planNeedsTime = availableMinutes <= 0 || planItemErrors.some(item => item.time);
  const planErrorPrompt = planNeedsTitle && planNeedsTime ? "名称和时间还需要确认" : planNeedsTitle ? "先写下事项名称" : "先调整一下时间";
  const planTimeIssue = availableMinutes <= 0
    ? "今晚开始和结束时间不能相同"
    : planItemErrors.find(item => item.time)?.messages.find(message => !message.includes("还没有名称")) ?? "先调整标出的时间";
  const stageIssueById = new Map<string, string>(stages.flatMap((stage, index): Array<[string, string]> => planItemErrors[index]?.messages.length ? [[stage.id, planItemErrors[index].messages.join("；")]] : []));
  const planStageIssueIds = new Set(stageIssueById.keys());
  const focusFirstPlanIssue = () => {
    if (availableMinutes <= 0) {
      planStartInputRef.current?.scrollIntoView({ block: "center", behavior: motionReduced ? "auto" : "smooth" });
      planStartInputRef.current?.focus({ preventScroll: true });
      return;
    }
    const titleIssueIndex = planItemErrors.findIndex(item => item.title);
    const timeIssueIndex = planItemErrors.findIndex(item => item.time);
    const issueIndex = titleIssueIndex >= 0 ? titleIssueIndex : timeIssueIndex;
    const issueStage = stages[issueIndex];
    if (!issueStage) { addNodeButtonRef.current?.focus(); return; }
    setEditingStageId(issueStage.id);
    setEditingDurationStageId("");
    setEditingEnergyStageId("");
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const stageContainer = Array.from(phoneShellRef.current?.querySelectorAll<HTMLElement>("[data-stage-id]") ?? []).find(element => element.dataset.stageId === issueStage.id);
      const target = titleIssueIndex === issueIndex
        ? stageContainer?.querySelector<HTMLInputElement>("[data-stage-title]")
        : stageContainer?.querySelector<HTMLInputElement>('input[type="time"][aria-invalid="true"]');
      target?.scrollIntoView({ block: "center", behavior: motionReduced ? "auto" : "smooth" });
      target?.focus({ preventScroll: true });
      if (target instanceof HTMLInputElement && target.type === "text") target.select();
    }));
  };
  const planCrossesMidnight = spansMidnight(data.planStart, data.planEnd);
  const draftEnergy = stages.reduce((sum, item) => sum + item.energy, 0);
  const activeSettlementNightKey = familyNightKey(liveSessionStartedAt || new Date());
  const priorSettlementSessions = data.sessions.filter(item => item.nightKey === activeSettlementNightKey);
  const settlementTaskEnergy = stages.filter(item => item.status === "done").reduce((sum, item) => sum + item.energy, 0);
  const settlementCompletedTasks = countCompletedTasks(stages);
  const { cooperationEnergy: settlementCooperationEnergy, adjustmentEnergy: settlementAdjustmentEnergy } = calculateNightBonus(priorSettlementSessions, adjustments);
  const settlementTotalEnergy = settlementTaskEnergy + settlementCooperationEnergy + settlementAdjustmentEnergy;
  const settlementFooter = settlementFooterCopy(priorSettlementSessions.length, hasDeferredStages);
  const draftStart = stages[0]?.start ?? data.planStart;
  const draftEnd = stages.at(-1)?.end ?? data.planEnd;
  const draftReady = stages.length > 0 && !planHasErrors;
  const profileHasChildAlias = Boolean(data.childAlias.trim());
  const profileHasGuardianAlias = Boolean(data.guardianAlias.trim());
  const profileReady = profileHasChildAlias && profileHasGuardianAlias;
  const profileActionLabel = profileReady
    ? profileReturn === "settings" ? "保存修改" : "保存并安排今晚"
    : !profileHasChildAlias && !profileHasGuardianAlias
      ? "去填写两个家庭称呼"
      : profileHasChildAlias ? "再填写大人称呼" : "再填写孩子化名";
  const editingStage = stages.find(item => item.id === editingStageId);
  const editingStageDuration = editingStage ? durationMinutes(editingStage.start, editingStage.end) : 0;
  const restDurationChoices = Array.from(new Set([5, 10, 15, editingStageDuration].filter(minutes => minutes > 0))).sort((a, b) => a - b);
  const commonIconLibrary = ICON_LIBRARY.filter(([icon]) => COMMON_ICON_NAMES.has(icon));
  const selectedIconEntry = ICON_LIBRARY.find(([icon]) => icon === editingStage?.icon);
  const selectedIconOutsideCommon = Boolean(selectedIconEntry && !COMMON_ICON_NAMES.has(selectedIconEntry[0]));
  const visibleIconLibrary = showAllIcons ? ICON_LIBRARY : selectedIconEntry && !COMMON_ICON_NAMES.has(selectedIconEntry[0]) ? [selectedIconEntry, ...commonIconLibrary] : commonIconLibrary;
  const startNowLabel = clockTimeFromDate(new Date(clockNow));
  const plannedStartLabel = stages[0]?.start ?? data.planStart;
  const plannedStartOffset = clockMinutesUntil(startNowLabel, plannedStartLabel);
  const planningAhead = plannedStartOffset > 10;
  const plannedStartPassed = plannedStartOffset < 0;
  const shiftedAvailabilityEndLabel = addMinutes(startNowLabel, Math.max(1, durationMinutes(data.planStart, data.planEnd)));
  const shiftedScheduleEndLabel = addMinutes(startNowLabel, Math.max(1, durationMinutes(plannedStartLabel, draftEnd)));
  const restPlanPreview = insertRestBreak(
    stages,
    activeIndex,
    { id: "rest-preview", title: "安静休息", icon: "quiet", start: "", end: "", effort: 1, energy: 0, status: "active", kind: "rest" },
    startNowLabel,
    remainingTimerMinutes(activeEndsAt, clockNow),
    10,
    10,
    data.planEnd,
  );
  const liveScheduledEnd = scheduledEndTime(stages, data.planEnd);
  const restPreviewScheduledEnd = scheduledEndTime(restPlanPreview.items, restPlanPreview.planEnd);
  const bothParticipantsReady = guardianConfirmed && childConfirmed;
  const dualStartStatus = bothParticipantsReady
    ? { title: `即将进入“${stages[0]?.title || "第一项"}”`, detail: "约 3 秒后开始；如果还想商量一下，点“先等等”就会停住。" }
    : dualStartPaused
      ? { title: "已经停住，可以再商量一下", detail: "第一步仍然可以调整；准备好了，再各点一次名字。" }
    : guardianConfirmed
      ? { title: `轮到${data.childAlias}确认`, detail: "如果这一步也可以，就轻点名字；卡住时随时可以调整。" }
      : childConfirmed
        ? { title: `轮到${data.guardianAlias}确认`, detail: "大人确认手机仍由自己保管，也确认第一步可以随时调整。" }
        : { title: `先由${data.guardianAlias}确认`, detail: `这不是指纹或身份验证；先看看第一步是否合适，再请${data.childAlias}轻点名字。` };
  const startsAtPlannedTime = plannedStartOffset === 0;
  const dualFirstStage = stages[0] ?? FALLBACK_STAGE;
  const dualFirstDuration = Math.max(1, durationMinutes(dualFirstStage.start, dualFirstStage.end));
  const dualFirstEndLabel = addMinutes(startNowLabel, dualFirstDuration);
  const pendingAfterActiveCount = stages.filter((item, index) => index > activeIndex && item.status === "pending").length;
  const pendingAfterActiveStages = stages.filter((item, index) => index > activeIndex && item.status === "pending");
  const secondPendingAfterActiveStage = pendingAfterActiveStages[1];
  const nextPendingDuration = nextPendingStage ? Math.max(1, durationMinutes(nextPendingStage.start, nextPendingStage.end)) : 0;
  const activeStageCompleted = activeStage.status === "done";
  const adjustmentOptions: Array<{ id: AdjustmentChoice; icon: string; title: string; copy: string }> = [
    ...(!activeStageCompleted ? [{ id: "extend" as const, icon: "steps", title: canStartRest ? "延长当前阶段" : "再休息10分钟", copy: "后续时间顺延10分钟" }] : []),
    ...(canStartRest ? [{ id: "rest" as const, icon: "quiet", title: activeStageCompleted ? "下一项前休息10分钟" : "现在休息10分钟", copy: activeStageCompleted ? "已完成事项保持完成" : "原事项随后继续" }] : []),
    ...(canStartRest && !activeStageCompleted && pendingAfterActiveCount >= 1 ? [{ id: "defer" as const, icon: "moon", title: "当前事项明天再做", copy: `先放下${activeStage.title}，接着${nextPendingStage?.title ?? "下一项"}` }] : []),
    ...(pendingAfterActiveCount >= 2 ? [{ id: "swap" as const, icon: "speech", title: "调换后两项", copy: `${nextPendingStage?.title ?? "下一项"} ↔ ${secondPendingAfterActiveStage?.title ?? "再后一项"}` }] : []),
    ...(pendingAfterActiveCount >= 1 ? [{ id: "tomorrow" as const, icon: "backpack", title: "下一项移到明天", copy: pendingAfterActiveCount > 1 ? `${nextPendingStage?.title ?? "下一项"}先放下，后面提前${nextPendingDuration}分钟` : `${nextPendingStage?.title ?? "下一项"}先放下，这一段后收尾` }] : []),
    { id: "finish", icon: "home-heart", title: "今晚先到这里", copy: "保留进展，完成本次计划" },
  ];
  const completedStageCount = stages.filter(item => item.status === "done").length;
  const confirmStages = stages.filter(item => item.status !== "tomorrow");
  const tonightStageCount = confirmStages.length;
  const visibleConfirmStages = confirmPlanExpanded ? confirmStages : confirmStages.slice(0, 4);
  const activeTonightOrdinal = Math.max(1, stages.slice(0, activeIndex + 1).filter(item => item.status !== "tomorrow").length);
  const activeNightLabel = liveNightLabel(liveSessionStartedAt);
  const homeContextLabel = liveSessionAvailable
    ? `${activeNightLabel}进行中 · 手机在大人手里`
    : currentNightSummary
      ? "今天的计划已记录"
      : "家庭晚间 · 共同约定";
  const homeHeroCopy = liveSessionAvailable
    ? activeNightLabel === "昨晚"
      ? { title: "昨晚的计划还在进行", detail: "进度已经保存；继续执行、调整或结束本次计划。" }
      : { title: "今晚正在按计划进行", detail: "手机由大人保管，到点后一起确认下一步。" }
    : currentNightSummary
      ? { title: "今晚计划已完成", detail: "记录已经保存，可以回看进度或安排下一轮。" }
      : { title: "把今晚定下来，按时开始", detail: "共同排时间、确认任务，到点进入下一阶段。" };
  const liveResumeView = (() => {
    const stageTitle = activeStage?.title || "继续今晚";
    if (liveResumeScreen === "wrap") return { state: "wrap", icon: "home-heart", kicker: `${activeNightLabel}等待共同收尾 · 进度已保存在本机`, title: `完成${activeNightLabel}计划`, detail: "用30秒确认完成情况并保存记录", cta: "继续收尾 ›" };
    if (liveResumeScreen === "adjust") return { state: "adjust", icon: "speech", kicker: `${activeNightLabel}计划正在调整 · 进度已保存在本机`, title: `调整${activeNightLabel}计划`, detail: "继续、休息、调换或结束本次计划", cta: "继续调整 ›" };
    if (liveResumeScreen === "transition" && transitionReason === "completed") return { state: "completed", icon: "check", kicker: "这一段已完成 · 进度已保存在本机", title: `${stageTitle}已经告一段落`, detail: "选择下一阶段、继续、休息或调整", cta: "继续选择 ›" };
    if (liveResumeScreen === "transition" || stageDue) return { state: "due", icon: "alarm", kicker: "阶段预计到时 · 只提醒一次", title: stageTitle, detail: "完成、继续或调整，都可以", cta: "继续选择 ›" };
    return { state: "running", icon: "alarm", kicker: `${activeNightLabel}正在进行 · 进度已保存在本机`, title: stageTitle, detail: `${completedStageCount}/${tonightStageCount} 个阶段已完成`, cta: "继续 ›" };
  })();
  const foregroundReminderStatus = foregroundCueStatus(data.sound, motionReduced);
  const backgroundReminderStatus = requestingNotificationPermission
    ? "请在浏览器弹出的系统提示中选择允许或不允许；没有确认前不会开启。"
    : notificationPermission === "granted"
    ? backgroundReminder ? "应用保持打开时，切到其他应用或锁屏会尝试提醒；省电模式可能延迟" : "已获得系统权限，需要时可以在这里开启"
    : notificationPermission === "denied" ? `${foregroundReminderStatus}；如需后台提醒，请在浏览器设置中重新允许`
      : notificationPermission === "unsupported" ? `当前浏览器不支持系统提醒；${foregroundReminderStatus}`
        : "开启时只向家长请求一次浏览器通知权限；关闭页面后不会送达";
  const confirmReminderReady = backgroundReminder && notificationPermission === "granted";
  const canOfferConfirmReminder = notificationPermission === "default" || (notificationPermission === "granted" && !backgroundReminder);
  const confirmReminderCopy = requestingNotificationPermission
    ? { title: "正在等待浏览器确认", detail: "请由大人选择是否允许；不影响今晚继续。" }
    : confirmReminderReady
      ? { title: "锁屏时也会尝试到点提醒", detail: "每个阶段提醒一次；省电模式可能延迟，关闭浏览器后不保证送达。" }
      : notificationPermission === "denied"
        ? { title: "页面内提醒已经准备好", detail: "保持页面打开会提示一次；锁屏提醒需在浏览器设置中重新允许。" }
        : notificationPermission === "unsupported"
          ? { title: "页面内提醒已经准备好", detail: "当前浏览器不支持锁屏提醒，请保持页面打开；每个阶段提醒一次。" }
          : { title: "准备把手机放到一旁？", detail: "可选开启锁屏提醒；只向大人申请一次浏览器权限。" };
  const motionPreferenceStatus = data.reducedMotion
    ? "应用内已固定减少动画、页面自动滑动和轻触震动"
    : systemReducedMotion
      ? "已跟随系统减少动画、页面自动滑动和轻触震动"
      : "关闭呼吸、漂浮、庆祝动画和轻触震动；也会跟随系统设置";
  const shiftMonth = (delta: number) => {
    const next = shiftCalendarSelection(calendarCursor, selectedDay, delta);
    setCalendarCursor(next.cursor); setSelectedDay(next.selectedDay); setDayDetailsExpanded(false); setSessionDeleteArmedId("");
  };
  const jumpToToday = () => {
    const next = new Date();
    setCalendarCursor(new Date(next.getFullYear(), next.getMonth(), 1)); setSelectedDay(localDateKey(next)); setDayDetailsExpanded(false); setSessionDeleteArmedId("");
  };
  const selectCalendarDay = (key: string) => {
    setSelectedDay(key); setDayDetailsExpanded(false); setSessionDeleteArmedId("");
    window.requestAnimationFrame(() => calendarDetailRef.current?.scrollIntoView({ block: "start", behavior: motionReduced ? "auto" : "smooth" }));
  };
  const openCalendar = (nightKey: string) => {
    const date = new Date(`${nightKey}T12:00:00`);
    setSelectedDay(nightKey); setDayDetailsExpanded(false); setSessionDeleteArmedId("");
    if (Number.isFinite(date.getTime())) setCalendarCursor(new Date(date.getFullYear(), date.getMonth(), 1));
    go("review");
  };
  const openNightRecord = (nightKey: string) => {
    openCalendar(nightKey);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      calendarDetailRef.current?.scrollIntoView({ block: "start", behavior: motionReduced ? "auto" : "smooth" });
    }));
  };
  const hasRewardResetAfter = (record: SessionRecord) => {
    const recordTime = Date.parse(record.date);
    if (!Number.isFinite(recordTime)) return true;
    return data.rewardHistory.some(item => {
      const rewardTime = Date.parse(item.redeemedAt);
      return Number.isFinite(rewardTime) && rewardTime > recordTime;
    });
  };
  const deleteSessionRecord = (record: SessionRecord) => {
    const result = removeSessionAndReconcileEnergy(data.sessions, record.id, data.energy, data.rewardHistory.map(item => item.redeemedAt));
    const label = sessionTimeLabel(record.date);
    setDeletedStage(null); setShiftedPlanUndo(null); setSessionDeleteUndo({
      recordId: record.id,
      label,
      sessions: data.sessions.map(item => ({ ...item, stageTitles: [...item.stageTitles] })),
      energy: data.energy,
      message: result.currentCycleAdjusted && result.removedEnergy
        ? `已删除 ${label} 的记录，当前能量减少${result.removedEnergy}点`
        : `已删除 ${label} 的日历记录`,
    });
    setSessionDeleteArmedId("");
    persist({ ...data, sessions: result.sessions, energy: result.energy });
  };
  const cancelSessionDelete = (recordId: string) => {
    setSessionDeleteArmedId(""); focusSessionDeleteTrigger(recordId);
  };
  const undoDeleteSessionRecord = () => {
    if (!sessionDeleteUndo) return;
    const undo = sessionDeleteUndo;
    setSessionDeleteUndo(null); setDayDetailsExpanded(true);
    persist({ ...data, sessions: undo.sessions, energy: undo.energy }, "已恢复这次记录和删除前的能量");
    focusSessionDeleteTrigger(undo.recordId);
  };
  const startAnotherPlan = () => {
    setEditingStageId("");
    if (currentNightSummary) {
      const nowTime = clockTimeFromDate(new Date());
      const followUp = rebaseFollowUpPlan(data.planStart, data.planEnd, stages, nowTime);
      setStages(followUp.items);
      setData(current => ({ ...current, planStart: followUp.planStart, planEnd: followUp.planEnd }));
      setFollowUpPlanMessage(followUp.items.length
        ? followUp.keptPlanEnd
          ? `剩余事项保留原时长和顺序，收尾仍是 ${followUp.planEnd}。`
          : `剩余事项保留原时长和顺序，收尾更新为 ${followUp.planEnd}。`
        : "");
    } else {
      setFollowUpPlanMessage("");
    }
    go("plan");
  };
  const savePlanForLater = () => {
    setToast(`已保存，${formatPlanClock(plannedStartLabel, data.planStart, data.planEnd)}再回来一起点亮`);
    go("home");
  };
  const toggleWeeklyFocus = () => {
    if (currentWeekFocus?.text === reviewSuggestion.text) {
      persist({ ...data, weeklyFocus: null }, "已从首页移除这项尝试"); return;
    }
    persist({ ...data, weeklyFocus: { weekKey: weekStartKey, text: reviewSuggestion.text, createdAt: new Date().toISOString() } }, "已放到首页，这周只试这一件");
  };

  return <main className={`site-shell ${motionReduced ? "reduce-motion" : ""}`} data-screen={screen}>
    <div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <section className={`phone-shell ${isOnline ? "" : "is-offline"}`} ref={phoneShellRef} aria-hidden={deleteArmed || undefined} inert={deleteArmed || undefined}>
      {!isOnline && <div className="offline-ribbon" role="status"><i aria-hidden="true" /><span><strong>离线使用中</strong><small>今晚仍会安全保存在本机</small></span></div>}
      {!appReady && <div className="screen app-loading-screen" role="status" aria-live="polite"><div className="brand-mark"><AppIcon name="home-heart" /><strong>先开始</strong></div><Mascot mood="breathe" /><div><strong>正在确认这台设备的家庭记录</strong><span>先读取本机，再核对对应的云端副本</span></div><span className="loading-leaves" aria-hidden="true"><i /><i /><i /></span></div>}
      {appReady && screen === "welcome" && <div className="screen welcome-screen">
        <div className="welcome-brand"><div className="brand-mark"><AppIcon name="home-heart" /><strong>先开始</strong></div><span>家庭晚间习惯助手</span></div>
        {deletionNotice === "complete" && <div className="pending-delete-note deletion-complete-note" role="status"><AppIcon name="check" /><span><strong>家庭数据已全部删除</strong><small>本机和云端记录都已清理；重新开始时不会带入旧家庭的信息。</small></span></div>}
        {(pendingCloudDeletion || deletionNotice === "pending") && <div className="pending-delete-note welcome-pending-delete" role="status"><AppIcon name="alarm" /><span><strong>旧家庭的云端副本等待清理</strong><small>本机数据已经删除；恢复联网后会自动重试，只保留随机家庭令牌作为删除凭证。</small></span></div>}
        <div className="welcome-hero"><div><span className="eyebrow">家庭共同计划 · 手机由大人保管</span><h1>把今晚定下来，<br />一起按时开始</h1><p className="lead">共同安排任务、休息与奖励，到点提醒，完成后一起收尾。</p></div><Mascot mood="ready" compact /></div>
        <div className="welcome-flow" aria-label="三步使用方式"><div><b>1</b><span><strong>定时间</strong><small>排好任务与休息</small></span></div><div><b>2</b><span><strong>共同确认</strong><small>两人点亮再开始</small></span></div><div><b>3</b><span><strong>按阶段完成</strong><small>到点确认下一步</small></span></div></div>
        <div className="privacy-card welcome-boundary"><div><span className="big-icon"><AppIcon name="privacy" /></span><span><strong>孩子不会被监控或公开比较</strong><small>仅使用家庭化名；不收集学校、年级、位置、录音或社交平台数据。</small></span></div><button type="button" onClick={() => openPrivacy("welcome")}>查看数据保存与删除说明 <span>›</span></button></div>
        <div className="welcome-action-dock"><label className={`consent-row ${consent ? "is-checked" : ""}`} htmlFor="guardian-consent"><input id="guardian-consent" type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /><span><strong>我已确认自己是监护人</strong><small>了解并同意监护人授权与儿童隐私说明</small></span></label><button className={`primary-button welcome-continue-button ${consent ? "is-ready" : ""}`} disabled={!consent} onClick={() => openProfile("welcome")}>{consent ? "继续设置家庭称呼" : "确认后继续"}</button><small>约 1 分钟完成设置 · 数据可随时导出或删除</small></div>
      </div>}

      {appReady && screen === "privacy" && <div className="screen privacy-screen">
        <Header back={() => back(privacyReturn)} backLabel={privacyReturn === "welcome" ? "返回监护人授权页" : "返回设置页"} title="隐私与数据说明" />
        <div className="title-with-mascot"><div><span className="eyebrow">监护人先看清楚，再决定是否使用</span><h1>哪些数据保存在哪里？</h1></div><Mascot mood="support" compact /></div>
        <p className="lead">我们只保留完成核心流程需要的信息，不收集孩子真实姓名、年级、学校、精确位置、通讯录、人脸、声音或持续行为监控数据。</p>
        <div className="privacy-storage-list">
          <div><span className="big-icon"><AppIcon name="moon" /></span><section><small>仅保存在当前设备</small><strong>今晚计划草稿与进行中状态</strong><p>用于刷新或意外关页后继续；凌晨可以接着昨晚，最迟到次日清晨5点自动失效。</p></section></div>
          <div><span className="big-icon"><AppIcon name="alarm" /></span><section><small>仅保存在当前设备</small><strong>后台提醒开关与浏览器通知权限</strong><p>只有监护人主动开启后才使用；关闭浏览器后不承诺提醒送达。</p></section></div>
          <div><span className="big-icon"><AppIcon name="privacy" /></span><section><small>当前测试版会保存云端副本</small><strong>家庭化名、设置、能量、晚间与期待实现记录</strong><p>通过保存在当前设备上的高熵随机家庭令牌关联；令牌只经同源请求发送，不放进网址。旧状态不会静默覆盖更新的本机记录。最多保留最近730次晚间收尾和120次期待实现，超过后按时间移除最旧记录，可随时提前导出。</p><div className="storage-boundary-note"><strong>不能跨设备找回</strong><span>这不是账号同步：换设备、换浏览器或清除站点数据后无法找回，也不会自动出现在另一台设备。</span></div></section></div>
          <div><span className="big-icon"><AppIcon name="quiet" /></span><section><small>不会收集</small><strong>学校、位置、通讯录、人脸、录音与社交平台数据</strong><p>外部内容只能由监护人主动输入，不读取微信、小红书或学校系统。</p></section></div>
        </div>
        <div className="privacy-transparency"><strong>受邀测试说明</strong><p>当前版本仅供受邀家庭试用，请不要转发测试入口。正式开放前，我们会增加监护人登录与家庭访问保护；如果无法做到，就停止保存云端副本。</p></div>
        <div className="data-rights-card"><span className="eyebrow">家庭可以随时</span><h2>导出或删除全部数据</h2><p>导出文件包含家庭状态、本机计划草稿和进行中状态。删除会清除本机数据、云端记录和旧的随机家庭令牌。</p>{data.consent && <div className="two-buttons"><button className="secondary-button" onClick={exportData}>导出数据</button><button className="secondary-button danger-outline" onClick={requestDeleteData}>删除全部家庭数据</button></div>}</div>
        <button className="primary-button" onClick={() => back(privacyReturn)}>{privacyReturn === "welcome" ? "我已了解，返回授权" : "返回设置"}</button>
      </div>}

      {appReady && screen === "profile" && <div className="screen profile-screen">
        <Header back={() => back(profileReturn)} backLabel={profileReturn === "settings" ? "返回设置页" : "返回监护人授权页"} title="家庭设置" />
        <div className="title-with-mascot"><div><span className="eyebrow">只填写今晚真正会用到的信息</span><h1>今晚，怎么称呼彼此？</h1></div><Mascot compact /></div>
        <div className="form-card family-form profile-essential"><label>孩子希望怎么被称呼<span>用化名就好</span><input ref={childAliasInputRef} name="child-alias" aria-label="孩子化名" placeholder="例如：小橙" maxLength={12} autoComplete="off" autoCapitalize="none" spellCheck={false} enterKeyHint="next" value={data.childAlias} onChange={e => setData({ ...data, childAlias: e.target.value })} onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); guardianAliasInputRef.current?.focus(); } }} /></label><label>大人怎么称呼<span>会显示在共同启动的手指上</span><input ref={guardianAliasInputRef} name="guardian-alias" aria-label="大人称呼" placeholder="例如：妈妈" maxLength={12} autoComplete="off" autoCapitalize="none" spellCheck={false} enterKeyHint="done" value={data.guardianAlias} onChange={e => setData({ ...data, guardianAlias: e.target.value })} onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); finishProfile(); } }} /></label></div>
        <div className="profile-action-dock"><p className="microcopy">不需要填写年级、学校、班级或真实姓名。</p><button className={`primary-button profile-continue-button ${profileReady ? "is-ready" : "needs-input"}`} aria-label={profileActionLabel} onClick={finishProfile}>{profileActionLabel}</button>{profileReturn !== "settings" && <small>{profileReady ? "下一步直接商量今晚的任务与休息" : "点击按钮会带你到还需要填写的位置"}</small>}</div>
      </div>}

      {screen === "home" && <div className="screen with-nav home-screen">
        <div className="home-hero"><div><span className="eyebrow">{homeContextLabel}</span><h1>{homeHeroCopy.title}</h1><p>{homeHeroCopy.detail}</p></div><Mascot mood={!liveSessionAvailable && currentNightSummary ? "celebrate" : "confirm"} compact /></div>
        {liveSessionAvailable ? <div className="live-session-panel" data-state={liveResumeView.state}><button className="live-resume-card" onClick={() => go(liveResumeScreen)}><span className="live-pulse"><AppIcon name={liveResumeView.icon} /></span><span><small>{liveResumeView.kicker}</small><strong>{liveResumeView.title}</strong><em>{liveResumeView.detail}</em></span><b>{liveResumeView.cta}</b></button>{liveResumeScreen !== "wrap" && <button className="soft-end-button" onClick={endTonightEarly}>{activeNightLabel}先到这里</button>}</div> : currentNightSummary ? <div className="settled-home-card"><div className="settled-home-title"><span className="settled-check"><AppIcon name="check" /></span><div><small>家庭日历已记录</small><strong>今晚的共同计划已保存</strong><p>{currentNightSummary.reflection ? promptReflectionCopy[currentNightSummary.reflection] : "按共同约定完成，就是今晚的进展。"}</p></div></div><div className="settled-home-stats"><span><b>{currentNightSummary.completed}</b><small>{currentNightSummary.completionUnit === "tasks" ? "完成事项" : "完成节点"}</small></span><span><b>{currentNightSummary.adjustments}</b><small>主动调整</small></span><span><b>+{currentNightSummary.energy}</b><small>本夜能量</small></span></div><button className="primary-button settled-review-button" onClick={() => openNightRecord(currentFamilyNightKey)}>查看这一晚的记录</button><button className="text-button another-plan-button" onClick={startAnotherPlan}>安排新的任务</button><small className="settled-energy-rule">同一晚再次安排不会重复获得共同收尾能量</small></div> : <button className="home-plan-cta" onClick={() => draftReady ? openConfirmPlan() : startAnotherPlan()}><span className="home-plan-icon"><AppIcon name="moon" /></span><span className="home-plan-copy"><small>{stages.length ? `今晚时间表 · ${draftUpdatedAt ? "已自动保存" : "仅保存在这台设备"}` : "今晚计划"}</small><strong>{draftReady ? `${formatPlanClock(draftStart, data.planStart, data.planEnd)} 一起开始` : stages.length ? "继续安排今晚" : "开始安排今晚"}</strong><em>{stages.length ? `${stages.length}个节点 · ${formatPlanClock(draftStart, data.planStart, data.planEnd)}—${formatPlanClock(draftEnd, data.planStart, data.planEnd)} · ${draftReady ? "确认后按时启动" : "还有内容需要确认"}` : "先添加第一项任务或休息"}</em></span><b aria-hidden="true">›</b></button>}
        <div className="insight-card sage"><span className="big-icon"><AppIcon name="alarm" /></span><div><small>阶段提醒</small><strong>每个阶段到点提醒一次，可完成、继续或调整</strong></div></div>
        {currentWeekFocus && <button className="insight-card weekly-focus-home" onClick={() => go("review")}><span className="big-icon"><AppIcon name="home-heart" /></span><div><small>这周只试这一件 · 给大人的提醒</small><strong>{currentWeekFocus.text}</strong></div><span>›</span></button>}
        <button className={`insight-card support-entry goal-entry-${goalState}`} onClick={goalState === "empty" ? openRewardSetup : goalState === "ready" ? () => openRewardAchieved() : () => go("energy")}><span className="big-icon"><AppIcon name={goalState === "empty" ? "home-heart" : goalState === "ready" ? data.rewardGoal.icon : "plant"} /></span><div><small>{goalState === "empty" ? "下一份家庭期待" : goalState === "ready" ? "家庭期待已点亮" : "家庭期待"}</small><strong>{goalState === "empty" ? "一起定下想共度的家庭时光" : data.rewardGoal.title}</strong><small>{goalState === "empty" ? "从0开始，不用急着定" : goalState === "ready" ? "等你们真的一起实现后再记录" : `还差${progress}点，一起积累`}</small></div><span>›</span></button>
        <div className="stats-row"><div><small>本周记录</small><strong>{weeklyNights} 晚</strong></div><div><small>家庭能量</small><strong>{data.energy}</strong><div className="energy-leaves">{[1,2,3,4,5].map(n => <i className={n <= Math.min(5, Math.ceil(data.energy / 6)) ? "filled" : ""} key={n} />)}</div></div></div>
        <p className="sync-label" role="status" aria-live="polite">{syncLabel}</p>
      </div>}

      {screen === "plan" && <div className="screen plan-screen">
        <Header back={() => back("home")} title="一起安排今晚" step="1/3" />
        <div className="availability-card custom-window"><AppIcon name="moon" /><div><small>今晚时间</small><div className="window-inputs"><input ref={planStartInputRef} aria-label="今晚开始时间" type="time" value={data.planStart} onFocus={() => beginPlanWindowEdit("start")} onBlur={e => endPlanWindowEdit("start", e.currentTarget.value)} onChange={e => updatePlanStart(e.target.value)} /><span>至</span><input aria-label="今晚结束时间" type="time" value={data.planEnd} onFocus={() => beginPlanWindowEdit("end")} onBlur={e => endPlanWindowEdit("end", e.currentTarget.value)} onChange={e => { setFollowUpPlanMessage(""); setData(current => ({ ...current, planEnd: e.target.value })); }} /></div><span className="window-shift-note">修改开始时间，后续节点会保持间隔一起移动</span>{planCrossesMidnight && <span className="overnight-note">跨到次日 · 结束时间按第二天计算</span>}</div><Mascot compact /></div>
        {followUpPlanMessage && <div className="follow-up-plan-note" role="status"><AppIcon name="check" /><span><strong>已按当前时间续排</strong><small>{followUpPlanMessage}</small></span></div>}
        <div className={`plan-balance ${planNeedsTime ? "has-error" : ""}`} role="status"><div><span>{planNeedsTime ? "时间需要调整" : `已安排 ${scheduledMinutes} 分钟`}</span><strong>{planNeedsTime ? planTimeIssue : planBalance ? `还留有 ${planBalance} 分钟空白` : "刚好装下今晚"}</strong></div><div className="balance-track"><i style={{ width: `${availableMinutes ? Math.min(100, scheduledMinutes / availableMinutes * 100) : 100}%` }} /></div></div>
        <div className="plan-tools"><span>草稿会自动保存在本机</span>{stages.length > 0 && <button className={clearPlanArmed ? "armed" : ""} onClick={clearPlan}>{clearPlanArmed ? "确认清空" : "清空时间表"}</button>}</div>
        <div className={`plan-list ${!stages.length ? "is-empty" : ""}`}>{!stages.length && <button ref={addNodeButtonRef} type="button" className="empty-plan empty-plan-action" onClick={addStage} aria-label="增加第一个时间节点"><Mascot mood="breathe" compact /><strong>添加今晚第一项</strong><span className="empty-plan-cta"><b aria-hidden="true">＋</b>添加任务或休息</span><small>先定名称、时间和完成能量</small></button>}{stages.map((stage, index) => { const expanded = editingStageId === stage.id; const hasIssue = planStageIssueIds.has(stage.id); const issueText = stageIssueById.get(stage.id); const titleInvalid = Boolean(planItemErrors[index]?.title); const timeInvalid = Boolean(planItemErrors[index]?.time); const stageName = stage.title.trim() || "未命名事项"; return <div data-stage-id={stage.id} className={`stage-editor ${expanded ? "is-expanded" : "is-collapsed"} ${timeInvalid ? "has-stage-issue" : titleInvalid ? "needs-title" : ""} ${stage.status === "tomorrow" ? "muted-stage" : ""}`} key={stage.id}>
          <button className="stage-summary" aria-expanded={expanded} aria-controls={`stage-editor-${stage.id}`} aria-label={`${expanded ? "收起" : "编辑"}第${index + 1}项${stageName}`} onClick={() => { setEditingStageId(expanded ? "" : stage.id); setEditingDurationStageId(""); setEditingEnergyStageId(""); }}><span className="stage-summary-icon"><AppIcon name={stage.icon} /></span><span className="stage-summary-copy"><strong>{stageName}</strong><small>{titleInvalid ? "还没写下这件事" : timeInvalid ? "需要调整时间" : `${formatPlanClock(stage.start, data.planStart, data.planEnd)}—${formatPlanClock(stage.end, data.planStart, data.planEnd)} · ${stage.kind === "rest" ? "休息放松" : effortCopy[stage.effort]}`}</small></span><span className={`stage-summary-energy ${stage.energy ? "" : "is-zero"}`}><b>{stage.energy || "—"}</b><small>{stage.energy ? "能量" : "不计"}</small></span><i aria-hidden="true">⌄</i></button>
          {expanded && <div id={`stage-editor-${stage.id}`} className="stage-editor-body">
            <button className="stage-icon-button" onClick={() => { setEditingStageId(stage.id); go("icon-picker"); }} aria-label={`更换${stageName}图标`}><AppIcon name={stage.icon} /><small>换图标</small></button>
            <div className="stage-main">
              {titleInvalid && <div id={`stage-title-hint-${stage.id}`} className="stage-edit-hint"><b>事项名称</b><span>写下双方刚刚商定的任务或休息</span></div>}
              <input data-stage-title className="stage-title-input" aria-label={`第${index + 1}项名称`} aria-invalid={titleInvalid} aria-describedby={titleInvalid ? `stage-title-hint-${stage.id}` : hasIssue ? `stage-issue-${stage.id}` : undefined} placeholder="例如：阅读、吃饭或休息" maxLength={24} autoComplete="off" spellCheck={false} enterKeyHint="done" value={stage.title} onChange={e => updateStage(stage.id, { title: e.target.value })} onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); if (!e.currentTarget.value.trim()) { setToast("先写下这件事，再继续安排"); return; } e.currentTarget.blur(); focusStageDetails(stage.id); } }} />
              <div className="time-range"><input aria-label={`${stage.title || `第${index + 1}项`}开始时间`} aria-invalid={timeInvalid} aria-describedby={hasIssue ? `stage-issue-${stage.id}` : undefined} type="time" value={stage.start} onFocus={() => beginStageTimeEdit(stage.id, "start")} onBlur={e => endStageTimeEdit(stage.id, "start", e.currentTarget.value)} onChange={e => updateStageStart(stage.id, e.target.value)} /><span>—</span><input aria-label={`${stage.title || `第${index + 1}项`}结束时间`} aria-invalid={timeInvalid} aria-describedby={hasIssue ? `stage-issue-${stage.id}` : undefined} type="time" value={stage.end} onFocus={() => beginStageTimeEdit(stage.id, "end")} onBlur={e => endStageTimeEdit(stage.id, "end", e.currentTarget.value)} onChange={e => updateStageEnd(stage.id, e.target.value)} /></div>
              <div className="stage-meta">
                <button className={`effort-pill effort-${stage.kind === "rest" ? "rest" : stage.effort}`} aria-label={`调整节点类型和用力程度：${stage.kind === "rest" ? "休息放松" : `要做的事，${effortCopy[stage.effort]}`}`} onClick={() => { setEditingStageId(stage.id); go("effort"); }}><span className="effort-wide">{stage.kind === "rest" ? "休息放松 · 调整" : `任务 · ${effortCopy[stage.effort]}`}</span><span className="effort-compact">{stage.kind === "rest" ? "休息" : effortCopy[stage.effort]}</span></button>
                <button type="button" className="duration-detail-toggle" aria-label={`调整${stageName}时长：当前${durationMinutes(stage.start, stage.end)}分钟`} aria-expanded={editingDurationStageId === stage.id} aria-controls={`stage-duration-${stage.id}`} onClick={() => { setEditingEnergyStageId(""); setEditingDurationStageId(current => current === stage.id ? "" : stage.id); }}><span>时长</span><strong>{durationMinutes(stage.start, stage.end)}分</strong><i aria-hidden="true">⌄</i></button>
                <button type="button" className={`energy-detail-toggle ${stage.energy ? "" : "is-zero"}`} aria-label={`调整${stageName}完成后的家庭能量：${stageEnergyLabel(stage.energy)}`} aria-expanded={editingEnergyStageId === stage.id} aria-controls={`stage-energy-${stage.id}`} onClick={() => { setEditingDurationStageId(""); setEditingEnergyStageId(current => current === stage.id ? "" : stage.id); }}><span>能量</span><strong>{stage.energy ? `${stage.energy} 点` : "不计"}</strong><i aria-hidden="true">⌄</i></button>
                {editingDurationStageId === stage.id && <div id={`stage-duration-${stage.id}`} className="task-duration"><span><b>先选一个容易开始的长度</b><strong>{durationMinutes(stage.start, stage.end)} 分钟</strong></span><div className="task-duration-scale" aria-label={`${stageName}时长快捷选择`}>{[1,5,10,15,20,30].map(minutes => { const selected = durationMinutes(stage.start, stage.end) === minutes; return <button type="button" key={minutes} className={selected ? "selected" : ""} aria-pressed={selected} aria-label={`${minutes === 1 ? "1分钟启动" : `${minutes}分钟`}${selected ? "，当前时长" : ""}`} onClick={() => { updateStageEnd(stage.id, addMinutes(stage.start, minutes)); setEditingDurationStageId(""); }}>{minutes === 1 ? "1分钟\n启动" : `${minutes}分钟`}</button>; })}</div><small>选择后会保留后续节点的间隔一起移动；上方仍可精确调整起止时间。</small></div>}
                {editingEnergyStageId === stage.id && <div id={`stage-energy-${stage.id}`} className={`task-energy ${stage.energy ? "" : "is-zero"}`}><span><b>共同商量能量</b><strong>{stage.energy ? `${stage.energy} 点` : "不计能量"}</strong></span><input className="task-energy-range branded-range" type="range" min="0" max="5" step="1" value={stage.energy} aria-label={`${stageName}完成后的家庭能量`} aria-valuetext={stageEnergyLabel(stage.energy)} style={{ "--range-progress": `${stage.energy * 20}%` } as CSSProperties} onChange={e => updateStage(stage.id, { energy: Number(e.target.value) })} /><div className="task-energy-scale" aria-label={`${stageName}能量快捷选择`}>{[0,1,2,3,4,5].map(value => <button type="button" key={value} className={stage.energy === value ? "selected" : ""} aria-pressed={stage.energy === value} aria-label={`${stageName}${value === 0 ? "不计能量" : `${value}点能量`}`} onClick={() => updateStage(stage.id, { energy: value })}>{value === 0 ? "不计" : value}</button>)}</div><small className="task-energy-note">可以拖动，也可以直接点选；休息事项可以选“不计”。</small></div>}
              </div>
              {issueText && !titleInvalid && <p id={`stage-issue-${stage.id}`} className="stage-inline-issue" aria-live="polite">{issueText}</p>}
            </div>
            <div className="stage-actions">{stages.length > 1 && <><button onClick={() => moveStage(index, -1)} disabled={index === 0} aria-label="向上移动">↑</button><button onClick={() => moveStage(index, 1)} disabled={index === stages.length - 1} aria-label="向下移动">↓</button></>}<button className="stage-delete-button" onClick={() => removeStage(stage, index)} aria-label={`删除${stageName}，可撤销`}>删除</button></div>
          </div>}
        </div>; })}</div>
        {stages.length > 0 && <button ref={addNodeButtonRef} className="add-node-button" onClick={addStage} disabled={stages.length >= MAX_PLAN_STAGES} aria-describedby="plan-node-guidance" aria-label={stages.length >= MAX_PLAN_STAGES ? `今晚已到${MAX_PLAN_STAGES}个时间节点上限` : "增加一个时间节点"}><span>{stages.length >= MAX_PLAN_STAGES ? "✓" : "＋"}</span><strong>{stages.length >= MAX_PLAN_STAGES ? "今晚事项已满" : "添加下一项"}</strong></button>}
        <div id="plan-node-guidance" className="gentle-note">{stages.length >= MAX_PLAN_STAGES ? "可以合并相近事项，或删除不需要的一项。" : stages.length ? "按今晚的真实安排继续添加；时间和顺序都能随时调整。" : "从今晚双方都确认的第一项开始。"}</div>
        {stages.length > 0 && <div className={`plan-next-dock ${planHasErrors ? "needs-fix" : "is-ready"}`} role="region" aria-label="安排进度与下一步"><span><small>{planHasErrors ? "完成必要信息后即可确认" : "今晚时间表"}</small><strong>{planHasErrors ? planErrorPrompt : `${stages.length} 项 · ${scheduledMinutes} 分钟`}</strong></span><button type="button" aria-label={planHasErrors ? `${planErrorPrompt}，定位到需要补充的位置` : "一起确认今晚时间表"} onClick={planHasErrors ? focusFirstPlanIssue : openConfirmPlan}>{planHasErrors ? planNeedsTitle ? "去填写" : "去调整" : "共同确认"}<b aria-hidden="true">›</b></button></div>}
      </div>}

      {screen === "icon-picker" && <div className="screen icon-picker-screen">
        <Header back={() => back("plan")} backLabel="返回今晚计划" title="选择活动图标" /><span className="eyebrow">{showAllIcons ? `全部 ${ICON_LIBRARY.length} 个图标` : selectedIconOutsideCommon ? `当前图标 + ${commonIconLibrary.length} 个家庭高频图标` : `先显示 ${commonIconLibrary.length} 个家庭高频图标`}</span><h1>这件事看起来像什么？</h1>
        <div className="icon-library">{visibleIconLibrary.map(([icon,label]) => { const selected = editingStage?.icon === icon; const fillsEmptyTitle = !editingStage?.title.trim() && icon !== "custom"; return <button key={icon} aria-pressed={selected} className={selected ? "selected" : ""} onClick={() => { updateStage(editingStageId, { icon, title: titleAfterIconChoice(editingStage?.title ?? "", icon, label) }); setShowAllIcons(false); back("plan"); if (fillsEmptyTitle) setToast(`已用“${label}”补上名称，仍可修改`); }}><AppIcon name={icon} loading="lazy" /><small>{label}</small></button>; })}</div>
        <button className="icon-library-toggle" aria-expanded={showAllIcons} onClick={() => setShowAllIcons(value => !value)}>{showAllIcons ? "收起到常用图标" : `显示全部 ${ICON_LIBRARY.length} 个图标`}</button>
      </div>}

      {screen === "effort" && <div className="screen effort-screen">
        <Header back={() => back("plan")} backLabel="返回今晚计划" title="调整节点" />
        <span className="eyebrow">选择会自动保存 · 先确定它是投入，还是恢复</span><h1>这段时间更像什么？</h1>
        <div className="current-task-card"><AppIcon name={editingStage?.icon ?? "pencil"} /><div><strong>{editingStage?.title.trim() || "这个时间节点"}</strong><small>同一件事在不同晚上，也可以有不同感觉</small></div></div>
        <div className="stage-kind-picker" role="group" aria-label="节点类型"><button aria-pressed={editingStage?.kind === "task"} className={editingStage?.kind === "task" ? "selected" : ""} onClick={() => updateStage(editingStageId, { kind: "task", energy: editingStage?.kind === "rest" ? Math.max(1, editingStage.energy) : editingStage?.energy ?? 1 })}><AppIcon name="pencil" /><span><strong>要做的事</strong><small>需要投入一点注意力</small></span></button><button aria-pressed={editingStage?.kind === "rest"} className={editingStage?.kind === "rest" ? "selected" : ""} onClick={() => updateStage(editingStageId, { kind: "rest", effort: 1, energy: editingStage?.kind === "task" ? 0 : editingStage?.energy ?? 0 })}><AppIcon name="quiet" /><span><strong>休息放松</strong><small>让身体和情绪恢复</small></span></button></div>
        {editingStage?.kind === "task" ? <><h2 className="detail-heading">今天需要多少力气？</h2><div className="effort-options">{([1,2,3] as Effort[]).map(level => { const copy = { 1: ["一小步", "我可以先自己试试"], 2: ["需要专注", "请帮我把第一步说清楚"], 3: ["今天比较费力", "先缩小任务或多休息"] }[level]; const selected = editingStage?.effort === level; return <button key={level} aria-pressed={selected} className={selected ? `selected effort-${level}` : `effort-${level}`} onClick={() => updateStage(editingStageId, { effort: level })}><span className="effort-leaves">{Array.from({ length: level }).map((_, i) => <i key={i} />)}</span><span><strong>{copy[0]}</strong><small>{copy[1]}</small></span><b>{selected ? "✓" : "○"}</b></button>; })}</div></> : <div className="rest-duration"><span>这次准备休息多久？</span><div className={restDurationChoices.length > 3 ? "has-custom-duration" : ""}>{restDurationChoices.map(minutes => { const selected = editingStageDuration === minutes; return <button key={minutes} aria-pressed={selected} aria-label={`${minutes}分钟${selected ? "，当前时长" : ""}`} className={selected ? "selected" : ""} onClick={() => editingStage && updateStageEnd(editingStageId, addMinutes(editingStage.start, minutes))}>{minutes}分钟</button>; })}</div><small>先约定时长，到点再一起看看下一步，不用突然打断。</small></div>}
        <div className="support-suggestion"><Mascot mood="support" compact /><div><small>今晚建议</small><strong>{editingStage?.kind === "rest" ? "休息也算照顾计划的一部分" : (editingStage?.effort ?? 1) === 3 ? "先休息10分钟，再缩小第一步" : "从第一小步开始，卡住时再求助"}</strong><p>{editingStage?.kind === "rest" ? "休息不会被当作偷懒，也不需要用屏幕填满。" : "用力程度不会改变家庭能量，也不会给孩子打分。"}</p></div></div>
        <button className="primary-button" onClick={() => back("plan")}>完成调整，返回时间表</button>
      </div>}

      {screen === "confirm" && <div className="screen confirm-screen">
        <Header back={() => back("plan")} title="共同确认" step="2/3" />
        <div className="confirm-hero"><div><span className="eyebrow">先确认今晚，再确认彼此</span><h1>这份安排，<br />我们都可以调整</h1></div><Mascot mood="confirm" compact /></div>
        <div className="summary-strip"><span><strong>{stages[0]?.start}</strong><small>计划开始</small></span><span><strong>{tonightStageCount}</strong><small>个阶段</small></span><span><strong>{draftEnergy || "可选"}</strong><small>{draftEnergy ? "点能量" : "不强制积分"}</small></span></div>
        {plannedStartOffset !== 0 && <div className={`confirm-timing-note ${plannedStartPassed ? "is-late" : "is-early"}`} role="status"><AppIcon name="alarm" /><span><strong>{plannedStartPassed ? `原定 ${plannedStartLabel} 已过，整晚将顺延` : `现在开始，整晚将比原定 ${plannedStartLabel} 前移`}</strong><small>事项预计 {formatPlanClock(shiftedScheduleEndLabel, startNowLabel, shiftedAvailabilityEndLabel)} 结束 · 时长与空档不变</small></span></div>}
        <section className="confirm-plan-overview" aria-labelledby="confirm-plan-heading"><div className="confirm-plan-heading"><div><h2 id="confirm-plan-heading">今晚全程</h2><small>事项预计 {formatPlanClock(draftEnd, data.planStart, data.planEnd)} 结束 · 可用时间到 {formatPlanClock(data.planEnd, data.planStart, data.planEnd)}</small></div><button onClick={() => go("plan")}>修改时间表</button></div><div id="confirm-plan-list" className="confirm-plan-list">{visibleConfirmStages.map((stage, index) => <div className={`confirm-plan-row ${index === 0 ? "is-first" : ""}`} key={stage.id}><span className="confirm-plan-icon"><AppIcon name={stage.icon} /></span><span className="confirm-plan-copy"><strong>{stage.title}</strong><small>{index === 0 ? "先从这里开始 · " : ""}{formatPlanClock(stage.start, data.planStart, data.planEnd)}—{formatPlanClock(stage.end, data.planStart, data.planEnd)} · {stage.kind === "rest" ? "休息放松" : effortCopy[stage.effort]}</small></span><span className={`confirm-plan-energy ${stage.energy ? "" : "is-zero"}`}><b>{stage.energy ? `+${stage.energy}` : "—"}</b><small>{stage.energy ? "能量" : "不计"}</small></span></div>)}</div>{confirmStages.length > 4 && <button className="confirm-plan-toggle" aria-expanded={confirmPlanExpanded} aria-controls="confirm-plan-list" onClick={() => setConfirmPlanExpanded(value => !value)}>{confirmPlanExpanded ? "收起完整时间表" : `查看其余 ${confirmStages.length - 4} 个节点`}</button>}</section>
        <section className={`confirm-reminder-card ${confirmReminderReady ? "is-ready" : ""}`} aria-labelledby="confirm-reminder-title"><span className="confirm-reminder-icon"><AppIcon name={confirmReminderReady ? "check" : "alarm"} /></span><span className="confirm-reminder-copy"><small>阶段提醒 · 可选</small><strong id="confirm-reminder-title">{confirmReminderCopy.title}</strong><span id="confirm-reminder-detail" aria-live="polite">{confirmReminderCopy.detail}</span></span>{canOfferConfirmReminder && <button type="button" disabled={requestingNotificationPermission} aria-busy={requestingNotificationPermission || undefined} aria-describedby="confirm-reminder-detail" onClick={() => void changeBackgroundReminder(true)}>{requestingNotificationPermission ? "等待确认…" : notificationPermission === "granted" ? "开启" : "尝试开启"}</button>}</section>
        <div className="family-agreement"><div><AppIcon name="family" /><span><strong>{data.guardianAlias}</strong><small>先给第一步留出空间</small></span></div><div><AppIcon name="home-heart" /><span><strong>{data.childAlias}</strong><small>卡住时可以主动说</small></span></div></div>
        <div className="privacy-note">计划可以随时改；休息、换顺序或明天继续，都不算失败。</div><div className={`confirm-action-dock ${planningAhead ? "is-planning-ahead" : ""}`}>{planningAhead ? <><button className="primary-button" onClick={savePlanForLater}>保存时间表，稍后开始</button><button className="confirm-secondary-action" onClick={enterDualStart}>现在开始，时间整体前移</button><small>时间表会留在首页；到 {formatPlanClock(plannedStartLabel, data.planStart, data.planEnd)} 再回来一起点亮。</small></> : plannedStartPassed ? <><button className="primary-button" onClick={enterDualStart}>从现在一起开始，时间整体顺延</button><button className="confirm-secondary-action" onClick={() => go("plan")}>先调整时间表</button><small>原定 {formatPlanClock(plannedStartLabel, data.planStart, data.planEnd)} 已过；不会压缩或跳过任何一项。</small></> : plannedStartOffset > 0 ? <><button className="primary-button" onClick={enterDualStart}>现在一起开始，时间整体前移</button><button className="confirm-secondary-action" onClick={savePlanForLater}>按原时间保存，稍后开始</button><small>比原计划早 {plannedStartOffset} 分钟；也可以等到 {formatPlanClock(plannedStartLabel, data.planStart, data.planEnd)} 再点亮。</small></> : <><button className="primary-button" onClick={enterDualStart}>两个人一起点亮开始</button><button className="confirm-secondary-action" onClick={savePlanForLater}>先保存，稍后再开始</button><small>刚好到约定时间；下一步只需要两个人各点一下自己的名字。</small></>}</div>
      </div>}

      {screen === "dual-start" && <div className="screen dual-start-screen">
        <Header back={leaveDualStart} backLabel="返回共同确认" title="一起点亮" step="3/3" /><div className="dual-start-hero"><div><span className="eyebrow">可以同时点，也可以轮流点</span><h1>两个人都准备好，<br />就一起开始</h1></div><Mascot mood={bothParticipantsReady ? "celebrate" : "ready"} compact /></div>
        <div className={`start-now-card ${startsAtPlannedTime ? "on-time" : "will-shift"}`}><AppIcon name={dualFirstStage.icon} /><span><small>两个名字都亮起后 · 第一小步</small><strong>{dualFirstStage.title || "从第一小步开始"}</strong><div className="start-contract-meta"><span>{startNowLabel}—{dualFirstEndLabel}</span><span>{dualFirstStage.energy ? `完成后 +${dualFirstStage.energy} 能量` : "这一项不计能量"}</span></div><p>{startsAtPlannedTime ? "先试这一小步；卡住时随时可以调整，不需要硬撑。" : `原时长和间隔都会保留，事项预计 ${formatPlanClock(shiftedScheduleEndLabel, startNowLabel, shiftedAvailabilityEndLabel)} 结束；卡住仍可以调整。`}</p></span></div>
        <div className="light-bridge" data-ready={bothParticipantsReady} />
        <div className="dual-press"><button ref={guardianConfirmRef} aria-describedby="dual-start-status" aria-label={`${data.guardianAlias}${guardianConfirmed ? "已点亮，再点一次取消" : "点一下确认准备"}`} aria-pressed={guardianConfirmed} className={`press-zone guardian-zone ${guardianConfirmed ? "confirmed" : ""}`} onClick={() => toggleParticipant("guardian")}><span className="finger-tip"><small>{data.guardianAlias}</small></span><strong>{data.guardianAlias}</strong><small>{guardianConfirmed ? "✓ 已准备" : "点亮准备"}</small></button><button aria-describedby="dual-start-status" aria-label={`${data.childAlias}${childConfirmed ? "已点亮，再点一次取消" : "点一下确认准备"}`} aria-pressed={childConfirmed} className={`press-zone child-zone ${childConfirmed ? "confirmed" : ""}`} onClick={() => toggleParticipant("child")}><span className="finger-tip"><small>{data.childAlias}</small></span><strong>{data.childAlias}</strong><small>{childConfirmed ? "✓ 已准备" : "点亮准备"}</small></button></div>
        <div className={`launch-status ${bothParticipantsReady ? "is-launching" : ""}`}><div className="launch-status-copy" id="dual-start-status" role="status" aria-live="polite" aria-atomic="true"><strong>{dualStartStatus.title}</strong><small>{dualStartStatus.detail}</small></div>{bothParticipantsReady && <><button ref={launchCancelRef} type="button" className="launch-cancel-button" onClick={cancelDualLaunch}>先等等</button><span className="launch-progress" aria-hidden="true"><i /></span></>}</div>
      </div>}

      {screen === "running" && <div className={`screen running-screen ${stageDue ? "has-due-decision" : ""}`}>
        <Header title="今晚进行中" /><div className="running-hero"><span className="eyebrow">当前阶段 · {activeTonightOrdinal}/{tonightStageCount}</span><Mascot mood={stageDue ? "confirm" : softLanding ? "support" : "breathe"} compact /></div>
        {stageDue && <span className="sr-only" role="status">{activeStage.title}预计到时间了，可以完成、继续或调整。</span>}
        <div className={`active-stage-card ${stageDue ? "is-due" : softLanding ? "is-landing" : ""}`}><AppIcon name={activeStage.icon} /><div><small>计划时间 {formatPlanClock(activeStage.start, data.planStart, data.planEnd)}—{formatPlanClock(activeStage.end, data.planStart, data.planEnd)}</small><h1>{activeStage.title}</h1><span className={`effort-pill effort-${activeStage.effort}`}>{activeStage.kind === "rest" ? "休息放松" : effortCopy[activeStage.effort]}</span><span className={`active-energy ${activeStage.energy ? "" : "is-zero"}`}>{activeStage.energy ? `完成后 +${activeStage.energy} 能量` : "这一项不计能量"}</span></div><div className="stage-timer"><small>{stageDue ? "现在确认下一步" : softLanding ? "还有1分钟，准备收尾" : "距离到点提醒"}</small><strong>{stageDue ? "到时间了" : gentleRemainingLabel(remainingSeconds)}</strong><div role="progressbar" aria-label={`${activeStage.title}剩余时间`} aria-valuemin={0} aria-valuemax={activeStageSeconds} aria-valuenow={Math.min(activeStageSeconds, remainingSeconds)} aria-valuetext={stageDue ? "预计到时间，可以完成、继续或调整" : gentleRemainingLabel(remainingSeconds)}><i style={{ width: `${Math.max(0, Math.min(100, remainingSeconds / activeStageSeconds * 100))}%` }} /></div></div></div>
        {!stageDue && <><div className="running-support-strip"><AppIcon name="privacy" /><span><strong>手机留在大人手里</strong><small>不记录坐姿、声音、人脸或是否一直在桌前</small></span></div>
        <div className={`next-stage-preview ${softLanding ? "is-landing" : ""}`}><span><small>{softLanding ? "下一步先看一眼" : activeStage.kind === "rest" && nextPendingStage ? `休息后继续 · ${nextPendingDuration}分钟` : "这一段之后"}</small><strong>{nextPendingStage ? nextPendingStage.title : "完成今晚计划"}</strong></span>{nextPendingStage && <time>{formatPlanClock(nextPendingStage.start, data.planStart, data.planEnd)}</time>}</div>
        <details className="timeline-disclosure"><summary><span><small>今晚进度 · 事项预计 {formatPlanClock(liveScheduledEnd, data.planStart, data.planEnd)} 结束</small><strong>{completedStageCount}/{tonightStageCount} 个阶段已完成</strong></span><b>查看全部 <i>⌄</i></b></summary><div className="mini-timeline">{stages.map((stage, index) => <div key={stage.id} className={`${stage.status} ${index === activeIndex ? "now" : ""}`}><i /><span>{stage.title}</span><small>{stage.status === "done" ? "完成" : stage.status === "tomorrow" ? "明天" : formatPlanClock(stage.start, data.planStart, data.planEnd)}</small></div>)}</div></details></>}
        <div className={`running-action-dock ${stageDue ? "due-action-dock" : ""}`}>{stageDue ? <><div className="due-choice-copy"><strong>到时间只是提醒，不代表必须完成</strong><small>现在更合适哪一步，就选哪一步</small></div><div className={`due-action-grid ${canStartRest ? "" : "has-three"}`} role="group" aria-label="到点后的选择"><button className="due-choice-button due-complete" onClick={stageFinished}><b aria-hidden="true">✓</b><span><strong>{activeStage.kind === "rest" ? "结束这次休息" : "这一段已完成"}</strong><small>记录并看看下一步</small></span></button><button className="due-choice-button due-continue" onClick={extendCurrent}><b aria-hidden="true">＋</b><span><strong>{canStartRest ? "再继续 10 分钟" : "再休息 10 分钟"}</strong><small>后面时间一起顺延</small></span></button>{canStartRest && <button className="due-choice-button due-rest" onClick={startRestNow}><b aria-hidden="true">～</b><span><strong>先休息 10 分钟</strong><small>休息后再试 10 分钟</small></span></button>}<button className="due-choice-button due-adjust" onClick={openAdjust}><b aria-hidden="true">↗</b><span><strong>调整今晚</strong><small>换顺序、到明天或收尾</small></span></button></div></> : <><button className="primary-button" onClick={stageFinished}>{activeStage.kind === "rest" ? "结束这次休息" : "这一段已经做完"}</button><button className="secondary-button adjust-button" onClick={openAdjust}>调整今晚计划</button></>}</div>
      </div>}

      {screen === "transition" && <div className={`screen transition-screen ${transitionReason}-transition`}>
        <div className="transition-hero"><div><span className="eyebrow">{transitionReason === "completed" ? "这一段完成了" : "阶段提醒 · 只提醒一次"}</span><h1>{transitionReason === "completed" ? `${activeStage.title}告一段落` : `${activeStage.title}预计到时间了`}</h1><p className="lead">{transitionReason === "completed" ? "先看见已经做到的，再决定下一步。" : "不用马上切换，看看现在更适合哪一步。"}</p></div><div className="transition-art"><AppIcon name={transitionReason === "completed" ? "check" : "moon"} /><Mascot mood={transitionReason === "completed" ? "celebrate" : "confirm"} compact /></div></div>
        <div className={`transition-result ${transitionReason === "completed" && !activeStage.energy ? "is-zero" : ""}`}><AppIcon name={activeStage.icon} /><span><small>{transitionReason === "completed" ? "完成已标记" : "当前阶段"}</small><strong>{activeStage.title}</strong><em>{transitionReason === "completed" ? activeStage.energy ? `收尾保存后 +${activeStage.energy} 家庭能量` : "这一项不计能量" : canStartRest ? "完成、继续或休息都可以" : "结束、延长或调整都可以"}</em></span></div>{transitionReason === "completed" && <button className="undo-completion-button" onClick={undoStageFinished}>点错了，回到这一段</button>}
        <div className="transition-next"><span><small>接下来</small><strong>{nextPendingStage ? nextPendingStage.title : "完成今晚计划"}</strong></span>{nextPendingStage && <time>{formatPlanClock(nextPendingStage.start, data.planStart, data.planEnd)}</time>}</div>
        <div className="transition-actions"><button className="primary-button" onClick={continueToNext}>{hasNextPending ? `进入${nextPendingStage?.title ?? "下一阶段"}` : "进入今晚收尾"}</button><div><button className="secondary-button" onClick={extendCurrent}>{canStartRest ? (transitionReason === "completed" ? "还想继续 10 分钟" : "再继续 10 分钟") : "再休息 10 分钟"}</button>{canStartRest && <button className="soft-button" onClick={startRestNow}>先休息 10 分钟</button>}</div><button className="text-button" onClick={openAdjust}>调整今晚计划</button></div>
        <div className="privacy-note">{transitionReason === "completed" ? "不需要赶着完成；按自己的节奏走，也可以停下来调整。" : "只提醒这一次，不会连续催促。"}</div>
      </div>}

      {screen === "adjust" && <div className="screen adjust-screen">
        <Header back={returnFromAdjust} backLabel="返回今晚进行中" title="调整今晚" /><div className="title-with-mascot"><div><span className="eyebrow">计划服务于家庭，而不是反过来</span><h1>现在更适合怎么调整？</h1></div><Mascot mood="support" compact /></div>
        <div className="adjust-grid">{adjustmentOptions.map(({ id, icon, title, copy }) => <button key={id} aria-pressed={effectiveAdjustChoice === id} className={`${effectiveAdjustChoice === id ? "selected" : ""} ${id === "finish" ? "finish-choice" : ""}`} onClick={() => setAdjustChoice(id)}><AppIcon name={icon} /><span><strong>{title}</strong><small>{copy}</small></span></button>)}</div>
        <div className={`adjust-decision-dock ${effectiveAdjustChoice ? "is-ready" : "is-waiting"}`} aria-label="调整预览与确认"><div className={`change-preview ${effectiveAdjustChoice ? "" : "is-waiting"}`} role="status" aria-live="polite" aria-atomic="true"><small>{effectiveAdjustChoice ? "本次调整预览" : "先一起选一种方式"}</small><strong>{effectiveAdjustChoice === "extend" ? `${activeStage.title}${canStartRest ? "延长" : "再休息"}10分钟，事项预计${formatPlanClock(addMinutes(liveScheduledEnd, 10), data.planStart, addMinutes(data.planEnd, 10))}结束` : effectiveAdjustChoice === "rest" ? activeStageCompleted ? `从现在休息10分钟，之后进入${nextPendingStage?.title ?? "今晚收尾"}，事项预计${formatPlanClock(restPreviewScheduledEnd, startNowLabel, restPlanPreview.planEnd)}结束` : stageDue ? `从现在休息10分钟，之后再试${restPlanPreview.resumedMinutes}分钟，事项预计${formatPlanClock(restPreviewScheduledEnd, startNowLabel, restPlanPreview.planEnd)}结束` : `从现在休息10分钟，之后只继续剩余时长，事项预计${formatPlanClock(restPreviewScheduledEnd, startNowLabel, restPlanPreview.planEnd)}结束` : effectiveAdjustChoice === "defer" ? `把“${activeStage.title}”移到明天，接着进入“${nextPendingStage?.title ?? "下一项"}”` : effectiveAdjustChoice === "swap" ? `调换“${nextPendingStage?.title ?? "下一项"}”和“${secondPendingAfterActiveStage?.title ?? "再后一项"}”，时长与空档不变` : effectiveAdjustChoice === "tomorrow" ? pendingAfterActiveCount > 1 ? `把“${nextPendingStage?.title ?? "下一项"}”移到明天，后面事项提前${nextPendingDuration}分钟衔接` : `把“${nextPendingStage?.title ?? "下一项"}”移到明天，这一段结束后即可收尾并保存` : effectiveAdjustChoice === "finish" ? "保留已完成的部分，结束今晚计划" : "选择后先看清变化，再一起确认；现在还不会改动时间表。"}</strong></div><p className="adjust-safety-note">确认前不会改动 · 调整不扣能量 · 已完成进展会保留</p><div className="adjust-dock-actions"><button className="primary-button" disabled={!effectiveAdjustChoice} onClick={applyAdjustment}>{!effectiveAdjustChoice ? "先选择一种调整" : effectiveAdjustChoice === "finish" ? "确认结束今晚" : "一起确认调整"}</button><button className="adjust-cancel-button" onClick={returnFromAdjust}>取消</button></div></div>
      </div>}

      {screen === "wrap" && <div className="screen wrap-screen">
        <Header title="今晚收尾" /><div className="wrap-hero"><div><span className="eyebrow">共同确认 · 30 秒</span><h1>完成今晚计划</h1><p>一起确认完成情况、保存能量，并把记录留在家庭日历。</p></div><Mascot mood="celebrate" compact /></div>
        <div className="wrap-summary"><div><strong>{settlementCompletedTasks}</strong><small>完成事项</small></div><div><strong>{adjustments}</strong><small>主动调整</small></div><div className="energy-total"><strong>+{settlementTotalEnergy}</strong><small>本次新增能量</small></div></div>
        <details className="energy-summary settlement-breakdown"><summary><span><strong>今晚会这样留下</strong><small>能量属于家庭合作，不给孩子单独打分</small></span><b><em>+{settlementTotalEnergy}</em><small>查看组成</small><i aria-hidden="true">⌄</i></b></summary><div className="settlement-breakdown-list"><span><b>完成事项</b><em>+{settlementTaskEnergy}</em></span><span className={settlementCooperationEnergy ? "" : "already-counted"}><b>{settlementCooperationEnergy ? "共同商量与收尾" : "共同收尾 · 本夜已记录"}</b><em>+{settlementCooperationEnergy}</em></span>{adjustments > 0 && <span className={settlementAdjustmentEnergy ? "" : "already-counted"}><b>{settlementAdjustmentEnergy ? "主动调整计划" : "主动调整 · 本夜已记录"}</b><em>+{settlementAdjustmentEnergy}</em></span>}</div></details>
        <fieldset className="prompt-reflection"><legend>给大人记一笔</legend><strong>和往常相比，今晚共同执行顺畅吗？</strong><div>{(["less", "same", "more"] as PromptReflection[]).map(value => <button type="button" key={value} aria-pressed={promptReflection === value} className={promptReflection === value ? "selected" : ""} onClick={() => setPromptReflection(current => current === value ? null : value)}>{({ less: "更顺畅", same: "差不多", more: "更费力" })[value]}</button>)}</div><small>可选，只用于家庭复盘，不影响能量。</small></fieldset>
        <div className="wrap-action-dock"><button className="primary-button" onClick={finishNight}>保存记录并结束今晚</button>{hasDeferredStages && <button className="secondary-button wrap-resume-button" onClick={resumeTonightFromWrap}>还想继续今晚</button>}<small>{promptReflection ? settlementFooter : `执行感受可以不填 · ${settlementFooter}`}</small></div>
      </div>}

      {screen === "night-saved" && lastSavedSession && <div className="screen night-saved-screen">
        <div className="saved-hero"><div><span className="eyebrow">已安全保存在家庭日历</span><h1>今晚，已经<br />好好收尾</h1><p>这不是成绩，也不要求连续打卡。</p></div><Mascot mood="celebrate" compact /></div>
        <div className="saved-energy"><small>本次家庭能量</small><strong>+{lastSavedSession.energyEarned}</strong><span>现在共有 {data.energy} 点</span><div className="energy-rise" aria-hidden="true"><i /><i /><i /></div></div>
        <details className="saved-breakdown"><summary><span><strong>能量组成</strong><small>完成与合作如何记入本次记录</small></span><b>查看 <i aria-hidden="true">⌄</i></b></summary><div><span><b>完成事项</b><em>+{lastSavedSession.taskEnergy}</em></span><span className={lastSavedSession.cooperationEnergy ? "" : "already-counted"}><b>{lastSavedSession.cooperationEnergy ? "共同商量与收尾" : "共同收尾 · 本夜已记录"}</b><em>+{lastSavedSession.cooperationEnergy}</em></span>{lastSavedSession.adjustments > 0 && <span className={lastSavedSession.adjustmentEnergy ? "" : "already-counted"}><b>{lastSavedSession.adjustmentEnergy ? "主动调整计划" : "主动调整 · 本夜已记录"}</b><em>+{lastSavedSession.adjustmentEnergy}</em></span>}</div></details>
        <div className="saved-calendar-note"><AppIcon name="moon" /><span><strong>{familyNightDisplayLabel(lastSavedSession.nightKey, lastSavedSession.date)}</strong><small>{lastSavedSession.completedCount} 个{lastSavedSession.completionUnit === "tasks" ? "完成事项" : "完成节点"}{lastSavedSession.promptReflection ? ` · ${promptReflectionCopy[lastSavedSession.promptReflection]}` : " · 执行感受可下次再记"}</small></span></div>
        <div className="saved-actions"><button className="primary-button" onClick={() => go("home")}>回到首页</button><button className="secondary-button" onClick={() => openNightRecord(lastSavedSession.nightKey)}>查看这一晚的记录</button></div>
      </div>}

      {screen === "energy" && <div className="screen with-nav energy-screen">
        <Header title="家庭能量房间" /><div className="room-scene"><picture className="optimized-picture"><source srcSet={`/assets/optimized/energy-room-v3.webp?v=${ASSET_VERSION}`} type="image/webp" /><img className="room-art" src={`/assets/energy-room-v3.jpg?v=${ASSET_VERSION}`} width="960" height="720" loading="eager" decoding="async" fetchPriority="high" alt="温暖的家庭学习角" /></picture><div className="room-light" /><Mascot mood={goalReady ? "celebrate" : "ready"} /></div>
        <div className="energy-panel"><span className="eyebrow">共同积累，不给孩子打分</span><h1>{data.energy} 点家庭能量</h1>{goalState !== "empty" ? <div className="energy-bar"><i style={{ width: `${Math.min(100, data.energy / data.rewardGoal.threshold * 100)}%` }} /></div> : <p className="energy-fresh-copy">{hasPastReward ? "上一份期待已经留在日历里，这里是新的开始。" : data.energy ? "能量已经在积累；想好家庭时光后再一起约定。" : "先把今晚过舒服，家庭期待可以稍后再一起定。"}</p>}</div>
        {goalState === "empty" ? <div className="empty-goal-card"><AppIcon name="home-heart" /><div><small>{hasPastReward ? "还没有新的家庭期待" : "还没有设置家庭期待"}</small><strong>{data.energy || hasPastReward ? "先想一段真正想一起度过的时光" : "先从一个更舒服的家庭夜晚开始"}</strong><p>不是给孩子定奖品；由大人和孩子一起商量。</p></div></div> : <div className={`goal-card goal-${goalState}`}><AppIcon name={data.rewardGoal.icon} /><div><small>{goalState === "ready" ? "共同积累已经点亮" : `计划在${data.rewardGoal.date}`}</small><strong>{data.rewardGoal.title}</strong><p>{progress ? `还差${progress}点，一起积累，不用赶` : "已经点亮，等真正实现后再记录"}</p></div></div>}
        {goalState === "empty" ? <button className="primary-button" onClick={openRewardSetup}>一起定新的家庭期待</button> : goalState === "building" ? <button className="secondary-button" onClick={openRewardSetup}>一起调整这个期待</button> : <button className="primary-button" onClick={() => openRewardAchieved()}>查看达成与实现</button>}
        <div className="gentle-note">未完成或暂停不会倒扣、过期；一起实现并记录后，下一份期待从0开始。</div>
      </div>}

      {screen === "reward-setup" && <div className="screen reward-setup-screen">
        <Header back={() => back("energy")} backLabel="返回家庭能量房间" title="家庭期待" step="一起商量" />
        <div className="reward-setup-hero"><div><span className="eyebrow">不是奖品清单</span><h1>想一起度过怎样的时光？</h1><p>先选家庭时光，再共同商量积累节奏。</p></div><Mascot mood="support" compact /></div>
        <section className="reward-step"><div className="reward-step-heading"><b>1</b><span><strong>先选想一起做的事</strong><small>优先选择陪伴和共同体验</small></span></div><div className="reward-idea-grid">{REWARD_IDEAS.map(idea => <button type="button" key={idea.label} aria-pressed={rewardDraft.title === idea.title} className={rewardDraft.title === idea.title ? "selected" : ""} onClick={() => reviseRewardDraft({ icon: idea.icon, title: idea.title })}><AppIcon name={idea.icon} /><span><strong>{idea.label}</strong><small>{idea.title}</small></span></button>)}</div><label className="reward-compact-input"><span className="input-label-row"><span>也可以写下你们自己的想法</span><small>{rewardDraft.title.length}/24</small></span><input ref={rewardTitleInputRef} name="reward-title" aria-label="家庭期待" value={rewardDraft.title} placeholder="例如：周末一起去公园" maxLength={24} autoComplete="off" spellCheck={false} enterKeyHint="next" onChange={e => reviseRewardDraft({ title: e.target.value })} onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); rewardDateInputRef.current?.focus(); } }} /></label></section>
        <section className="reward-step"><div className="reward-step-heading"><b>2</b><span><strong>商量什么时候一起实现</strong><small>这是共同约定，不是限时任务</small></span></div><div className="reward-date-chips">{REWARD_DATE_IDEAS.map(date => <button type="button" key={date} aria-pressed={rewardDraft.date === date} className={rewardDraft.date === date ? "selected" : ""} onClick={() => reviseRewardDraft({ date })}>{date}</button>)}</div><label className="reward-compact-input"><span className="input-label-row"><span>或自己写一个时间</span><small>{rewardDraft.date.length}/16</small></span><input ref={rewardDateInputRef} name="reward-date" aria-label="期待实现时间" value={rewardDraft.date} placeholder="例如：下周六下午" maxLength={16} autoComplete="off" spellCheck={false} enterKeyHint="next" onChange={e => reviseRewardDraft({ date: e.target.value })} onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); rewardEnergyConfirmRef.current?.focus(); } }} /></label></section>
        <section className="reward-step energy-step"><div className="reward-step-heading"><b>3</b><span><strong>共同确认积累节奏</strong><small>能量是家庭合作的记号，不是价格</small></span></div><div className="energy-target-row"><button type="button" aria-label="减少5点目标能量" disabled={rewardDraft.threshold <= rewardMinimumThreshold} onClick={() => reviseRewardDraft({ threshold: Math.max(rewardMinimumThreshold, rewardDraft.threshold - 5) })}>−</button><span><strong>{rewardDraft.threshold}</strong><small>点家庭能量</small></span><button type="button" aria-label="增加5点目标能量" disabled={rewardDraft.threshold >= rewardMaximumThreshold} onClick={() => reviseRewardDraft({ threshold: Math.min(rewardMaximumThreshold, rewardDraft.threshold + 5) })}>＋</button></div><input className="energy-target-range branded-range" aria-label="家庭期待目标能量" aria-valuetext={`${rewardDraft.threshold}点家庭能量`} type="range" min={rewardMinimumThreshold} max={rewardMaximumThreshold} step="5" value={rewardDraft.threshold} style={{ "--range-progress": `${(rewardDraft.threshold - rewardMinimumThreshold) / Math.max(1, rewardMaximumThreshold - rewardMinimumThreshold) * 100}%` } as CSSProperties} onChange={e => reviseRewardDraft({ threshold: Number(e.target.value) })} /><p>当前已有 {data.energy} 点。这个数值只帮助理解积累节奏，没有截止时间、不要求连续使用，也不用为了更快达成临时加码。</p><label className="energy-confirm-check"><input ref={rewardEnergyConfirmRef} type="checkbox" checked={rewardEnergyConfirmed} onChange={e => setRewardEnergyConfirmed(e.target.checked)} /><span><strong>{data.guardianAlias}和{data.childAlias}一起看过这个节奏</strong><small>这不是孩子单方面必须完成的目标</small></span></label></section>
        <div className="reward-preview"><AppIcon name={rewardDraft.icon} /><div><small>{rewardDraft.date || "还没定时间"} · {data.guardianAlias}和{data.childAlias}</small><strong>{rewardDraft.title.trim() || "一起写下家庭期待"}</strong><p>积累到约定点数不会自动开始新一轮，实际一起实现并记录后才会。</p></div></div>
        <div className="reward-boundary-note"><AppIcon name="home-heart" /><span><strong>尽量不设置现金、充值或高价商品</strong><small>家庭活动不需要与孩子的表现一一交换。</small></span></div>
        <div className="reward-save-dock"><button className={`primary-button ${rewardDraftReady ? "is-ready" : "needs-input"}`} aria-label={rewardDraftActionLabel} onClick={saveRewardDraft}>{rewardDraftActionLabel}</button><small>{!rewardDraftValid ? "先一起写下想做的事和时间" : !rewardEnergyConfirmed ? "还需要两个人一起确认能量节奏" : "保存后，家庭能量继续从当前数值积累"}</small></div>
      </div>}

      {screen === "reward-achieved" && <div className="screen achievement-screen">
        <Header title="家庭期待" back={keepRewardForLater} backLabel="返回家庭能量房间" />
        <div className="achievement-hero"><div><span className="eyebrow">家庭期待已点亮</span><h1>一起积累到了</h1><p><strong>{data.energy}</strong> 点家庭能量</p></div><Mascot mood="celebrate" compact /></div>
        {rewardReachedFromNight && lastSavedSession && <div className="achievement-night-saved"><AppIcon name="check" /><span><strong>今晚的收尾已经先保存</strong><small>{lastSavedSession.completedCount ? `${lastSavedSession.completedCount} 个${lastSavedSession.completionUnit === "tasks" ? "完成事项" : "完成节点"}` : "完成本次计划"} · +{lastSavedSession.energyEarned} 家庭能量 · 日历可回看</small></span></div>}
        <div className="achievement-scene"><picture className="optimized-picture"><source srcSet={`/assets/optimized/energy-room-v3.webp?v=${ASSET_VERSION}`} type="image/webp" /><img className="achievement-room-art" src={`/assets/energy-room-v3.jpg?v=${ASSET_VERSION}`} width="960" height="720" loading="eager" decoding="async" fetchPriority="high" alt="点亮的家庭房间" /></picture><span className="achievement-glow" /><AppIcon name={data.rewardGoal.icon} /></div>
        <div className="achievement-card"><AppIcon name={data.rewardGoal.icon} /><div><small>计划在{data.rewardGoal.date}</small><strong>{data.rewardGoal.title}</strong><p>{data.guardianAlias}和{data.childAlias}一起参与</p></div></div>
        <div className="achievement-boundary"><AppIcon name="home-heart" /><p><strong>积累到约定点数，不等于已经实现</strong><span>这是一起期待的家庭时光，不是孩子完成任务后必须获得的奖品。</span></p></div>
        {!redeemArmed ? <div className="achievement-actions"><button ref={rewardRedeemTriggerRef} className="primary-button" onClick={() => setRedeemArmed(true)}>已经一起实现了</button><button className="secondary-button" onClick={keepRewardForLater}>先保留能量，等实际实现</button></div> : <div className="redeem-confirm" role="alert"><strong>确认已经一起实现？</strong><p>“{data.rewardGoal.title}”会保存在今天的家庭日历。当前 {data.energy} 点会完成这一轮积累；记录保存后，下一份期待从0开始。</p><button className="primary-button" onClick={redeemReward}>确认已实现，开启新一轮</button><button ref={rewardRedeemCancelRef} className="text-button" onClick={cancelRedeemConfirmation}>返回再看看</button></div>}
      </div>}

      {screen === "reward-saved" && lastRedeemedReward && <div className="screen reward-saved-screen">
        <div className="reward-saved-hero"><div><span className="eyebrow">已安全保存在家庭日历</span><h1>这份期待，<br />已经实现</h1><p>下一轮从0开始，过去的家庭时光仍然留在这里。</p></div><Mascot mood="celebrate" compact /></div>
        <div className="reward-saved-card"><AppIcon name={lastRedeemedReward.icon} /><div><small>{new Date(lastRedeemedReward.redeemedAt).toLocaleDateString("zh-CN", { month: "long", day: "numeric" })} · 已实现</small><strong>{lastRedeemedReward.title}</strong><p>共同约定 {lastRedeemedReward.threshold} 点 · 这一轮积累到 {lastRedeemedReward.energyBeforeReset} 点</p></div></div>
        <div className="reset-story" aria-label="能量重新开始"><span><b>{lastRedeemedReward.energyBeforeReset}</b><small>实现前</small></span><i>→</i><span className="fresh-zero"><b>0</b><small>新的开始</small></span></div>
        {rewardRedeemUndo && rewardRedeemUndo.rewardId === lastRedeemedReward.id && <div className="reward-undo-panel" role="status"><div><strong>刚才点错了也没关系</strong><span>30秒内可以恢复原来的家庭期待和 {rewardRedeemUndo.energy} 点能量。</span></div><button onClick={undoRedeemReward}>恢复这一轮</button></div>}
        <div className="reward-saved-note"><AppIcon name="moon" /><p><strong>记录留在日历里</strong><span>以后可以一起回看，不需要连续打卡。</span></p></div>
        <div className="saved-actions"><button className="primary-button" onClick={openRewardSetup}>设置新的家庭期待</button><button className="secondary-button" onClick={() => openNightRecord(localDateKey(lastRedeemedReward.redeemedAt))}>查看今天的记录</button></div>
      </div>}

      {screen === "review" && <div className="screen with-nav review-screen">
        <Header title="家庭日历" /><span className="eyebrow">有记录的夜晚和已实现的期待会留在这里</span><div className="review-insight"><AppIcon name="quiet" /><div><small>本周执行复盘</small><strong>{weeklyLessPromptNights ? `有${weeklyLessPromptNights}晚，共同执行更顺畅` : weeklyReflections.length ? `已记录${weeklyReflections.length}晚执行感受` : weeklyNights ? "收尾时可以记录共同执行感受" : "先完成一晚真实计划"}</strong><p>{weeklyAdjustments ? `你们主动调整了${weeklyAdjustments}次，调整也是执行计划的一部分。` : weeklyNights ? "这里关注开始、完成和调整是否顺畅。" : "有记录后再复盘，不要求连续使用。"}</p></div></div><div className="month-nav"><button onClick={() => shiftMonth(-1)} aria-label="上个月">‹</button><h1>{calendarYear}年{calendarMonth + 1}月</h1><button onClick={() => shiftMonth(1)} aria-label="下个月">›</button></div>
        <div className="calendar-meta"><div className="calendar-legend"><span><i className="session-dot" />晚间记录</span><span><i className="reward-star">★</i>期待实现</span></div>{showTodayJump && <button className="today-jump" onClick={jumpToToday}>回到今天</button>}</div>
          <div className="calendar-card"><div className="weekdays">{["日","一","二","三","四","五","六"].map(day => <b key={day}>{day}</b>)}</div><div className="calendar-grid">{Array.from({length:firstWeekday}).map((_,i) => <span className="blank-day" key={`blank-${i}`} />)}{Array.from({length:daysInMonth}).map((_,i) => { const day=i+1; const date=new Date(calendarYear,calendarMonth,day); const key=localDateKey(date); const hasSession=data.sessions.some(item => item.nightKey===key); const hasReward=data.rewardHistory.some(item => localDateKey(item.redeemedAt)===key); const isToday=key===todayKey; return <button aria-pressed={selectedDay === key} aria-current={isToday ? "date" : undefined} aria-controls="calendar-day-detail" aria-label={`${calendarMonth + 1}月${day}日${isToday ? "，今天" : ""}${hasSession ? "，有晚间记录" : ""}${hasReward ? "，有期待实现" : ""}`} key={key} className={`${selectedDay===key ? "selected" : ""} ${isToday ? "is-today" : ""} ${hasSession ? "has-session" : ""} ${hasReward ? "has-reward" : ""}`} onClick={() => selectCalendarDay(key)}><strong>{day}</strong><span>{hasSession && <i />} {hasReward && <b>★</b>}</span></button>; })}</div></div>
        <div id="calendar-day-detail" ref={calendarDetailRef} key={selectedDay} className="day-detail">
          <div className="day-detail-header" role="status" aria-live="polite" aria-atomic="true"><div><small>{selectedIncludesAfterMidnightSession ? "晚间记录 · 凌晨收尾仍归这一晚" : "家庭夜晚"}</small><strong>{selectedDateLabel}</strong></div>{selectedSessionSummary && <span>{selectedSessionSummary.settlements} 次收尾</span>}</div>
          {!selectedSessions.length && !selectedRewards.length ? <div className="empty-day"><Mascot mood="breathe" compact /><span><strong>这一天没有留下记录</strong><small>也没关系，日历不要求每天使用。</small></span></div> : <>
            {selectedSessionSummary && <section className="daily-summary"><div className="daily-summary-title"><AppIcon name="moon" /><div><strong>{selectedSessionSummary.settlements > 1 ? `这一晚分${selectedSessionSummary.settlements}次留下记录` : selectedSessionSummary.completed ? `这一晚完成了${selectedSessionSummary.completed}个${selectedSessionSummary.completionUnit === "tasks" ? "事项" : "节点"}` : "这一晚完成了收尾"}</strong><small>先看整体，不用逐条比较每一次。</small></div></div><div className="daily-summary-stats"><span><b>{selectedSessionSummary.completed}</b><small>{selectedSessionSummary.completionUnit === "tasks" ? "完成事项" : "完成节点"}</small></span><span><b>{selectedSessionSummary.adjustments}</b><small>主动调整</small></span><span><b>+{selectedSessionSummary.energy}</b><small>家庭能量</small></span></div><div className="daily-summary-note"><strong>{selectedSessionSummary.reflection ? promptReflectionCopy[selectedSessionSummary.reflection] : "执行感受还没有记录"}</strong><span>{selectedSessionSummary.stageTitles.length ? `这一晚做过：${selectedSessionSummary.stageTitles.join("、")}${selectedSessionSummary.hiddenStageTitleCount ? `，另有 ${selectedSessionSummary.hiddenStageTitleCount} 项` : ""}` : "没有完成事项也可以收尾；记录不会评价孩子。"}</span></div></section>}
            {selectedRewards.map(item => <div className="history-row reward-history reward-highlight" key={item.id}><AppIcon name={item.icon} /><div><small>共同期待已经实现</small><strong>{item.title}</strong><p>共同约定 {item.threshold} 点 · 这一轮积累到 {item.energyBeforeReset} 点</p></div></div>)}
            {selectedSessions.length > 0 && <button className="day-details-toggle" aria-expanded={dayDetailsExpanded} aria-controls="day-session-details" onClick={() => { setSessionDeleteArmedId(""); setDayDetailsExpanded(value => !value); }}><span>{dayDetailsExpanded ? "收起单次明细" : `查看${selectedSessions.length}次收尾明细`}</span><b>{dayDetailsExpanded ? "⌃" : "⌄"}</b></button>}
            {dayDetailsExpanded && <div id="day-session-details" className="day-session-details">{selectedSessions.map(item => <div className="history-row" key={item.id}><AppIcon name="check" /><div><strong>{sessionTimeLabel(item.date)} · {item.completedCount ? `完成${item.completedCount}个${item.completionUnit === "tasks" ? "事项" : "节点"}` : "完成本次计划"}</strong><small>家庭能量 +{item.energyEarned}{item.promptReflection ? ` · ${promptReflectionCopy[item.promptReflection]}` : ""}</small><div className="history-energy"><span>事项 +{item.taskEnergy}</span><span>合作 +{item.cooperationEnergy}</span>{item.adjustmentEnergy > 0 && <span>调整 +{item.adjustmentEnergy}</span>}</div><p>{item.stageTitles.join("、") || "未完成事项已留到明天"}</p>{sessionDeleteArmedId === item.id ? <div className="record-delete-confirm" role="alert"><p>{hasRewardResetAfter(item) ? "这条记录早于一次已实现的期待。只从日历移除，不改动当前这轮能量。" : "删除后会同步调整当前家庭能量；同一晚仍会保留一次合作奖励。"}</p><div><button ref={sessionDeleteCancelRef} onClick={() => cancelSessionDelete(item.id)}>保留记录</button><button className="confirm" aria-label={`确认删除${sessionTimeLabel(item.date)}的收尾记录`} onClick={() => deleteSessionRecord(item)}>确认删除</button></div></div> : <button className="record-delete-button" data-session-delete-id={item.id} aria-label={`删除${sessionTimeLabel(item.date)}的收尾记录`} onClick={() => setSessionDeleteArmedId(item.id)}>删除这次记录</button>}</div></div>)}</div>}
          </>}
        </div>
        {metrics && <div className="metric-grid compact-metrics"><div><AppIcon name="moon" /><small>本月记录</small><strong>{metrics.nights}晚</strong></div><div><AppIcon name="speech" /><small>主动调整</small><strong>{metrics.adjustments}次</strong></div><div><AppIcon name="quiet" /><small>顺畅反馈</small><strong>{metrics.lessPromptNights}晚</strong></div></div>}
        <section className="one-change-card"><div className="one-change-heading"><span><AppIcon name={reviewSuggestion.icon} /></span><div><small>{weeklyNights ? "规则建议 · 不评价孩子" : "第一次可以从这里开始"}</small><h2>{weeklyNights ? "接下来只试一个小变化" : "先留下一晚真实感受"}</h2></div></div><strong className="one-change-text">{reviewSuggestion.text}</strong><p>{reviewSuggestion.evidence}</p><div className="rule-transparency"><b>{weeklyNights ? "建议怎么来的" : "为什么这样建议"}</b><span>{weeklyNights ? "只使用本周完成、主动调整和大人的执行感受记录；不分析孩子身份或能力。" : "还没有本周记录，所以先从一份最短共同计划开始；不会分析孩子身份或能力。"}</span></div><button aria-pressed={currentWeekFocus?.text === reviewSuggestion.text} className={currentWeekFocus?.text === reviewSuggestion.text ? "saved" : ""} onClick={toggleWeeklyFocus}>{currentWeekFocus?.text === reviewSuggestion.text ? "已放到首页 · 点击移除" : weeklyNights ? "这周就试这一件" : "把这个起点放到首页"}</button></section>
      </div>}

      {screen === "settings" && <div className="screen with-nav settings-screen">
        <Header title="设置" /><div className="settings-group"><h2>家庭称呼</h2><div className="setting-row"><span>孩子化名</span><strong>{data.childAlias}</strong></div><div className="setting-row"><span>大人称呼</span><strong>{data.guardianAlias}</strong></div><button className="setting-action" onClick={() => openProfile("settings")}>修改家庭称呼 <span>›</span></button></div>
        <div className="settings-group"><h2>提醒与动效</h2><label className="toggle-row"><span><strong>阶段提示音</strong><small>轻触确认、阶段转换和收尾各有短音型</small></span><input type="checkbox" checked={data.sound} onChange={e => persist({ ...data, sound: e.target.checked })} /></label><label className="toggle-row reminder-toggle"><span><strong>切到其他应用或锁屏时尝试提醒</strong><small>由家长主动授权，每个阶段提醒一次</small></span><input type="checkbox" checked={backgroundReminder && notificationPermission === "granted"} disabled={notificationPermission === "unsupported" || requestingNotificationPermission} aria-busy={requestingNotificationPermission || undefined} aria-describedby="background-reminder-status" onChange={e => void changeBackgroundReminder(e.target.checked)} /></label><div id="background-reminder-status" className={`permission-note permission-${requestingNotificationPermission ? "pending" : notificationPermission}`} role="status" aria-live="polite"><AppIcon name={notificationPermission === "granted" && backgroundReminder ? "check" : "alarm"} /><span><strong>{requestingNotificationPermission ? "正在等待浏览器授权" : notificationPermission === "granted" && backgroundReminder ? "后台提醒已开启" : "后台提醒说明"}</strong><small>{backgroundReminderStatus}</small></span></div><label className="toggle-row"><span><strong>减少动态与触感</strong><small id="motion-preference-status">{motionPreferenceStatus}</small></span><input type="checkbox" checked={data.reducedMotion} aria-describedby="motion-preference-status" onChange={e => persist({ ...data, reducedMotion: e.target.checked })} /></label></div>
        <div className="settings-group"><h2>隐私与数据</h2><div className="setting-row"><span>未收集年级和学校</span><strong>已启用</strong></div><div className="setting-row"><span>数据状态</span><strong>{syncLabel}</strong></div>{pendingCloudDeletion && <div className="pending-delete-note" role="status"><AppIcon name="alarm" /><span><strong>云端副本等待清理</strong><small>只暂存随机家庭令牌；联网后自动重试，不包含孩子资料。</small></span></div>}<button className="setting-action" onClick={() => openPrivacy("settings")}>查看隐私与数据说明 <span>›</span></button><button className="setting-action" onClick={exportData}>导出家庭数据 <span>›</span></button><button className="setting-action danger" disabled={deletingData} onClick={requestDeleteData}>{deletingData ? "正在删除本机与云端数据…" : "删除全部家庭数据"} <span>{deletingData ? "" : "›"}</span></button></div>
        <button className="risk-entry" onClick={() => go("risk")}><AppIcon name="privacy" /><div><strong>有些情况，需要更多支持</strong><small>查看风险提示与转介建议</small></div><span>›</span></button>
      </div>}

      {screen === "risk" && <div className="screen risk-screen">
        <Header back={() => back("settings")} backLabel="返回设置页" />
        <span className="eyebrow">风险边界</span><h1>有些情况，需要更多支持</h1><p className="lead">这个工具不做诊断，也不能替代专业评估。</p>
        <div className="risk-list"><div><AppIcon name="home-heart" /><strong>困难长期存在于家庭和学校多个场景</strong></div><div><AppIcon name="moon" /><strong>持续拒学或明显躯体不适</strong></div><div><AppIcon name="privacy" /><strong>严重情绪变化或自伤表达</strong></div></div>
        <section className="next-actions" aria-labelledby="next-actions-title"><h2 id="next-actions-title">接下来可以</h2><ol className="next-action-list"><li><b aria-hidden="true">1</b><span><strong>先暂停流程，陪孩子稳定下来</strong><small>不追问、不比较；先处理休息、饮水和当下感受。</small></span></li><li><b aria-hidden="true">2</b><span><strong>记录事实，再和了解孩子的老师沟通</strong><small>只记发生时间、场景、持续多久和已经尝试过什么。</small></span></li><li><b aria-hidden="true">3</b><span><strong>需要时咨询正规医疗机构</strong><small>可从儿童保健科、发育行为儿科、儿科或精神心理相关门诊了解下一步。</small></span></li></ol></section>
        <div className="support-line"><AppIcon name="speech" /><span><strong>需要心理支持时</strong><small>全国统一心理援助热线；它不替代急救服务。</small></span><a className="support-call" href="tel:12356" aria-label="拨打全国统一心理援助热线 12356"><small>心理援助热线</small><strong>拨打 12356</strong></a></div>
        <div className="urgent-note"><strong>存在立即安全风险时</strong><p>请优先联系当地急救或警方，并让可信任的成年人陪在孩子身边。</p></div>
      </div>}

      {(["home", "review", "energy", "settings"] as Screen[]).includes(screen) && <BottomNav screen={screen} go={go} openCalendar={() => openCalendar(currentFamilyNightKey)} />}
      {stageAdvanceUndo && <div className="undo-toast live-undo-toast" role="status"><span>已进入“{stageAdvanceUndo.nextTitle}”</span><button onClick={undoContinueToNext}>撤销</button></div>}
      {deletedStage && <div className="undo-toast" role="status"><span>已移除“{deletedStage.stage.title.trim() || "未命名事项"}”</span><button onClick={undoRemoveStage}>撤销</button></div>}
      {shiftedPlanUndo && <div className="undo-toast" role="status"><span>{shiftedPlanUndo.message}</span><button onClick={undoPlanShift}>撤销</button></div>}
      {clearedPlanUndo && <div className="undo-toast" role="status"><span>已清空 {clearedPlanUndo.stages.length} 个时间节点</span><button aria-label="恢复刚才清空的整晚计划" onClick={undoClearPlan}>恢复</button></div>}
      {sessionDeleteUndo && <div className="undo-toast" role="status"><span>{sessionDeleteUndo.message}</span><button ref={sessionDeleteUndoRef} aria-label={`撤销删除${sessionDeleteUndo.label}的收尾记录`} onClick={undoDeleteSessionRecord}>撤销</button></div>}
      {toast && <div className="toast" role="status" aria-live="polite" aria-atomic="true">{toast}</div>}
    </section>
    {deleteArmed && <div className="destructive-dialog-backdrop"><section className="destructive-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-dialog-title" aria-describedby="delete-dialog-description"><span className="destructive-dialog-icon"><AppIcon name="privacy" /></span><small>不可撤销的操作</small><h2 id="delete-dialog-title">删除这个家庭的全部数据？</h2><p id="delete-dialog-description">将清除家庭化名、今晚计划、日历记录、能量和期待；本机立即删除，云端副本会同步清理。</p><div className="destructive-dialog-actions"><button ref={deleteCancelRef} className="secondary-button" disabled={deletingData} onClick={cancelDeleteData}>取消，保留数据</button><button ref={deleteConfirmRef} className="danger-confirm-button" disabled={deletingData} onClick={() => void deleteData()}>{deletingData ? "正在删除…" : "确认永久删除"}</button></div></section></div>}
    <aside className="desktop-note" aria-hidden={deleteArmed || undefined} inert={deleteArmed || undefined}><span className="brand-mark"><AppIcon name="home-heart" /><strong>先开始</strong></span><h2>今晚的事，一起定下来，按时开始。</h2><p>共同排时间、双人确认、到点提醒；计划变化时，随时调整。</p><div className="desktop-points"><span>共同商量</span><span>到点提醒</span><span>一起完成</span></div></aside>
  </main>;
}
