"use client";
/* eslint-disable @next/next/no-img-element */

import type { CSSProperties } from "react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ASSET_VERSION } from "./asset-version";
import { addMinutes, analyzePlan, canInsertRestBreak, clockDeltaMinutes, clockTimeFromDate, durationMinutes, formatPlanClock, insertRestBreak, prepareNextRoundPlan, reflowTimedItemsFrom, remainingTimerMinutes, shiftFollowingForEndChange, shiftTimedItemsFrom, shiftTimedPlanToStart, spansMidnight } from "./plan-utils";
import { ReminderPermission, shouldUseBackgroundReminder } from "./reminder-utils";
import { resolveHistoryTarget } from "./navigation-utils";
import { rewardThresholdBounds } from "./reward-utils";
import { suggestWeeklyFocus } from "./review-utils";
import { calculateNightBonus, familyNightKey, isLiveSessionFresh, liveNightLabel } from "./session-utils";
import { compareSyncSnapshots, mergeUniqueById, PendingWrites } from "./sync-utils";
import { cleanShortText } from "./text-utils";

type Effort = 1 | 2 | 3;
type StageStatus = "pending" | "active" | "done" | "tomorrow";
type PlanningMode = "adult" | "together" | "child";
type PromptReflection = "less" | "same" | "more";
type TransitionReason = "completed" | "due";
type AdjustmentChoice = "extend" | "rest" | "swap" | "tomorrow" | "finish";
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
  adjustments: number;
  taskEnergy: number;
  cooperationEnergy: number;
  adjustmentEnergy: number;
  energyEarned: number;
  stageTitles: string[];
  promptReflection: PromptReflection | null;
};

type RewardHistory = { id: string; title: string; icon: "game" | "book" | "move"; threshold: number; energyBeforeReset: number; redeemedAt: string };
type WeeklyFocus = { weekKey: string; text: string; createdAt: string };
type PlanDraft = { updatedAt: string; planStart: string; planEnd: string; stages: Stage[] };
type LiveSessionDraft = { startedAt: string; updatedAt: string; screen: LiveScreen; planStart: string; planEnd: string; stages: Stage[]; activeIndex: number; adjustments: number; activeEndsAt: number; stageDue: boolean; promptReflection: PromptReflection | null; transitionReason: TransitionReason };

type AppData = {
  consent: boolean;
  childAlias: string;
  guardianAlias: string;
  planningMode: PlanningMode;
  arrival: string;
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
const DUAL_START_DELAY_MS = 2400;

const DEFAULT_DATA: AppData = {
  consent: false,
  childAlias: "小橙",
  guardianAlias: "妈妈",
  planningMode: "together",
  arrival: "17:30",
  planStart: "18:10",
  planEnd: "20:30",
  energy: 0,
  sound: true,
  reducedMotion: false,
  rewardGoal: { threshold: 30, title: "周末一起玩桌游", icon: "game", date: "周六", participants: ["妈妈", "小橙"], redeemed: false, acknowledged: false },
  rewardHistory: [],
  sessions: [],
  weeklyFocus: null,
};

const DEFAULT_STAGES: Stage[] = [
  { id: "snack", title: "吃点东西", icon: "snack", start: "18:10", end: "18:30", effort: 1, energy: 1, status: "pending", kind: "rest" },
  { id: "math", title: "数学练习", icon: "chart", start: "18:30", end: "19:00", effort: 2, energy: 3, status: "pending", kind: "task" },
  { id: "move", title: "活动一下", icon: "move", start: "19:00", end: "19:10", effort: 1, energy: 1, status: "pending", kind: "rest" },
  { id: "reading", title: "阅读", icon: "book", start: "19:10", end: "19:35", effort: 1, energy: 2, status: "pending", kind: "task" },
  { id: "bag", title: "整理书包", icon: "backpack", start: "19:35", end: "19:45", effort: 1, energy: 1, status: "pending", kind: "task" },
];

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
  if (!Array.isArray(value)) return preserveStatus ? [] : DEFAULT_STAGES;
  const allowedIcons = new Set<string>(ICON_LIBRARY.map(([icon]) => icon));
  const legacyRestIcons = new Set(["snack", "dinner", "move", "walk", "eye-rest", "quiet", "free-play", "shower", "teeth", "bedtime"]);
  return value.slice(0, 20).flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Partial<Stage>;
    const effort: Effort = item.effort === 2 || item.effort === 3 ? item.effort : 1;
    const energy = Math.max(1, Math.min(5, Math.round(Number(item.energy) || 1)));
    const start = /^\d{2}:\d{2}$/.test(String(item.start)) ? String(item.start) : addMinutes("18:10", index * 20);
    const end = /^\d{2}:\d{2}$/.test(String(item.end)) ? String(item.end) : addMinutes(start, 20);
    const icon = allowedIcons.has(String(item.icon)) ? String(item.icon) : "custom";
    const kind = item.kind === "rest" || (!item.kind && legacyRestIcons.has(icon)) ? "rest" : "task";
    return [{
      id: String(item.id || createId("stage")), title: cleanShortText(String(item.title ?? "新事项"), 24),
      icon, start, end, effort, energy, kind,
      status: preserveStatus && (item.status === "active" || item.status === "done" || item.status === "tomorrow") ? item.status : "pending" as const,
    }];
  });
}

function createId(prefix: string) {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `${prefix}-${suffix}`;
}

function localDateKey(date: string | Date) {
  return new Date(date).toLocaleDateString("en-CA");
}

function summarizeSessions(items: SessionRecord[]) {
  if (!items.length) return null;
  return {
    settlements: items.length,
    completed: items.reduce((sum, item) => sum + item.completedCount, 0),
    adjustments: items.reduce((sum, item) => sum + item.adjustments, 0),
    energy: items.reduce((sum, item) => sum + item.energyEarned, 0),
    reflection: items.find(item => item.promptReflection)?.promptReflection ?? null,
    stageTitles: Array.from(new Set(items.flatMap(item => item.stageTitles))).slice(0, 6),
  };
}

function normalizePromptReflection(value: unknown): PromptReflection | null {
  return value === "less" || value === "same" || value === "more" ? value : null;
}

function normalizeTransitionReason(value: unknown, wasDue = false): TransitionReason {
  return value === "completed" || value === "due" ? value : wasDue ? "due" : "completed";
}

function formatCountdown(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function subscribeToNetworkStatus(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => { window.removeEventListener("online", onChange); window.removeEventListener("offline", onChange); };
}

function useOnlineStatus() {
  return useSyncExternalStore(subscribeToNetworkStatus, () => navigator.onLine, () => true);
}

async function retryPendingCloudDeletion() {
  const pendingFamilyId = localStorage.getItem(PENDING_DELETE_KEY) || "";
  if (!pendingFamilyId) return true;
  try {
    const response = await fetch(`/api/state?familyId=${encodeURIComponent(pendingFamilyId)}`, { method: "DELETE" });
    const result = await response.json();
    if (response.ok && result.ok && !result.localOnly) {
      localStorage.removeItem(PENDING_DELETE_KEY);
      return true;
    }
  } catch { /* retry after the browser reports that the network is back */ }
  return false;
}

function AppIcon({ name, className = "", loading = "eager" }: { name: string; className?: string; loading?: "eager" | "lazy" }) {
  return <img className={`app-icon ${className}`} src={`/assets/icons/${name}.png?v=${ASSET_VERSION}`} width="256" height="256" loading={loading} decoding="async" alt="" aria-hidden="true" />;
}

function Mascot({ mood = "ready", compact = false }: { mood?: "ready" | "confirm" | "breathe" | "support" | "celebrate"; compact?: boolean }) {
  return <div className={`mascot mascot-${mood} ${compact ? "mascot-compact" : ""}`} aria-hidden="true">
    <div className="mascot-halo" />
    <img className="mascot-pose" src={`/assets/mascot/${mood}.png?v=${ASSET_VERSION}`} width="640" height="640" decoding="async" alt="" />
    {mood === "ready" && <img className="mascot-pose mascot-blink-frame" src={`/assets/mascot/blink.png?v=${ASSET_VERSION}`} width="640" height="640" loading="lazy" decoding="async" fetchPriority="low" alt="" />}
    {mood === "celebrate" && <><i className="mascot-spark spark-one" /><i className="mascot-spark spark-two" /><i className="mascot-spark spark-three" /></>}
  </div>;
}

function Header({ title, back, step }: { title?: string; back?: () => void; step?: string }) {
  return <header className="app-header">
    {back ? <button className="icon-button" onClick={back} aria-label="返回">‹</button> : <span className="header-spacer" />}
    <strong data-screen-heading={title ? "true" : undefined} tabIndex={title ? -1 : undefined}>{title}</strong>
    {step ? <span className="step-pill">{step}</span> : <span className="header-spacer" />}
  </header>;
}

function BottomNav({ screen, go }: { screen: Screen; go: (screen: Screen) => void }) {
  const items: Array<[Screen, string, string]> = [["home", "home-heart", "首页"], ["review", "chart", "日历"], ["energy", "plant", "能量"], ["settings", "privacy", "设置"]];
  return <nav className="bottom-nav" aria-label="主导航">{items.map(([id, icon, label]) => <button key={id} aria-current={screen === id ? "page" : undefined} className={screen === id ? "active" : ""} onClick={() => go(id)}><AppIcon name={icon} /><small>{label}</small></button>)}</nav>;
}

function normalizeData(value: unknown): AppData {
  if (!value || typeof value !== "object") return DEFAULT_DATA;
  const old = value as Record<string, unknown>;
  const childAlias = String(old.childAlias ?? old.alias ?? DEFAULT_DATA.childAlias).slice(0, 12);
  const guardianAlias = String(old.guardianAlias ?? DEFAULT_DATA.guardianAlias).slice(0, 12);
  const goal = old.rewardGoal && typeof old.rewardGoal === "object" ? old.rewardGoal as Partial<RewardGoal> : DEFAULT_DATA.rewardGoal;
  const goalRedeemed = Boolean(goal.redeemed);
  const goalIcon: RewardGoal["icon"] = goal.icon === "book" || goal.icon === "move" || goal.icon === "game" ? goal.icon : String(goal.title).includes("故事") ? "book" : String(goal.title).includes("散步") ? "move" : "game";
  const goalThreshold = Math.max(10, Math.min(100, Math.round(Number(goal.threshold) || DEFAULT_DATA.rewardGoal.threshold)));
  const sessions = Array.isArray(old.sessions) ? old.sessions.map((item, index) => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const legacyTasks = Array.isArray(record.tasks) ? record.tasks.length : 0;
    const date = String(record.date ?? new Date().toISOString());
    const storedNightKey = String(record.nightKey ?? "");
    return {
      id: String(record.id ?? `legacy-${index}`), date, nightKey: /^\d{4}-\d{2}-\d{2}$/.test(storedNightKey) ? storedNightKey : familyNightKey(date),
      stageCount: Number(record.stageCount ?? legacyTasks), completedCount: Number(record.completedCount ?? legacyTasks),
      adjustments: Number(record.adjustments ?? 0),
      taskEnergy: Number(record.taskEnergy ?? record.childEnergy ?? 0), cooperationEnergy: Number(record.cooperationEnergy ?? record.guardianEnergy ?? record.parentEnergy ?? 0),
      adjustmentEnergy: Number(record.adjustmentEnergy ?? Math.max(0, Number(record.energyEarned ?? 0) - Number(record.taskEnergy ?? record.childEnergy ?? 0) - Number(record.cooperationEnergy ?? record.guardianEnergy ?? record.parentEnergy ?? 0))),
      energyEarned: Number(record.energyEarned ?? (Number(record.taskEnergy ?? record.childEnergy ?? 0) + Number(record.cooperationEnergy ?? record.guardianEnergy ?? record.parentEnergy ?? 0))),
      stageTitles: Array.isArray(record.stageTitles) ? record.stageTitles.map(item => cleanShortText(String(item), 24)) : Array.isArray(record.tasks) ? record.tasks.map(item => cleanShortText(String(item), 24)) : [],
      promptReflection: normalizePromptReflection(record.promptReflection),
    } satisfies SessionRecord;
  }) : [];
  const focus = old.weeklyFocus && typeof old.weeklyFocus === "object" ? old.weeklyFocus as Partial<WeeklyFocus> : null;
  return {
    consent: Boolean(old.consent ?? DEFAULT_DATA.consent), childAlias, guardianAlias,
    planningMode: old.planningMode === "adult" || old.planningMode === "child" || old.planningMode === "together" ? old.planningMode : DEFAULT_DATA.planningMode,
    arrival: String(old.arrival ?? DEFAULT_DATA.arrival), planStart: String(old.planStart ?? DEFAULT_DATA.planStart), planEnd: String(old.planEnd ?? DEFAULT_DATA.planEnd), energy: Math.max(0, Number(old.energy ?? DEFAULT_DATA.energy) || 0),
    sound: typeof old.sound === "boolean" ? old.sound : DEFAULT_DATA.sound,
    reducedMotion: typeof old.reducedMotion === "boolean" ? old.reducedMotion : DEFAULT_DATA.reducedMotion,
    rewardGoal: { ...DEFAULT_DATA.rewardGoal, ...goal, threshold: goalThreshold, icon: goalIcon, title: goalRedeemed ? "" : String(goal.title || DEFAULT_DATA.rewardGoal.title).slice(0, 24), date: String(goal.date || DEFAULT_DATA.rewardGoal.date).slice(0, 16), participants: [guardianAlias, childAlias], redeemed: goalRedeemed, acknowledged: Boolean(goal.acknowledged) },
    rewardHistory: Array.isArray(old.rewardHistory) ? old.rewardHistory.flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Partial<RewardHistory>;
      const icon: RewardHistory["icon"] = record.icon === "book" || record.icon === "move" || record.icon === "game" ? record.icon : "game";
      const threshold = Math.max(0, Number(record.threshold) || 0);
      return [{ id: String(record.id || `reward-${index}`), title: String(record.title || "家庭期待").slice(0, 24), icon, threshold, energyBeforeReset: Math.max(threshold, Number(record.energyBeforeReset) || threshold), redeemedAt: String(record.redeemedAt || new Date().toISOString()) }];
    }) : [], sessions,
    weeklyFocus: focus && /^\d{4}-\d{2}-\d{2}$/.test(String(focus.weekKey)) && String(focus.text).trim() ? { weekKey: String(focus.weekKey), text: String(focus.text).slice(0, 80), createdAt: String(focus.createdAt || new Date().toISOString()) } : null,
  };
}

function mergeFamilyData(preferred: AppData, other: AppData): AppData {
  return {
    ...other,
    ...preferred,
    sessions: mergeUniqueById(preferred.sessions, other.sessions),
    rewardHistory: mergeUniqueById(preferred.rewardHistory, other.rewardHistory),
  };
}

export function StartApp() {
  const [data, setData] = useState(DEFAULT_DATA);
  const [appReady, setAppReady] = useState(false);
  const [familyId, setFamilyId] = useState("");
  const [screen, setScreen] = useState<Screen>("welcome");
  const [consent, setConsent] = useState(false);
  const [stages, setStages] = useState<Stage[]>(DEFAULT_STAGES);
  const [editingStageId, setEditingStageId] = useState("");
  const [showAllIcons, setShowAllIcons] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [adjustments, setAdjustments] = useState(0);
  const [adjustChoice, setAdjustChoice] = useState<AdjustmentChoice>("extend");
  const [guardianConfirmed, setGuardianConfirmed] = useState(false);
  const [childConfirmed, setChildConfirmed] = useState(false);
  const [selectedDay, setSelectedDay] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [calendarCursor, setCalendarCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [toast, setToast] = useState("");
  const [syncLabel, setSyncLabel] = useState("本机已保存");
  const isOnline = useOnlineStatus();
  const [deletingData, setDeletingData] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [pendingCloudDeletion, setPendingCloudDeletion] = useState(false);
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
  const [shiftedPlanUndo, setShiftedPlanUndo] = useState<{ times: Array<Pick<Stage, "id" | "start" | "end">>; message: string } | null>(null);
  const [promptReflection, setPromptReflection] = useState<PromptReflection | null>(null);
  const [transitionReason, setTransitionReason] = useState<TransitionReason>("completed");
  const [rewardDraft, setRewardDraft] = useState<RewardGoal>(DEFAULT_DATA.rewardGoal);
  const [rewardEnergyConfirmed, setRewardEnergyConfirmed] = useState(false);
  const [lastSavedSession, setLastSavedSession] = useState<SessionRecord | null>(null);
  const [lastRedeemedReward, setLastRedeemedReward] = useState<RewardHistory | null>(null);
  const [dayDetailsExpanded, setDayDetailsExpanded] = useState(false);
  const [redeemArmed, setRedeemArmed] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<ReminderPermission>(() => typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported");
  const [backgroundReminder, setBackgroundReminder] = useState(() => typeof window !== "undefined" && localStorage.getItem(REMINDER_PREF_KEY) === "true");
  const dueReminderPlayed = useRef(false);
  const phoneShellRef = useRef<HTMLElement>(null);
  const clearPlanDeadline = useRef(0);
  const finishNightLock = useRef(false);
  const redeemRewardLock = useRef(false);
  const familyRevisionRef = useRef(0);
  const familyUpdatedAtRef = useRef("");
  const familyDataRef = useRef<AppData>(DEFAULT_DATA);
  const pendingWritesRef = useRef(new PendingWrites());
  const deleteInProgressRef = useRef(false);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const deleteConfirmRef = useRef<HTMLButtonElement>(null);
  const deleteReturnFocusRef = useRef<HTMLElement | null>(null);
  const screenRef = useRef<Screen>("welcome");
  const historyReadyRef = useRef(false);
  const historyDepthRef = useRef(0);
  const stageTimeEditRef = useRef<{ id: string; field: "start" | "end"; times: Array<Pick<Stage, "id" | "start" | "end">> } | null>(null);

  const showScreen = (next: Screen) => {
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
      const resolved = resolveHistoryTarget(current, target);
      if (resolved.blocked) {
        window.history.pushState({ xianKaishi: true, screen: current, depth: historyDepthRef.current } satisfies AppHistoryState, "");
        setToast("今晚还在进行，可以调整计划或温和收尾"); return;
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
  const openProfile = (from: "welcome" | "settings") => { setProfileReturn(from); go("profile"); };
  const openAdjust = () => { setAdjustChoice("extend"); go("adjust"); };
  const enterDualStart = () => { setGuardianConfirmed(false); setChildConfirmed(false); setClockNow(Date.now()); go("dual-start"); };
  const leaveDualStart = () => { setGuardianConfirmed(false); setChildConfirmed(false); back("confirm"); };
  const cancelDualLaunch = () => { setGuardianConfirmed(false); setChildConfirmed(false); };
  const toggleParticipant = (role: "guardian" | "child") => {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(18);
    if (role === "guardian") setGuardianConfirmed(value => !value);
    else setChildConfirmed(value => !value);
  };
  const openRewardSetup = () => {
    const next = data.rewardGoal.redeemed ? { ...data.rewardGoal, title: "", icon: "game" as const, threshold: 20, redeemed: false, acknowledged: false } : { ...data.rewardGoal };
    setRewardDraft(next); setRewardEnergyConfirmed(false); go("reward-setup");
  };

  const openRewardAchieved = () => {
    redeemRewardLock.current = false;
    setRedeemArmed(false);
    go("reward-achieved");
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const pendingDeletionId = localStorage.getItem(PENDING_DELETE_KEY) || "";
      if (pendingDeletionId) {
        [STORAGE_KEY, "xian-kaishi-family-v1", PLAN_DRAFT_KEY, LIVE_SESSION_KEY, REMINDER_PREF_KEY, FAMILY_REVISION_KEY, FAMILY_UPDATED_AT_KEY, "xian-kaishi-family-id"].forEach(key => localStorage.removeItem(key));
        setPendingCloudDeletion(true);
        void retryPendingCloudDeletion().then(cleared => setPendingCloudDeletion(!cleared));
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
            setStages(liveStages); setActiveIndex(Math.max(0, Math.min(liveStages.length - 1, Number(live.activeIndex) || 0)));
            setAdjustments(Math.max(0, Number(live.adjustments) || 0)); setActiveEndsAt(Math.max(0, Number(live.activeEndsAt) || 0));
            setStageDue(Boolean(live.stageDue)); setTransitionReason(normalizeTransitionReason(live.transitionReason, Boolean(live.stageDue))); setPromptReflection(normalizePromptReflection(live.promptReflection)); setLiveResumeScreen(savedScreen); setLiveSessionStartedAt(startedAt); setLiveSessionAvailable(true);
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
      fetch(`/api/state?familyId=${encodeURIComponent(id)}`).then(r => r.json()).then(result => {
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
            setData(remote); setConsent(remote.consent); setScreen(remote.consent ? "home" : "welcome"); setSyncLabel("云端已同步");
          } else if (winner === "local") {
            const localRevision = familyRevisionRef.current <= remoteRevision ? remoteRevision + 1 : familyRevisionRef.current;
            familyRevisionRef.current = localRevision; localStorage.setItem(FAMILY_REVISION_KEY, String(localRevision)); setSyncLabel("正在补同步本机更新…");
            const initialSync = fetch(`/api/state?familyId=${encodeURIComponent(id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: familyDataRef.current, revision: localRevision }) })
              .then(response => response.json()).then(sync => setSyncLabel(sync.ok ? "本机更新已补同步" : "已保留本机更新"))
              .catch(() => setSyncLabel("仅保存在本机"));
            void pendingWritesRef.current.track(initialSync);
          } else setSyncLabel("云端已同步");
        } else if (hasLocal) {
          const localRevision = Math.max(1, familyRevisionRef.current); familyRevisionRef.current = localRevision;
          localStorage.setItem(FAMILY_REVISION_KEY, String(localRevision)); setSyncLabel("正在补同步本机更新…");
          const initialSync = fetch(`/api/state?familyId=${encodeURIComponent(id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: familyDataRef.current, revision: localRevision }) })
            .then(response => response.json()).then(sync => setSyncLabel(sync.ok ? "本机更新已补同步" : "已保留本机更新"))
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
    localStorage.setItem(LIVE_SESSION_KEY, JSON.stringify({ startedAt, updatedAt, screen: liveScreen, planStart: data.planStart, planEnd: data.planEnd, stages, activeIndex, adjustments, activeEndsAt, stageDue, promptReflection, transitionReason } satisfies LiveSessionDraft));
  }, [activeEndsAt, activeIndex, adjustments, data.planEnd, data.planStart, liveSessionStartedAt, planHydrated, promptReflection, screen, stageDue, stages, transitionReason]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

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
    if ("serviceWorker" in navigator && window.isSecureContext) {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    const handleOffline = () => {
      setSyncLabel("离线 · 已保存在本机");
      setToast("网络暂时不可用，今晚仍会保存在本机");
    };
    const handleOnline = async () => {
      if (deleteInProgressRef.current) return;
      const deletionCleared = await retryPendingCloudDeletion();
      setPendingCloudDeletion(!deletionCleared);
      if (deleteInProgressRef.current) return;
      const activeFamilyId = localStorage.getItem("xian-kaishi-family-id") || "";
      const revision = familyRevisionRef.current;
      if (!activeFamilyId || revision < 1) { setSyncLabel("网络已恢复"); return; }
      setSyncLabel("网络已恢复，正在同步…");
      const syncPromise = (async () => {
        try {
          const response = await fetch(`/api/state?familyId=${encodeURIComponent(activeFamilyId)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: familyDataRef.current, revision }) });
          const result = await response.json();
          if (revision !== familyRevisionRef.current || deleteInProgressRef.current) return;
          if (response.status === 409 && result.data) {
            const merged = mergeFamilyData(familyDataRef.current, normalizeData(result.data));
            const retryRevision = Math.max(revision, Math.floor(Number(result.revision) || 0)) + 1;
            const retryUpdatedAt = new Date().toISOString();
            familyDataRef.current = merged; familyRevisionRef.current = retryRevision; familyUpdatedAtRef.current = retryUpdatedAt;
            setData(merged); localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); localStorage.setItem(FAMILY_REVISION_KEY, String(retryRevision)); localStorage.setItem(FAMILY_UPDATED_AT_KEY, retryUpdatedAt);
            const retry = await fetch(`/api/state?familyId=${encodeURIComponent(activeFamilyId)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: merged, revision: retryRevision }) });
            const retryResult = await retry.json();
            if (retryRevision !== familyRevisionRef.current || deleteInProgressRef.current) return;
            if (retry.ok && retryResult.updatedAt) { familyUpdatedAtRef.current = retryResult.updatedAt; localStorage.setItem(FAMILY_UPDATED_AT_KEY, retryResult.updatedAt); }
            setSyncLabel(retry.ok ? "网络已恢复 · 已合并并同步" : "网络已恢复 · 已保留本机更新"); return;
          }
          if (response.ok && result.updatedAt) { familyUpdatedAtRef.current = result.updatedAt; localStorage.setItem(FAMILY_UPDATED_AT_KEY, result.updatedAt); }
          setSyncLabel(response.ok ? "网络已恢复 · 云端已同步" : "网络已恢复 · 已保留本机更新");
        } catch {
          setSyncLabel("仅保存在本机");
        }
      })();
      await pendingWritesRef.current.track(syncPromise);
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => { window.removeEventListener("offline", handleOffline); window.removeEventListener("online", handleOnline); };
  }, []);

  useEffect(() => {
    if (screen !== "dual-start") return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
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

  const persist = (next: AppData, message?: string) => {
    if (deleteInProgressRef.current) return;
    const activeFamilyId = familyId || createId("family");
    if (!familyId) { localStorage.setItem("xian-kaishi-family-id", activeFamilyId); setFamilyId(activeFamilyId); }
    const revision = Math.max(familyRevisionRef.current, Math.floor(Number(localStorage.getItem(FAMILY_REVISION_KEY)) || 0)) + 1;
    const updatedAt = new Date().toISOString();
    familyDataRef.current = next; familyRevisionRef.current = revision; familyUpdatedAtRef.current = updatedAt;
    setData(next); localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); localStorage.setItem(FAMILY_REVISION_KEY, String(revision)); localStorage.setItem(FAMILY_UPDATED_AT_KEY, updatedAt); setSyncLabel("本机已保存 · 正在同步…");
    if (message) setToast(message);
    const syncPromise = fetch(`/api/state?familyId=${encodeURIComponent(activeFamilyId)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: next, revision }) })
      .then(async response => {
        const result = await response.json();
        if (revision !== familyRevisionRef.current || deleteInProgressRef.current) return;
        if (response.status === 409 && result.data) {
          const merged = mergeFamilyData(next, normalizeData(result.data));
          const retryRevision = Math.max(revision, Math.floor(Number(result.revision) || 0)) + 1;
          const retryUpdatedAt = new Date().toISOString();
          familyDataRef.current = merged; familyRevisionRef.current = retryRevision; familyUpdatedAtRef.current = retryUpdatedAt;
          setData(merged); localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); localStorage.setItem(FAMILY_REVISION_KEY, String(retryRevision)); localStorage.setItem(FAMILY_UPDATED_AT_KEY, retryUpdatedAt); setSyncLabel("正在合并另一处更新…");
          const retry = await fetch(`/api/state?familyId=${encodeURIComponent(activeFamilyId)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: merged, revision: retryRevision }) });
          const retryResult = await retry.json();
          if (retryRevision !== familyRevisionRef.current || deleteInProgressRef.current) return;
          if (retry.ok && retryResult.updatedAt) { familyUpdatedAtRef.current = retryResult.updatedAt; localStorage.setItem(FAMILY_UPDATED_AT_KEY, retryResult.updatedAt); }
          setSyncLabel(retry.ok ? "已合并并同步" : "已保留本机更新"); return;
        }
        if (response.ok && result.updatedAt) { familyUpdatedAtRef.current = result.updatedAt; localStorage.setItem(FAMILY_UPDATED_AT_KEY, result.updatedAt); }
        setSyncLabel(result.localOnly ? "仅保存在本机" : response.ok ? "云端已同步" : "已保留本机更新");
      }).catch(() => { if (!deleteInProgressRef.current) setSyncLabel("本机已保存 · 暂未同步"); });
    void pendingWritesRef.current.track(syncPromise);
  };

  const changeBackgroundReminder = async (enabled: boolean) => {
    if (!enabled) { localStorage.setItem(REMINDER_PREF_KEY, "false"); setBackgroundReminder(false); setToast("后台系统提醒已关闭"); return; }
    if (!("Notification" in window)) { setNotificationPermission("unsupported"); setToast("当前浏览器不支持系统提醒，前台提醒仍然有效"); return; }
    try {
      let permission = Notification.permission;
      if (permission === "default") permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      const granted = permission === "granted";
      localStorage.setItem(REMINDER_PREF_KEY, String(granted)); setBackgroundReminder(granted);
      setToast(granted ? "后台系统提醒已开启" : "系统提醒未开启，可在浏览器设置中重新允许");
    } catch {
      localStorage.setItem(REMINDER_PREF_KEY, "false"); setBackgroundReminder(false); setToast("暂时无法开启系统提醒，前台提醒仍然有效");
    }
  };

  const playTone = (kind: "confirm" | "transition" | "complete") => {
    if (!data.sound || typeof window === "undefined") return;
    const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx(); const gain = ctx.createGain(); const osc = ctx.createOscillator();
    osc.type = "sine"; osc.frequency.value = kind === "complete" ? 720 : kind === "transition" ? 540 : 620;
    gain.gain.setValueAtTime(.0001, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(.055, ctx.currentTime + .02); gain.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + .55);
    osc.addEventListener("ended", () => { void ctx.close(); });
    osc.connect(gain).connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + .58);
  };

  const finishProfile = () => {
    const childAlias = cleanShortText(data.childAlias, 12);
    const guardianAlias = cleanShortText(data.guardianAlias, 12);
    const next = { ...data, childAlias, guardianAlias, consent: true, rewardGoal: { ...data.rewardGoal, participants: [guardianAlias, childAlias] } };
    setPlanHydrated(true); persist(next, profileReturn === "settings" ? "家庭设置已更新" : "家庭称呼已保存，可以安排今晚了"); playTone("confirm");
    if (profileReturn === "settings") back("settings"); else go("plan", "replace");
  };

  const addStage = () => {
    const lastEnd = stages.at(-1)?.end ?? data.planStart;
    const id = createId("stage");
    setStages(items => [...items, { id, title: "新事项", icon: "custom", start: lastEnd, end: addMinutes(lastEnd, 20), effort: 1, energy: 1, status: "pending", kind: "task" }]);
    setEditingStageId(id);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const input = phoneShellRef.current?.querySelector<HTMLInputElement>(`[data-stage-id="${id}"] [data-stage-title]`);
      input?.scrollIntoView({ block: "center", behavior: data.reducedMotion ? "auto" : "smooth" }); input?.focus({ preventScroll: true }); input?.select();
    }));
  };

  const updateStage = (id: string, patch: Partial<Stage>) => setStages(items => items.map(item => item.id === id ? { ...item, ...patch } : item));
  const planTimeSnapshot = () => stages.map(({ id, start, end }) => ({ id, start, end }));
  const beginStageTimeEdit = (id: string, field: "start" | "end") => {
    if (stageTimeEditRef.current?.id === id && stageTimeEditRef.current.field === field) return;
    stageTimeEditRef.current = { id, field, times: planTimeSnapshot() };
  };
  const endStageTimeEdit = (id: string, field: "start" | "end") => {
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
      message: hasFollowing
        ? delta > 0 ? `本项延长 ${delta} 分钟，后续时间已顺延` : `本项缩短 ${Math.abs(delta)} 分钟，后续时间已提前`
        : `本项已${delta > 0 ? "延长" : "缩短"} ${Math.abs(delta)} 分钟`,
    });
    applyPlanTimes(shiftFollowingForEndChange(baseline, index, end));
  };
  const undoPlanShift = () => {
    if (!shiftedPlanUndo) return;
    const previousTimes = new Map(shiftedPlanUndo.times.map(item => [item.id, item]));
    setStages(items => items.map(item => {
      const previous = previousTimes.get(item.id);
      return previous ? { ...item, start: previous.start, end: previous.end } : item;
    }));
    setShiftedPlanUndo(null); setToast("已恢复调整前的时间");
  };
  const removeStage = (stage: Stage, index: number) => {
    const remaining = stages.filter(item => item.id !== stage.id); setStages(remaining);
    if (editingStageId === stage.id) setEditingStageId(remaining[Math.min(index, remaining.length - 1)]?.id ?? "");
    setShiftedPlanUndo(null); setDeletedStage({ stage, index });
  };
  const undoRemoveStage = () => {
    if (!deletedStage) return;
    const { stage, index } = deletedStage;
    setStages(items => { const next = [...items]; next.splice(Math.min(index, next.length), 0, stage); return next; });
    setEditingStageId(stage.id); setDeletedStage(null); setToast(`已恢复“${stage.title}”`);
  };
  const clearPlan = () => {
    if (Date.now() > clearPlanDeadline.current) {
      const deadline = Date.now() + 3200; clearPlanDeadline.current = deadline;
      setClearPlanArmed(true); setToast("再点一次确认清空");
      window.setTimeout(() => { if (clearPlanDeadline.current === deadline) { clearPlanDeadline.current = 0; setClearPlanArmed(false); } }, 3200); return;
    }
    clearPlanDeadline.current = 0; setStages([]); setEditingStageId(""); setClearPlanArmed(false); setToast("今晚已从空白开始");
  };
  const moveStage = (index: number, delta: -1 | 1) => {
    const target = index + delta; if (target < 0 || target >= stages.length) return;
    const next = [...stages]; [next[index], next[target]] = [next[target], next[index]];
    setStages(reflowTimedItemsFrom(next, 0, data.planStart));
  };

  const startPlan = () => {
    const startedAt = Date.now(); const actualStart = clockTimeFromDate(new Date(startedAt));
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

  const activeStage = stages[activeIndex] ?? stages[0];
  const nextPendingIndex = (from: number) => stages.findIndex((item, index) => index > from && item.status === "pending");
  const hasNextPending = nextPendingIndex(activeIndex) >= 0;
  const nextPendingStage = stages[nextPendingIndex(activeIndex)];
  const remainingSeconds = activeEndsAt ? Math.max(0, Math.ceil((activeEndsAt - clockNow) / 1000)) : 0;
  const canStartRest = canInsertRestBreak(activeStage.kind);
  const effectiveAdjustChoice: AdjustmentChoice = !canStartRest && adjustChoice === "rest" ? "extend" : adjustChoice;

  useEffect(() => {
    if (screen !== "adjust") return;
    const tick = () => setClockNow(Date.now());
    tick(); const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [screen]);

  useEffect(() => {
    if (screen !== "running" || !activeEndsAt) return;
    const tick = () => {
      const now = Date.now(); setClockNow(now);
      if (now >= activeEndsAt && !dueReminderPlayed.current) {
        dueReminderPlayed.current = true; setStageDue(true);
        let systemReminderShown = false;
        if (shouldUseBackgroundReminder(backgroundReminder, document.visibilityState, notificationPermission)) {
          try {
            const reminder = new Notification("这一段预计到时间了", { body: `${activeStage.title}：完成、继续或调整，都可以。`, icon: `/assets/icons/alarm.png?v=${ASSET_VERSION}`, tag: "xian-kaishi-stage-due" });
            reminder.onclick = () => { window.focus(); reminder.close(); };
            systemReminderShown = true;
          } catch { /* fall back to the in-page reminder below */ }
        }
        if (!systemReminderShown) { playTone("transition"); navigator.vibrate?.([25, 35, 25]); }
      }
    };
    tick(); const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
    // playTone uses the latest experience preference; the interval is recreated for each stage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEndsAt, activeStage.title, backgroundReminder, notificationPermission, screen]);

  const stageFinished = () => {
    setTransitionReason("completed");
    setStages(items => items.map((item, index) => index === activeIndex ? { ...item, status: "done" } : item));
    playTone("confirm"); navigator.vibrate?.([20]); go("transition");
  };

  const continueToNext = () => {
    const nextIndex = nextPendingIndex(activeIndex);
    if (nextIndex < 0) { go("wrap"); return; }
    setStages(items => items.map((item, index) => index === nextIndex ? { ...item, status: "active" } : item));
    const nextStage = stages[nextIndex];
    setActiveEndsAt(Date.now() + Math.max(1, durationMinutes(nextStage.start, nextStage.end)) * 60_000); setClockNow(Date.now()); setStageDue(false); dueReminderPlayed.current = false;
    setActiveIndex(nextIndex); go("running");
  };

  const extendCurrent = () => {
    const restartFromNow = activeStage.status === "done";
    const nextPlanEnd = addMinutes(data.planEnd, 10);
    setStages(items => shiftTimedItemsFrom(items, activeIndex + 1, 10).map((item, index) => index === activeIndex ? { ...item, end: addMinutes(item.end, 10), status: "active" } : item));
    setData(current => ({ ...current, planEnd: addMinutes(current.planEnd, 10) }));
    setActiveEndsAt(value => restartFromNow ? Date.now() + 10 * 60_000 : Math.max(value, Date.now()) + 10 * 60_000); setClockNow(Date.now()); setStageDue(false); dueReminderPlayed.current = false;
    setAdjustments(value => value + 1); setToast(`已顺延10分钟，最晚${nextPlanEnd}收尾`); go("running");
  };

  const startRestNow = () => {
    if (!canStartRest) { extendCurrent(); return; }
    const startedAt = Date.now();
    const result = insertRestBreak(
      stages,
      activeIndex,
      { id: createId("rest"), title: "安静休息", icon: "quiet", start: "", end: "", effort: 1, energy: 1, status: "active", kind: "rest" },
      clockTimeFromDate(new Date(startedAt)),
      remainingTimerMinutes(activeEndsAt, startedAt),
      10,
      10,
      data.planEnd,
    );
    setStages(result.items); setData(current => ({ ...current, planEnd: result.planEnd }));
    setActiveIndex(result.restIndex); setActiveEndsAt(startedAt + 10 * 60_000); setClockNow(startedAt); setStageDue(false); dueReminderPlayed.current = false;
    setAdjustments(value => value + 1); setToast(`现在休息10分钟，最晚${result.planEnd}收尾`); go("running");
  };

  const applyAdjustment = () => {
    if (effectiveAdjustChoice === "finish") { endTonightEarly(); return; }
    if (effectiveAdjustChoice === "extend") { extendCurrent(); return; }
    if (effectiveAdjustChoice === "rest") { startRestNow(); return; }
    if (effectiveAdjustChoice === "swap") {
      const pending = stages.map((item, index) => ({ item, index })).filter(({ item, index }) => index > activeIndex && item.status === "pending");
      if (pending.length < 2) { setToast("后面没有两项可以调换"); go("running"); return; }
      const firstIndex = pending[0].index; const next = [...stages]; [next[firstIndex], next[pending[1].index]] = [next[pending[1].index], next[firstIndex]];
      setStages(reflowTimedItemsFrom(next, firstIndex, stages[firstIndex].start)); setToast("后两项已调换，时间也重新排好了");
    } else {
      const idx = nextPendingIndex(activeIndex);
      if (idx < 0) { setToast("后面已经没有待安排的事项"); go("running"); return; }
      setStages(items => items.map((item, index) => index === idx ? { ...item, status: "tomorrow" } : item)); setToast("下一项已移到明天");
    }
    setAdjustments(value => value + 1); go("running");
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
    const completedCount = stages.filter(item => item.status === "done").length;
    const completedStageTitles = stages.filter(item => item.status === "done").map(item => item.title);
    const taskEnergy = stages.filter(item => item.status === "done").reduce((sum, item) => sum + item.energy, 0);
    const { cooperationEnergy, adjustmentEnergy } = calculateNightBonus(priorNightSessions, adjustments);
    const nextEnergy = data.energy + taskEnergy + cooperationEnergy + adjustmentEnergy;
    const record: SessionRecord = { id: createId("session"), date: recordDate, nightKey, stageCount: stages.length, completedCount, adjustments, taskEnergy, cooperationEnergy, adjustmentEnergy, energyEarned: taskEnergy + cooperationEnergy + adjustmentEnergy, stageTitles: completedStageTitles, promptReflection };
    const next = { ...data, energy: nextEnergy, sessions: [record, ...data.sessions].slice(0, 60) };
    setLastSavedSession(record); setStages(prepareNextRoundPlan(stages, completedStageTitles));
    localStorage.removeItem(LIVE_SESSION_KEY); setLiveSessionAvailable(false); setLiveSessionStartedAt("");
    persist(next, "今晚已经记入家庭日历"); playTone("complete");
    if (!next.rewardGoal.redeemed && !next.rewardGoal.acknowledged && nextEnergy >= next.rewardGoal.threshold) openRewardAchieved(); else go("night-saved");
  };

  const redeemReward = () => {
    if (redeemRewardLock.current) return;
    redeemRewardLock.current = true;
    const redeemedAt = new Date().toISOString();
    const history: RewardHistory = { id: createId("reward"), title: data.rewardGoal.title, icon: data.rewardGoal.icon, threshold: data.rewardGoal.threshold, energyBeforeReset: data.energy, redeemedAt };
    const next: AppData = {
      ...data, energy: 0, rewardHistory: [history, ...data.rewardHistory].slice(0, 60),
      rewardGoal: { threshold: 20, title: "", icon: "game", date: "周六", participants: [data.guardianAlias, data.childAlias], redeemed: true, acknowledged: false },
    };
    setLastRedeemedReward(history);
    setRedeemArmed(false); persist(next, "已经记入家庭日历"); playTone("complete"); go("reward-saved");
  };

  const keepRewardForLater = () => {
    const nextGoal = { ...data.rewardGoal, acknowledged: true };
    setRedeemArmed(false);
    persist({ ...data, rewardGoal: nextGoal }, `能量会保留，计划到${data.rewardGoal.date}再一起看看`);
    go("energy");
  };

  const saveRewardDraft = () => {
    const title = cleanShortText(rewardDraft.title, 24); const date = cleanShortText(rewardDraft.date, 16);
    if (!title || !date) { setToast("先一起写下期待和计划兑现时间"); return; }
    if (!rewardEnergyConfirmed) { setToast("再一起确认一次能量节奏"); return; }
    const nextGoal: RewardGoal = { ...rewardDraft, title, date, participants: [data.guardianAlias, data.childAlias], redeemed: false, acknowledged: false };
    persist({ ...data, rewardGoal: nextGoal }, "家庭期待已保存"); go("energy");
  };

  const exportData = () => {
    const planDraft: PlanDraft = { updatedAt: draftUpdatedAt || new Date().toISOString(), planStart: data.planStart, planEnd: data.planEnd, stages: stages.map(item => ({ ...item, status: "pending" })) };
    const activeSession: LiveSessionDraft | null = liveSessionAvailable ? { startedAt: liveSessionStartedAt || new Date().toISOString(), updatedAt: new Date().toISOString(), screen: liveResumeScreen, planStart: data.planStart, planEnd: data.planEnd, stages, activeIndex, adjustments, activeEndsAt, stageDue, promptReflection, transitionReason } : null;
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
    setPendingCloudDeletion(!cloudDeleted);
    localStorage.removeItem(STORAGE_KEY); localStorage.removeItem("xian-kaishi-family-v1"); localStorage.removeItem(PLAN_DRAFT_KEY); localStorage.removeItem(LIVE_SESSION_KEY); localStorage.removeItem(REMINDER_PREF_KEY); localStorage.removeItem(FAMILY_REVISION_KEY); localStorage.removeItem(FAMILY_UPDATED_AT_KEY); localStorage.removeItem("xian-kaishi-family-id"); familyDataRef.current = DEFAULT_DATA; familyRevisionRef.current = 0; familyUpdatedAtRef.current = ""; setPlanHydrated(false); setFamilyId(""); setData(DEFAULT_DATA); setConsent(false); setStages(DEFAULT_STAGES); setDraftUpdatedAt(""); setPromptReflection(null); setBackgroundReminder(false); setLiveSessionAvailable(false); setLiveSessionStartedAt(""); setDeleteArmed(false); go("welcome", "replace");
    setToast(cloudDeleted ? "本机与云端家庭数据已经删除" : "本机数据已删除；联网后继续清理云端副本");
    deleteInProgressRef.current = false; setDeletingData(false);
  };

  const modeLabel = { adult: "大人先安排", together: "一起安排", child: "孩子先安排" }[data.planningMode];
  const effortCopy = { 1: "一小步", 2: "需要专注", 3: "今天比较费力" } as const;
  const promptReflectionCopy: Record<PromptReflection, string> = { less: "催促感少一些", same: "和往常差不多", more: "催促感多一些" };
  const progress = Math.max(0, data.rewardGoal.threshold - data.energy);
  const { minimum: rewardMinimumThreshold, maximum: rewardMaximumThreshold } = rewardThresholdBounds(data.energy);
  const rewardDraftValid = Boolean(rewardDraft.title.trim() && rewardDraft.date.trim());
  const rewardDraftReady = rewardDraftValid && rewardEnergyConfirmed;
  const rewardEstimatedNights = Math.max(1, Math.ceil(Math.max(1, rewardDraft.threshold - data.energy) / 7));
  const goalReady = !data.rewardGoal.redeemed && progress === 0;
  const goalState: "empty" | "building" | "ready" = data.rewardGoal.redeemed ? "empty" : goalReady ? "ready" : "building";
  const hasDeferredStages = stages.some(item => item.status === "tomorrow");
  const monthStart = calendarCursor;
  const calendarYear = monthStart.getFullYear(); const calendarMonth = monthStart.getMonth();
  const firstWeekday = monthStart.getDay(); const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const monthKeyPrefix = `${calendarYear}-${String(calendarMonth + 1).padStart(2, "0")}`;
  const monthSessions = data.sessions.filter(item => item.nightKey.startsWith(monthKeyPrefix));
  const monthRewards = data.rewardHistory.filter(item => { const date = new Date(item.redeemedAt); return date.getFullYear() === calendarYear && date.getMonth() === calendarMonth; });
  const metrics = !monthSessions.length && !monthRewards.length ? null : { nights: new Set(monthSessions.map(item => item.nightKey)).size, adjustments: monthSessions.reduce((sum, item) => sum + item.adjustments, 0), lessPromptNights: monthSessions.filter(item => item.promptReflection === "less").length };
  const selectedSessions = data.sessions.filter(item => item.nightKey === selectedDay);
  const selectedRewards = data.rewardHistory.filter(item => localDateKey(item.redeemedAt) === selectedDay);
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
  const { availableMinutes, scheduledMinutes, itemErrors: planItemErrors, issues: planIssues, hasErrors: planHasErrors, balanceMinutes: planBalance } = planAnalysis;
  const stageIssueById = new Map<string, string>(stages.flatMap((stage, index): Array<[string, string]> => planItemErrors[index]?.messages.length ? [[stage.id, planItemErrors[index].messages.join("；")]] : []));
  const planStageIssueIds = new Set(stageIssueById.keys());
  const planCrossesMidnight = spansMidnight(data.planStart, data.planEnd);
  const draftEnergy = stages.reduce((sum, item) => sum + item.energy, 0);
  const activeSettlementNightKey = familyNightKey(liveSessionStartedAt || new Date());
  const priorSettlementSessions = data.sessions.filter(item => item.nightKey === activeSettlementNightKey);
  const settlementTaskEnergy = stages.filter(item => item.status === "done").reduce((sum, item) => sum + item.energy, 0);
  const { cooperationEnergy: settlementCooperationEnergy, adjustmentEnergy: settlementAdjustmentEnergy } = calculateNightBonus(priorSettlementSessions, adjustments);
  const settlementTotalEnergy = settlementTaskEnergy + settlementCooperationEnergy + settlementAdjustmentEnergy;
  const draftStart = stages[0]?.start ?? data.planStart;
  const draftEnd = stages.at(-1)?.end ?? data.planEnd;
  const editingStage = stages.find(item => item.id === editingStageId);
  const commonIconLibrary = ICON_LIBRARY.filter(([icon]) => COMMON_ICON_NAMES.has(icon));
  const selectedIconEntry = ICON_LIBRARY.find(([icon]) => icon === editingStage?.icon);
  const visibleIconLibrary = showAllIcons ? ICON_LIBRARY : selectedIconEntry && !COMMON_ICON_NAMES.has(selectedIconEntry[0]) ? [selectedIconEntry, ...commonIconLibrary] : commonIconLibrary;
  const startNowLabel = clockTimeFromDate(new Date(clockNow));
  const restPlanPreview = insertRestBreak(
    stages,
    activeIndex,
    { id: "rest-preview", title: "安静休息", icon: "quiet", start: "", end: "", effort: 1, energy: 1, status: "active", kind: "rest" },
    startNowLabel,
    remainingTimerMinutes(activeEndsAt, clockNow),
    10,
    10,
    data.planEnd,
  );
  const bothParticipantsReady = guardianConfirmed && childConfirmed;
  const dualStartStatus = bothParticipantsReady
    ? { title: `即将进入“${stages[0]?.title || "第一项"}”`, detail: "如果还想商量一下，点“先等等”就会停住。" }
    : guardianConfirmed
      ? { title: `轮到${data.childAlias}确认`, detail: "可以自己轻点，也可以请大人协助；这不是考试。" }
      : childConfirmed
        ? { title: `轮到${data.guardianAlias}确认`, detail: "大人确认手机仍由自己保管，再一起开始。" }
        : { title: `先由${data.guardianAlias}确认`, detail: `这不是身份验证；再请${data.childAlias}轻点自己的名字，不用同时按住。` };
  const startsAtPlannedTime = startNowLabel === (stages[0]?.start ?? data.planStart);
  const adjustmentOptions: Array<{ id: AdjustmentChoice; icon: string; title: string; copy: string }> = [
    { id: "extend", icon: "steps", title: canStartRest ? "延长当前阶段" : "再休息10分钟", copy: "后续时间顺延10分钟" },
    ...(canStartRest ? [{ id: "rest" as const, icon: "quiet", title: "现在休息10分钟", copy: "原事项随后继续" }] : []),
    { id: "swap", icon: "speech", title: "调换后两项", copy: "时间会自动重排" },
    { id: "tomorrow", icon: "moon", title: "下一项移到明天", copy: "保留已经完成的进展" },
    { id: "finish", icon: "home-heart", title: "今晚先到这里", copy: "保留进展，温和收尾" },
  ];
  const completedStageCount = stages.filter(item => item.status === "done").length;
  const tonightStageCount = stages.filter(item => item.status !== "tomorrow").length;
  const activeNightLabel = liveNightLabel(liveSessionStartedAt);
  const liveResumeView = (() => {
    const stageTitle = activeStage?.title || "继续今晚";
    if (liveResumeScreen === "wrap") return { state: "wrap", icon: "home-heart", kicker: `${activeNightLabel}等待温和收尾 · 进度已保存在本机`, title: `${activeNightLabel}，温和收尾`, detail: "只差最后30秒，一起看见已经做到的部分", cta: "继续收尾 ›" };
    if (liveResumeScreen === "adjust") return { state: "adjust", icon: "speech", kicker: `${activeNightLabel}计划正在调整 · 进度已保存在本机`, title: `调整${activeNightLabel}计划`, detail: "继续、休息、调换或温和收尾", cta: "继续调整 ›" };
    if (liveResumeScreen === "transition" && transitionReason === "completed") return { state: "completed", icon: "check", kicker: "这一段已完成 · 进度已保存在本机", title: `${stageTitle}已经告一段落`, detail: "选择下一阶段、继续、休息或调整", cta: "继续选择 ›" };
    if (liveResumeScreen === "transition" || stageDue) return { state: "due", icon: "alarm", kicker: "阶段预计到时 · 只提醒一次", title: stageTitle, detail: "完成、继续或调整，都可以", cta: "继续选择 ›" };
    return { state: "running", icon: "alarm", kicker: `${activeNightLabel}正在进行 · 进度已保存在本机`, title: stageTitle, detail: `${completedStageCount}/${tonightStageCount} 个阶段已完成`, cta: "继续 ›" };
  })();
  const backgroundReminderStatus = notificationPermission === "granted"
    ? backgroundReminder ? "页面留在后台时，会显示一条系统提醒" : "已获得系统权限，需要时可以在这里开启"
    : notificationPermission === "denied" ? "系统权限未允许，可在浏览器设置中重新开启"
      : notificationPermission === "unsupported" ? "当前浏览器不支持；前台提示音和震动仍然有效"
        : "开启时只向家长请求一次浏览器通知权限";
  const shiftMonth = (delta: number) => {
    const next = new Date(calendarYear, calendarMonth + delta, 1);
    setCalendarCursor(next); setSelectedDay(next.toLocaleDateString("en-CA")); setDayDetailsExpanded(false);
  };
  const openNightRecord = (nightKey: string) => {
    const date = new Date(`${nightKey}T12:00:00`);
    setSelectedDay(nightKey); setDayDetailsExpanded(false);
    if (Number.isFinite(date.getTime())) setCalendarCursor(new Date(date.getFullYear(), date.getMonth(), 1));
    go("review");
  };
  const startAnotherPlan = () => {
    setEditingStageId("");
    go("plan");
  };
  const toggleWeeklyFocus = () => {
    if (currentWeekFocus?.text === reviewSuggestion.text) {
      persist({ ...data, weeklyFocus: null }, "已从首页移除这项尝试"); return;
    }
    persist({ ...data, weeklyFocus: { weekKey: weekStartKey, text: reviewSuggestion.text, createdAt: new Date().toISOString() } }, "已放到首页，这周只试这一件");
  };

  return <main className={`site-shell ${data.reducedMotion ? "reduce-motion" : ""}`} data-screen={screen}>
    <div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <section className={`phone-shell ${isOnline ? "" : "is-offline"}`} ref={phoneShellRef} aria-hidden={deleteArmed || undefined} inert={deleteArmed || undefined}>
      {!isOnline && <div className="offline-ribbon" role="status"><i aria-hidden="true" /><span><strong>离线使用中</strong><small>今晚仍会安全保存在本机</small></span></div>}
      {!appReady && <div className="screen app-loading-screen" role="status" aria-live="polite"><div className="brand-mark"><AppIcon name="home-heart" /><strong>先开始</strong></div><Mascot mood="breathe" /><div><strong>正在找回这个家庭的今晚</strong><span>先确认本机记录，再看看是否有更新</span></div><span className="loading-leaves" aria-hidden="true"><i /><i /><i /></span></div>}
      {appReady && screen === "welcome" && <div className="screen welcome-screen">
        <div className="welcome-brand"><div className="brand-mark"><AppIcon name="home-heart" /><strong>先开始</strong></div><span>家庭晚间习惯助手</span></div>
        <div className="welcome-hero"><div><span className="eyebrow">孩子只短暂看屏幕 · 大人掌控手机</span><h1>今晚少催一次，<br />先一起商量</h1><p className="lead">不讲题、不监控、不比较。只帮你们把“开始—完成—收尾”变得更容易。</p></div><Mascot mood="ready" compact /></div>
        <div className="welcome-flow" aria-label="三步使用方式"><div><b>1</b><span><strong>排今晚</strong><small>商量任务与休息</small></span></div><div><b>2</b><span><strong>一起点亮</strong><small>两人确认再开始</small></span></div><div><b>3</b><span><strong>柔和提醒</strong><small>每阶段只提醒一次</small></span></div></div>
        <div className="privacy-card welcome-boundary"><div><span className="big-icon"><AppIcon name="privacy" /></span><span><strong>孩子不会被监控或公开比较</strong><small>仅使用家庭化名；不收集学校、年级、位置、录音或社交平台数据。</small></span></div><button type="button" onClick={() => openPrivacy("welcome")}>查看数据保存与删除说明 <span>›</span></button></div>
        <div className="welcome-action-dock"><div className="consent-row"><input id="guardian-consent" type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /><label htmlFor="guardian-consent">我是监护人，已了解并同意监护人授权与儿童隐私说明</label></div><button className="primary-button" disabled={!consent} onClick={() => openProfile("welcome")}>{consent ? "设置家庭称呼" : "请先确认监护人授权"}</button><small>约 1 分钟完成设置 · 数据可随时导出或删除</small></div>
      </div>}

      {appReady && screen === "privacy" && <div className="screen privacy-screen">
        <Header back={() => back(privacyReturn)} title="隐私与数据说明" />
        <div className="title-with-mascot"><div><span className="eyebrow">监护人先看清楚，再决定是否使用</span><h1>哪些数据保存在哪里？</h1></div><Mascot mood="support" compact /></div>
        <p className="lead">我们只保留完成核心流程需要的信息，不收集孩子真实姓名、年级、学校、精确位置、通讯录、人脸、声音或持续行为监控数据。</p>
        <div className="privacy-storage-list">
          <div><span className="big-icon"><AppIcon name="moon" /></span><section><small>仅保存在当前设备</small><strong>今晚计划草稿与进行中状态</strong><p>用于刷新或意外关页后继续；凌晨可以接着昨晚，最迟到次日清晨5点自动失效。</p></section></div>
          <div><span className="big-icon"><AppIcon name="alarm" /></span><section><small>仅保存在当前设备</small><strong>后台提醒开关与浏览器通知权限</strong><p>只有监护人主动开启后才使用；关闭浏览器后不承诺提醒送达。</p></section></div>
          <div><span className="big-icon"><AppIcon name="privacy" /></span><section><small>当前测试版会同步到云端</small><strong>家庭化名、设置、能量、晚间与兑换记录</strong><p>通过随机家庭 ID 关联；设备与云端会比较版本，旧状态不会静默覆盖更新的本机记录。</p></section></div>
          <div><span className="big-icon"><AppIcon name="quiet" /></span><section><small>不会收集</small><strong>学校、位置、通讯录、人脸、录音与社交平台数据</strong><p>外部内容只能由监护人主动输入，不读取微信、小红书或学校系统。</p></section></div>
        </div>
        <div className="privacy-transparency"><strong>测试版安全边界</strong><p>随机家庭 ID 不是正式账号鉴权。当前站点保持私有；公开测试前需要增加监护人登录与访问控制，或关闭云端同步。</p></div>
        <div className="data-rights-card"><span className="eyebrow">家庭可以随时</span><h2>导出或删除全部数据</h2><p>导出文件包含家庭状态、本机计划草稿和进行中状态。删除会清除本机数据、云端记录和旧的随机家庭 ID。</p>{data.consent && <div className="two-buttons"><button className="secondary-button" onClick={exportData}>导出数据</button><button className="secondary-button danger-outline" onClick={requestDeleteData}>删除数据</button></div>}</div>
        <button className="primary-button" onClick={() => back(privacyReturn)}>{privacyReturn === "welcome" ? "我已了解，返回授权" : "返回设置"}</button>
      </div>}

      {appReady && screen === "profile" && <div className="screen profile-screen">
        <Header back={() => back(profileReturn)} title="家庭设置" />
        <div className="title-with-mascot"><div><span className="eyebrow">只填写今晚真正会用到的信息</span><h1>今晚，谁一起安排？</h1></div><Mascot compact /></div>
        <div className="form-card family-form profile-essential"><label>孩子希望怎么被称呼<span>用化名就好</span><input name="child-alias" aria-label="孩子化名" maxLength={12} autoComplete="off" autoCapitalize="none" spellCheck={false} enterKeyHint="next" value={data.childAlias} onChange={e => setData({ ...data, childAlias: e.target.value })} /></label><label>大人怎么称呼<span>会显示在共同启动的手指上</span><input name="guardian-alias" aria-label="大人称呼" maxLength={12} autoComplete="off" autoCapitalize="none" spellCheck={false} enterKeyHint="done" value={data.guardianAlias} onChange={e => setData({ ...data, guardianAlias: e.target.value })} /></label></div>
        <details className="profile-preferences" open={profileReturn === "settings"}><summary><span><strong>今晚偏好</strong><small>{modeLabel} · 通常 {data.arrival} 到家</small></span><b>{profileReturn === "settings" ? "正在编辑" : "可稍后修改"}</b></summary><div className="profile-preferences-body"><fieldset><legend>今晚主要由谁安排</legend><div className="mode-grid">{(["adult", "together", "child"] as PlanningMode[]).map(mode => <button type="button" key={mode} aria-pressed={data.planningMode === mode} className={data.planningMode === mode ? "selected" : ""} onClick={() => setData({ ...data, planningMode: mode })}>{({ adult: "大人先安排", together: "一起安排", child: "孩子先安排" })[mode]}</button>)}</div></fieldset><label>通常到家<input type="time" value={data.arrival} onChange={e => setData({ ...data, arrival: e.target.value })} /></label></div></details>
        <div className="profile-action-dock"><p className="microcopy">不需要填写年级、学校、班级或真实姓名。</p><button className="primary-button" disabled={!data.childAlias.trim() || !data.guardianAlias.trim()} onClick={finishProfile}>{profileReturn === "settings" ? "保存修改" : "保存并安排今晚"}</button>{profileReturn !== "settings" && <small>下一步直接商量今晚的任务与休息</small>}</div>
      </div>}

      {screen === "home" && <div className="screen with-nav home-screen">
        <div className="home-hero"><div><span className="eyebrow">{data.arrival} · {modeLabel}</span><h1>{liveSessionAvailable && activeNightLabel === "昨晚" ? "昨晚还没收尾，先温和接住" : !liveSessionAvailable && currentNightSummary ? "今晚已经温和收尾" : "今晚，一起找到舒服的节奏"}</h1><p>{liveSessionAvailable && activeNightLabel === "昨晚" ? "进度还在；继续或结束，都不需要重新来过。" : !liveSessionAvailable && currentNightSummary ? "记录已经留下，接下来可以放松一点。" : "先排时间，再一起点亮开始。"}</p></div><Mascot mood={!liveSessionAvailable && currentNightSummary ? "celebrate" : "confirm"} compact /></div>
        {liveSessionAvailable ? <div className="live-session-panel" data-state={liveResumeView.state}><button className="live-resume-card" onClick={() => go(liveResumeScreen)}><span className="live-pulse"><AppIcon name={liveResumeView.icon} /></span><span><small>{liveResumeView.kicker}</small><strong>{liveResumeView.title}</strong><em>{liveResumeView.detail}</em></span><b>{liveResumeView.cta}</b></button>{liveResumeScreen !== "wrap" && <button className="soft-end-button" onClick={endTonightEarly}>{activeNightLabel}先到这里</button>}</div> : currentNightSummary ? <div className="settled-home-card"><div className="settled-home-title"><span className="settled-check"><AppIcon name="check" /></span><div><small>这一晚已经温和收尾</small><strong>今晚的合作已经留下来了</strong><p>{currentNightSummary.reflection ? promptReflectionCopy[currentNightSummary.reflection] : "完成多少都不需要重新比较。"}</p></div></div><div className="settled-home-stats"><span><b>{currentNightSummary.completed}</b><small>完成阶段</small></span><span><b>{currentNightSummary.adjustments}</b><small>主动调整</small></span><span><b>+{currentNightSummary.energy}</b><small>本夜能量</small></span></div><button className="primary-button settled-review-button" onClick={() => openNightRecord(currentFamilyNightKey)}>查看这一晚的记录</button><button className="text-button another-plan-button" onClick={startAnotherPlan}>还有新的安排</button><small className="settled-energy-rule">再次安排不会重复获得“共同收尾”能量</small></div> : <button className="home-plan-cta" onClick={startAnotherPlan}><span className="home-plan-icon"><AppIcon name="moon" /></span><span className="home-plan-copy"><small>{stages.length ? `今晚草稿 · ${draftUpdatedAt ? "已自动保存" : "仅保存在这台设备"}` : "今晚计划"}</small><strong>{stages.length ? "继续安排今晚" : "开始安排今晚"}</strong><em>{stages.length ? `${stages.length}个节点 · ${formatPlanClock(draftStart, data.planStart, data.planEnd)}—${formatPlanClock(draftEnd, data.planStart, data.planEnd)} · ${draftEnergy}点能量` : "先加一件最容易开始的小事"}</em></span><b aria-hidden="true">›</b></button>}
        <div className="insight-card sage"><span className="big-icon"><AppIcon name="quiet" /></span><div><small>今晚的默认提醒</small><strong>每个阶段只提醒一次，也可以继续或调整</strong></div></div>
        {currentWeekFocus && <button className="insight-card weekly-focus-home" onClick={() => go("review")}><span className="big-icon"><AppIcon name="home-heart" /></span><div><small>这周只试这一件 · 给大人的提醒</small><strong>{currentWeekFocus.text}</strong></div><span>›</span></button>}
        <button className={`insight-card support-entry goal-entry-${goalState}`} onClick={goalState === "empty" ? openRewardSetup : goalState === "ready" ? openRewardAchieved : () => go("energy")}><span className="big-icon"><AppIcon name={goalState === "empty" ? "home-heart" : goalState === "ready" ? data.rewardGoal.icon : "plant"} /></span><div><small>{goalState === "empty" ? "下一份家庭期待" : goalState === "ready" ? "家庭期待已点亮" : "家庭期待"}</small><strong>{goalState === "empty" ? "一起定下想共度的家庭时光" : data.rewardGoal.title}</strong><small>{goalState === "empty" ? "从0开始，不用急着定" : goalState === "ready" ? "等你们真的一起实现后再记录" : `还差${progress}点，一起积累`}</small></div><span>›</span></button>
        <div className="stats-row"><div><small>本周记录</small><strong>{weeklyNights} 晚</strong></div><div><small>家庭能量</small><strong>{data.energy}</strong><div className="energy-leaves">{[1,2,3,4,5].map(n => <i className={n <= Math.min(5, Math.ceil(data.energy / 6)) ? "filled" : ""} key={n} />)}</div></div></div>
        <p className="sync-label">{syncLabel}</p>
      </div>}

      {screen === "plan" && <div className="screen plan-screen">
        <Header back={() => back("home")} title="一起安排今晚" step="1/3" />
        <div className="availability-card custom-window"><AppIcon name="moon" /><div><small>今晚可用时间 · 可以自定义</small><div className="window-inputs"><input aria-label="今晚开始时间" type="time" value={data.planStart} onChange={e => setData(current => ({ ...current, planStart: e.target.value }))} /><span>—</span><input aria-label="今晚结束时间" type="time" value={data.planEnd} onChange={e => setData(current => ({ ...current, planEnd: e.target.value }))} /></div>{planCrossesMidnight && <span className="overnight-note">跨到次日 · 结束时间按第二天计算</span>}</div><Mascot compact /></div>
        <div className={`plan-balance ${planHasErrors ? "has-error" : ""}`} role="status"><div><span>{planHasErrors ? "先调整一下时间" : `已安排 ${scheduledMinutes} 分钟`}</span><strong>{planHasErrors ? planIssues[0] : planBalance ? `还留有 ${planBalance} 分钟空白` : "刚好装下今晚"}</strong></div><div className="balance-track"><i style={{ width: `${availableMinutes ? Math.min(100, scheduledMinutes / availableMinutes * 100) : 100}%` }} /></div></div>
        <div className="plan-tools"><span>草稿会自动保存在本机</span>{stages.length > 0 && <button className={clearPlanArmed ? "armed" : ""} onClick={clearPlan}>{clearPlanArmed ? "确认清空" : "从空白开始"}</button>}</div>
        <div className={`plan-list ${!stages.length ? "is-empty" : ""}`}>{!stages.length && <div className="empty-plan"><Mascot mood="breathe" compact /><strong>今晚还没有节点</strong><span>先加一件最容易开始的小事就好</span></div>}{stages.map((stage, index) => { const expanded = editingStageId === stage.id; const hasIssue = planStageIssueIds.has(stage.id); const issueText = stageIssueById.get(stage.id); const titleInvalid = Boolean(planItemErrors[index]?.title); const timeInvalid = Boolean(planItemErrors[index]?.time); return <div data-stage-id={stage.id} className={`stage-editor ${expanded ? "is-expanded" : "is-collapsed"} ${hasIssue ? "has-stage-issue" : ""} ${stage.status === "tomorrow" ? "muted-stage" : ""}`} key={stage.id}>
          <button className="stage-summary" aria-expanded={expanded} aria-controls={`stage-editor-${stage.id}`} aria-label={`${expanded ? "收起" : "编辑"}第${index + 1}项${stage.title || "未命名事项"}`} onClick={() => setEditingStageId(expanded ? "" : stage.id)}><span className="stage-summary-icon"><AppIcon name={stage.icon} /></span><span className="stage-summary-copy"><strong>{stage.title.trim() || "未命名事项"}</strong><small>{hasIssue ? "需要调整这一项" : `${formatPlanClock(stage.start, data.planStart, data.planEnd)}—${formatPlanClock(stage.end, data.planStart, data.planEnd)} · ${stage.kind === "rest" ? "休息放松" : effortCopy[stage.effort]}`}</small></span><span className="stage-summary-energy"><b>{stage.energy}</b><small>能量</small></span><i aria-hidden="true">⌄</i></button>
          {expanded && <div id={`stage-editor-${stage.id}`} className="stage-editor-body"><button className="stage-icon-button" onClick={() => { setEditingStageId(stage.id); go("icon-picker"); }} aria-label={`更换${stage.title}图标`}><AppIcon name={stage.icon} /><small>换图标</small></button><div className="stage-main"><input data-stage-title className="stage-title-input" aria-label={`第${index + 1}项名称`} aria-invalid={titleInvalid} aria-describedby={hasIssue ? `stage-issue-${stage.id}` : undefined} maxLength={24} autoComplete="off" spellCheck={false} enterKeyHint="done" value={stage.title} onChange={e => updateStage(stage.id, { title: e.target.value })} onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.blur(); setEditingStageId(""); } }} /><div className="time-range"><input aria-label={`${stage.title || `第${index + 1}项`}开始时间`} aria-invalid={timeInvalid} aria-describedby={hasIssue ? `stage-issue-${stage.id}` : undefined} type="time" value={stage.start} onFocus={() => beginStageTimeEdit(stage.id, "start")} onBlur={() => endStageTimeEdit(stage.id, "start")} onChange={e => updateStageStart(stage.id, e.target.value)} /><span>—</span><input aria-label={`${stage.title || `第${index + 1}项`}结束时间`} aria-invalid={timeInvalid} aria-describedby={hasIssue ? `stage-issue-${stage.id}` : undefined} type="time" value={stage.end} onFocus={() => beginStageTimeEdit(stage.id, "end")} onBlur={() => endStageTimeEdit(stage.id, "end")} onChange={e => updateStageEnd(stage.id, e.target.value)} /></div><div className="stage-meta"><button className={`effort-pill effort-${stage.kind === "rest" ? "rest" : stage.effort}`} onClick={() => { setEditingStageId(stage.id); go("effort"); }}>{stage.kind === "rest" ? "休息放松" : effortCopy[stage.effort]} · 调整</button><label className="task-energy"><span><b>共同商量能量</b><strong>{stage.energy} 点</strong></span><input className="task-energy-range branded-range" type="range" min="1" max="5" step="1" value={stage.energy} aria-label={`${stage.title}完成后的家庭能量`} aria-valuetext={`${stage.energy}点家庭能量`} style={{ "--range-progress": `${(stage.energy - 1) * 25}%` } as CSSProperties} onChange={e => updateStage(stage.id, { energy: Number(e.target.value) })} /><span className="task-energy-scale" aria-hidden="true">{[1,2,3,4,5].map(value => <i key={value}>{value}</i>)}</span></label></div>{issueText && <p id={`stage-issue-${stage.id}`} className="stage-inline-issue" aria-live="polite">{issueText}</p>}</div><div className="stage-actions"><button onClick={() => moveStage(index, -1)} disabled={index === 0} aria-label="向上移动">↑</button><button onClick={() => moveStage(index, 1)} disabled={index === stages.length - 1} aria-label="向下移动">↓</button><button onClick={() => removeStage(stage, index)} aria-label={`删除${stage.title}，可撤销`}>×</button></div></div>}
        </div>; })}</div>
        <button className="add-node-button" onClick={addStage} aria-label="增加一个时间节点"><span>＋</span><strong>增加一个节点</strong></button>
        <div className="gentle-note">今晚安排可以随时调整。留一点空白，比把时间装满更容易开始。</div><button className="primary-button" disabled={!stages.length || planHasErrors} onClick={() => go("confirm")}>{planHasErrors ? "先调整标出的时间" : "下一步：一起确认"}</button>
      </div>}

      {screen === "icon-picker" && <div className="screen icon-picker-screen">
        <Header back={() => back("plan")} title="选择活动图标" /><span className="eyebrow">{showAllIcons ? `全部 ${ICON_LIBRARY.length} 个图标` : `先显示 ${commonIconLibrary.length} 个家庭高频图标`}</span><h1>这件事看起来像什么？</h1>
        <div className="icon-library">{visibleIconLibrary.map(([icon,label]) => { const selected = editingStage?.icon === icon; return <button key={icon} aria-pressed={selected} className={selected ? "selected" : ""} onClick={() => { updateStage(editingStageId, { icon }); setShowAllIcons(false); back("plan"); }}><AppIcon name={icon} loading="lazy" /><small>{label}</small></button>; })}</div>
        <button className="icon-library-toggle" aria-expanded={showAllIcons} onClick={() => setShowAllIcons(value => !value)}>{showAllIcons ? "收起到常用图标" : `显示全部 ${ICON_LIBRARY.length} 个图标`}</button>
      </div>}

      {screen === "effort" && <div className="screen effort-screen">
        <Header back={() => back("plan")} />
        <span className="eyebrow">先确定它是投入，还是恢复</span><h1>这段时间更像什么？</h1>
        <div className="current-task-card"><AppIcon name={editingStage?.icon ?? "pencil"} /><div><strong>{editingStage?.title}</strong><small>同一件事在不同晚上，也可以有不同感觉</small></div></div>
        <div className="stage-kind-picker" role="group" aria-label="节点类型"><button aria-pressed={editingStage?.kind === "task"} className={editingStage?.kind === "task" ? "selected" : ""} onClick={() => updateStage(editingStageId, { kind: "task" })}><AppIcon name="pencil" /><span><strong>要做的事</strong><small>需要投入一点注意力</small></span></button><button aria-pressed={editingStage?.kind === "rest"} className={editingStage?.kind === "rest" ? "selected" : ""} onClick={() => updateStage(editingStageId, { kind: "rest", effort: 1 })}><AppIcon name="quiet" /><span><strong>休息放松</strong><small>让身体和情绪恢复</small></span></button></div>
        {editingStage?.kind === "task" ? <><h2 className="detail-heading">今天需要多少力气？</h2><div className="effort-options">{([1,2,3] as Effort[]).map(level => { const copy = { 1: ["一小步", "我可以先自己试试"], 2: ["需要专注", "请帮我把第一步说清楚"], 3: ["今天比较费力", "先缩小任务或多休息"] }[level]; const selected = editingStage?.effort === level; return <button key={level} aria-pressed={selected} className={selected ? `selected effort-${level}` : `effort-${level}`} onClick={() => updateStage(editingStageId, { effort: level })}><span className="effort-leaves">{Array.from({ length: level }).map((_, i) => <i key={i} />)}</span><span><strong>{copy[0]}</strong><small>{copy[1]}</small></span><b>{selected ? "✓" : "○"}</b></button>; })}</div></> : <div className="rest-duration"><span>这次准备休息多久？</span><div>{[5,10,15].map(minutes => { const selected = durationMinutes(editingStage?.start ?? "00:00", editingStage?.end ?? "00:00") === minutes; return <button key={minutes} aria-pressed={selected} className={selected ? "selected" : ""} onClick={() => editingStage && updateStageEnd(editingStageId, addMinutes(editingStage.start, minutes))}>{minutes}分钟</button>; })}</div><small>先约定时长，到点再一起看看下一步，不用突然打断。</small></div>}
        <div className="support-suggestion"><Mascot mood="support" compact /><div><small>今晚建议</small><strong>{editingStage?.kind === "rest" ? "休息也算照顾计划的一部分" : (editingStage?.effort ?? 1) === 3 ? "先休息10分钟，再缩小第一步" : "从第一小步开始，卡住时再求助"}</strong><p>{editingStage?.kind === "rest" ? "休息不会被当作偷懒，也不需要用屏幕填满。" : "用力程度不会改变奖励，也不会给孩子打分。"}</p></div></div>
        <button className="primary-button" onClick={() => back("plan")}>保存到时间表</button>
      </div>}

      {screen === "confirm" && <div className="screen confirm-screen">
        <Header back={() => back("plan")} title="共同确认" step="2/3" />
        <div className="confirm-hero"><div><span className="eyebrow">先确认今晚，再确认彼此</span><h1>这份安排，<br />我们都可以调整</h1></div><Mascot mood="confirm" compact /></div>
        <div className="summary-strip"><span><strong>{stages[0]?.start}</strong><small>计划开始</small></span><span><strong>{tonightStageCount}</strong><small>个阶段</small></span><span><strong>{draftEnergy}</strong><small>点能量</small></span></div>
        <div className="first-stage-confirm"><AppIcon name={stages[0]?.icon ?? "custom"} /><span><small>先从最容易开始的一步</small><strong>{stages[0]?.title}</strong><em>{formatPlanClock(stages[0]?.start ?? "", data.planStart, data.planEnd)}—{formatPlanClock(stages[0]?.end ?? "", data.planStart, data.planEnd)} · 完成 +{stages[0]?.energy} 能量</em></span><button onClick={() => back("plan")}>修改</button></div>
        <div className="family-agreement"><div><AppIcon name="family" /><span><strong>{data.guardianAlias}</strong><small>先给第一步留出空间</small></span></div><div><AppIcon name="home-heart" /><span><strong>{data.childAlias}</strong><small>卡住时可以主动说</small></span></div></div>
        <div className="privacy-note">时间表不是命令。中途换顺序、休息或移到明天，都不算失败。</div><div className="confirm-action-dock"><button className="primary-button" onClick={enterDualStart}>两个人一起点亮开始</button><small>下一步只需要两个人各点一下自己的名字</small></div>
      </div>}

      {screen === "dual-start" && <div className="screen dual-start-screen">
        <Header back={leaveDualStart} title="一起点亮" step="3/3" /><div className="dual-start-hero"><div><span className="eyebrow">可以同时点，也可以一个一个来</span><h1>两个人都准备好，<br />就一起开始</h1></div><Mascot mood={bothParticipantsReady ? "celebrate" : "ready"} compact /></div>
        <div className={`start-now-card ${startsAtPlannedTime ? "on-time" : "will-shift"}`}><AppIcon name={startsAtPlannedTime ? "check" : "alarm"} /><span><small>两个名字都亮起后</small><strong>{startsAtPlannedTime ? `按计划 ${startNowLabel} 开始` : `从现在 ${startNowLabel} 开始`}</strong><p>{startsAtPlannedTime ? "刚好到约定时间，直接进入第一项。" : "每一项保留原时长和间隔，整晚时间会一起顺延。"}</p></span></div>
        <div className="light-bridge" data-ready={bothParticipantsReady} />
        <div className="dual-press"><button aria-describedby="dual-start-status" aria-label={`${data.guardianAlias}${guardianConfirmed ? "已点亮，再点一次取消" : "点一下确认准备"}`} aria-pressed={guardianConfirmed} className={`press-zone guardian-zone ${guardianConfirmed ? "confirmed" : ""}`} onClick={() => toggleParticipant("guardian")}><span className="finger-tip"><small>{data.guardianAlias}</small></span><strong>{data.guardianAlias}</strong><small>{guardianConfirmed ? "✓ 已准备" : "点亮准备"}</small></button><button aria-describedby="dual-start-status" aria-label={`${data.childAlias}${childConfirmed ? "已点亮，再点一次取消" : "点一下确认准备"}`} aria-pressed={childConfirmed} className={`press-zone child-zone ${childConfirmed ? "confirmed" : ""}`} onClick={() => toggleParticipant("child")}><span className="finger-tip"><small>{data.childAlias}</small></span><strong>{data.childAlias}</strong><small>{childConfirmed ? "✓ 已准备" : "点亮准备"}</small></button></div>
        <div className={`launch-status ${bothParticipantsReady ? "is-launching" : ""}`}><div className="launch-status-copy" id="dual-start-status" role="status" aria-live="polite" aria-atomic="true"><strong>{dualStartStatus.title}</strong><small>{dualStartStatus.detail}</small></div>{bothParticipantsReady && <><button type="button" className="launch-cancel-button" onClick={cancelDualLaunch}>先等等</button><span className="launch-progress" aria-hidden="true"><i /></span></>}</div>
      </div>}

      {screen === "running" && <div className="screen running-screen">
        <Header title="今晚进行中" /><div className="running-hero"><span className="eyebrow">当前阶段 · {activeIndex + 1}/{stages.filter(s => s.status !== "tomorrow").length}</span><Mascot mood="breathe" compact /></div>
        {stageDue && <span className="sr-only" role="status">{activeStage.title}预计到时间了，可以完成、继续或调整。</span>}
        <div className={`active-stage-card ${stageDue ? "is-due" : ""}`}><AppIcon name={activeStage.icon} /><div><small>计划时间 {formatPlanClock(activeStage.start, data.planStart, data.planEnd)}—{formatPlanClock(activeStage.end, data.planStart, data.planEnd)}</small><h1>{activeStage.title}</h1><span className={`effort-pill effort-${activeStage.effort}`}>{activeStage.kind === "rest" ? "休息放松" : effortCopy[activeStage.effort]}</span><span className="active-energy">完成后 +{activeStage.energy} 能量</span></div><div className="stage-timer"><small>{stageDue ? "可以看看下一步了" : "距离柔和提醒"}</small><strong>{stageDue ? "到时间啦" : formatCountdown(remainingSeconds)}</strong><div><i style={{ width: `${Math.max(0, Math.min(100, remainingSeconds / Math.max(1, durationMinutes(activeStage.start, activeStage.end) * 60) * 100))}%` }} /></div></div></div>
        <div className="running-support-strip"><AppIcon name="privacy" /><span><strong>手机留在大人手里</strong><small>不记录坐姿、声音、人脸或是否一直在桌前</small></span></div>
        <div className="next-stage-preview"><span><small>这一段之后</small><strong>{nextPendingStage ? nextPendingStage.title : "就可以温和收尾"}</strong></span>{nextPendingStage && <time>{formatPlanClock(nextPendingStage.start, data.planStart, data.planEnd)}</time>}</div>
        <details className="timeline-disclosure"><summary><span><small>今晚进度 · 最晚 {formatPlanClock(data.planEnd, data.planStart, data.planEnd)} 收尾</small><strong>{completedStageCount}/{tonightStageCount} 个阶段已完成</strong></span><b>查看全部 <i>⌄</i></b></summary><div className="mini-timeline">{stages.map((stage, index) => <div key={stage.id} className={`${stage.status} ${index === activeIndex ? "now" : ""}`}><i /><span>{stage.title}</span><small>{stage.status === "done" ? "完成" : stage.status === "tomorrow" ? "明天" : formatPlanClock(stage.start, data.planStart, data.planEnd)}</small></div>)}</div></details>
        <div className={`running-action-dock ${stageDue ? "due-action-dock" : ""}`}>{stageDue ? <><div className="due-choice-copy"><strong>到时间只是提醒，不代表必须完成</strong><small>现在更适合哪一步，就选哪一步</small></div><button className="primary-button" onClick={stageFinished}>已经完成这一段</button><div className="due-quick-actions"><button className="secondary-button" onClick={extendCurrent}>{canStartRest ? "再继续 10 分钟" : "再休息 10 分钟"}</button>{canStartRest && <button className="soft-button" onClick={startRestNow}>先休息 10 分钟</button>}</div><button className="text-button" onClick={openAdjust}>更多调整</button></> : <><button className="primary-button" onClick={stageFinished}>提前完成这一阶段</button><button className="secondary-button adjust-button" onClick={openAdjust}>调整今晚计划</button></>}</div>
      </div>}

      {screen === "transition" && <div className={`screen transition-screen ${transitionReason}-transition`}>
        <div className="transition-hero"><div><span className="eyebrow">{transitionReason === "completed" ? "这一段完成了" : "阶段提醒 · 只提醒一次"}</span><h1>{transitionReason === "completed" ? `${activeStage.title}告一段落` : `${activeStage.title}预计到时间了`}</h1><p className="lead">{transitionReason === "completed" ? "先看见已经做到的，再决定下一步。" : "不用马上切换，看看现在更适合哪一步。"}</p></div><div className="transition-art"><AppIcon name={transitionReason === "completed" ? "check" : "moon"} /><Mascot mood={transitionReason === "completed" ? "celebrate" : "confirm"} compact /></div></div>
        <div className="transition-result"><AppIcon name={activeStage.icon} /><span><small>{transitionReason === "completed" ? "已经记下" : "当前阶段"}</small><strong>{activeStage.title}</strong><em>{transitionReason === "completed" ? `+${activeStage.energy} 家庭能量` : canStartRest ? "完成、继续或休息都可以" : "结束、延长或调整都可以"}</em></span></div>
        <div className="transition-next"><span><small>接下来</small><strong>{nextPendingStage ? nextPendingStage.title : "今晚温和收尾"}</strong></span>{nextPendingStage && <time>{formatPlanClock(nextPendingStage.start, data.planStart, data.planEnd)}</time>}</div>
        <div className="transition-actions"><button className="primary-button" onClick={continueToNext}>{hasNextPending ? `进入${nextPendingStage?.title ?? "下一阶段"}` : "进入今晚收尾"}</button><div><button className="secondary-button" onClick={extendCurrent}>{canStartRest ? (transitionReason === "completed" ? "还想继续 10 分钟" : "再继续 10 分钟") : "再休息 10 分钟"}</button>{canStartRest && <button className="soft-button" onClick={startRestNow}>先休息 10 分钟</button>}</div><button className="text-button" onClick={openAdjust}>调整今晚计划</button></div>
        <div className="privacy-note">{transitionReason === "completed" ? "提前完成不是必须；按自己的节奏走，也可以停下来调整。" : "只提醒这一次，不会连续催促。"}</div>
      </div>}

      {screen === "adjust" && <div className="screen adjust-screen">
        <Header back={() => go("running")} title="调整今晚" /><div className="title-with-mascot"><div><span className="eyebrow">计划服务于家庭，而不是反过来</span><h1>现在更适合怎么调整？</h1></div><Mascot mood="support" compact /></div>
        <div className="adjust-grid">{adjustmentOptions.map(({ id, icon, title, copy }) => <button key={id} aria-pressed={effectiveAdjustChoice === id} className={`${effectiveAdjustChoice === id ? "selected" : ""} ${id === "finish" ? "finish-choice" : ""}`} onClick={() => setAdjustChoice(id)}><AppIcon name={icon} /><span><strong>{title}</strong><small>{copy}</small></span></button>)}</div>
        <div className="change-preview"><small>本次调整预览</small><strong>{effectiveAdjustChoice === "extend" ? `${activeStage.title}${canStartRest ? "延长" : "再休息"}10分钟，最晚${addMinutes(data.planEnd, 10)}收尾` : effectiveAdjustChoice === "rest" ? `从现在休息10分钟，之后只继续剩余时长，约${restPlanPreview.planEnd}前收尾` : effectiveAdjustChoice === "swap" ? "调换后两项，并重新排好时间" : effectiveAdjustChoice === "tomorrow" ? "把下一项移到明天" : "保留已完成的部分，今晚温和收尾"}</strong></div>
        <div className="gentle-note">调整不会扣掉家庭能量，已经完成的进展会保留。</div><button className="primary-button" onClick={applyAdjustment}>{effectiveAdjustChoice === "finish" ? "确认并温和收尾" : "双方确认调整"}</button><button className="text-button" onClick={() => go("running")}>取消</button>
      </div>}

      {screen === "wrap" && <div className="screen wrap-screen">
        <Header title="今晚收尾" /><div className="wrap-hero"><div><span className="eyebrow">亲子一起 · 30 秒</span><h1>今晚，温和收尾</h1><p>完成多少不是评价；愿意一起停下来，也值得被记住。</p></div><Mascot mood="celebrate" compact /></div>
        <div className="wrap-summary"><div><strong>{stages.filter(s => s.status === "done").length}</strong><small>完成阶段</small></div><div><strong>{adjustments}</strong><small>主动调整</small></div><div className="energy-total"><strong>+{settlementTotalEnergy}</strong><small>待入账能量</small></div></div>
        <div className="energy-summary"><div><strong>结束后会这样记入</strong><small>能量属于家庭合作，不给孩子单独打分</small></div><span><b>完成事项</b><em>+{settlementTaskEnergy}</em></span><span className={settlementCooperationEnergy ? "" : "already-counted"}><b>{settlementCooperationEnergy ? "共同商量与收尾" : "共同收尾 · 本夜已记录"}</b><em>+{settlementCooperationEnergy}</em></span>{adjustments > 0 && <span className={settlementAdjustmentEnergy ? "" : "already-counted"}><b>{settlementAdjustmentEnergy ? "主动调整计划" : "主动调整 · 本夜已记录"}</b><em>+{settlementAdjustmentEnergy}</em></span>}</div>
        <fieldset className="prompt-reflection"><legend>只给大人记一笔</legend><strong>和你们平时相比，今晚催促感怎么样？</strong><div>{(["less", "same", "more"] as PromptReflection[]).map(value => <button type="button" key={value} aria-pressed={promptReflection === value} className={promptReflection === value ? "selected" : ""} onClick={() => setPromptReflection(current => current === value ? null : value)}>{({ less: "少一些", same: "差不多", more: "多一些" })[value]}</button>)}</div><small>可选，不影响能量，也不评价孩子。</small></fieldset>
        <div className="wrap-action-dock"><button className="primary-button" onClick={finishNight}>{settlementTotalEnergy ? "确认入账并结束今晚" : "确认记录并结束今晚"}</button>{hasDeferredStages && <button className="secondary-button wrap-resume-button" onClick={resumeTonightFromWrap}>还想继续今晚</button>}<small>{priorSettlementSessions.length ? "同一家庭夜晚，合作与调整能量只入账一次" : "未完成事项留到明天；不会扣掉已经获得的能量"}</small></div>
      </div>}

      {screen === "night-saved" && lastSavedSession && <div className="screen night-saved-screen">
        <div className="saved-hero"><div><span className="eyebrow">已安全记入家庭日历</span><h1>今晚的合作，<br />已经留下来了</h1><p>这不是成绩，也不要求连续打卡。</p></div><Mascot mood="celebrate" compact /></div>
        <div className="saved-energy"><small>本次家庭能量</small><strong>+{lastSavedSession.energyEarned}</strong><span>现在共有 {data.energy} 点</span><div className="energy-rise" aria-hidden="true"><i /><i /><i /></div></div>
        <div className="saved-breakdown"><span><b>完成事项</b><em>+{lastSavedSession.taskEnergy}</em></span><span className={lastSavedSession.cooperationEnergy ? "" : "already-counted"}><b>{lastSavedSession.cooperationEnergy ? "共同商量与收尾" : "共同收尾 · 本夜已记录"}</b><em>+{lastSavedSession.cooperationEnergy}</em></span>{lastSavedSession.adjustments > 0 && <span className={lastSavedSession.adjustmentEnergy ? "" : "already-counted"}><b>{lastSavedSession.adjustmentEnergy ? "主动调整计划" : "主动调整 · 本夜已记录"}</b><em>+{lastSavedSession.adjustmentEnergy}</em></span>}</div>
        <div className="saved-calendar-note"><AppIcon name="moon" /><span><strong>{new Date(lastSavedSession.date).toLocaleDateString("zh-CN", { month: "long", day: "numeric" })} · 今晚记录</strong><small>{lastSavedSession.completedCount} 个完成阶段{lastSavedSession.promptReflection ? ` · ${promptReflectionCopy[lastSavedSession.promptReflection]}` : " · 催促感可下次再记"}</small></span></div>
        <div className="saved-actions"><button className="primary-button" onClick={() => go("home")}>回到首页</button><button className="secondary-button" onClick={() => openNightRecord(lastSavedSession.nightKey)}>查看这一晚的记录</button></div>
      </div>}

      {screen === "energy" && <div className="screen with-nav energy-screen">
        <Header title="家庭能量房间" /><div className="room-scene"><img className="room-art" src={`/assets/energy-room-v3.jpg?v=${ASSET_VERSION}`} width="960" height="720" loading="eager" decoding="async" fetchPriority="high" alt="温暖的家庭学习角" /><div className="room-light" /><Mascot mood={goalReady ? "celebrate" : "ready"} /></div>
        <div className="energy-panel"><span className="eyebrow">共同积累，不给孩子打分</span><h1>{data.energy} 点家庭能量</h1>{goalState !== "empty" ? <div className="energy-bar"><i style={{ width: `${Math.min(100, data.energy / data.rewardGoal.threshold * 100)}%` }} /></div> : <p className="energy-fresh-copy">上一份期待已经留在日历里，这里是新的开始。</p>}</div>
        {goalState === "empty" ? <div className="empty-goal-card"><AppIcon name="home-heart" /><div><small>还没有新的家庭期待</small><strong>先想一段真正想一起度过的时光</strong><p>不是给孩子定奖品；由大人和孩子一起商量。</p></div></div> : <div className={`goal-card goal-${goalState}`}><AppIcon name={data.rewardGoal.icon} /><div><small>{goalState === "ready" ? "已经达到共同门槛" : `计划在${data.rewardGoal.date}`}</small><strong>{data.rewardGoal.title}</strong><p>{progress ? `还差${progress}点，一起积累，不用赶` : "已经点亮，等真正实现后再记录"}</p></div></div>}
        {goalState === "empty" ? <button className="primary-button" onClick={openRewardSetup}>一起定新的家庭期待</button> : goalState === "building" ? <button className="secondary-button" onClick={openRewardSetup}>一起调整这个期待</button> : <button className="primary-button" onClick={openRewardAchieved}>查看达成与兑现</button>}
        <div className="gentle-note">未完成或暂停不会倒扣、过期；一起兑现期待后，能量会从0重新积累。</div>
      </div>}

      {screen === "reward-setup" && <div className="screen reward-setup-screen">
        <Header back={() => back("energy")} title="家庭期待" step="一起商量" />
        <div className="reward-setup-hero"><div><span className="eyebrow">不是奖品清单</span><h1>想一起度过怎样的时光？</h1><p>先选家庭时光，再共同商量积累节奏。</p></div><Mascot mood="support" compact /></div>
        <section className="reward-step"><div className="reward-step-heading"><b>1</b><span><strong>先选想一起做的事</strong><small>优先选择陪伴和共同体验</small></span></div><div className="reward-idea-grid">{REWARD_IDEAS.map(idea => <button type="button" key={idea.label} aria-pressed={rewardDraft.title === idea.title} className={rewardDraft.title === idea.title ? "selected" : ""} onClick={() => setRewardDraft({ ...rewardDraft, icon: idea.icon, title: idea.title })}><AppIcon name={idea.icon} /><span><strong>{idea.label}</strong><small>{idea.title}</small></span></button>)}</div><label className="reward-compact-input"><span className="input-label-row"><span>也可以写下你们自己的想法</span><small>{rewardDraft.title.length}/24</small></span><input name="reward-title" aria-label="家庭期待" value={rewardDraft.title} placeholder="例如：周末一起去公园" maxLength={24} autoComplete="off" spellCheck={false} enterKeyHint="done" onChange={e => setRewardDraft({ ...rewardDraft, title: e.target.value })} /></label></section>
        <section className="reward-step"><div className="reward-step-heading"><b>2</b><span><strong>商量什么时候一起实现</strong><small>这是共同约定，不是限时任务</small></span></div><div className="reward-date-chips">{REWARD_DATE_IDEAS.map(date => <button type="button" key={date} aria-pressed={rewardDraft.date === date} className={rewardDraft.date === date ? "selected" : ""} onClick={() => setRewardDraft({ ...rewardDraft, date })}>{date}</button>)}</div><label className="reward-compact-input"><span className="input-label-row"><span>或自己写一个时间</span><small>{rewardDraft.date.length}/16</small></span><input name="reward-date" aria-label="期待实现时间" value={rewardDraft.date} placeholder="例如：下周六下午" maxLength={16} autoComplete="off" spellCheck={false} enterKeyHint="done" onChange={e => setRewardDraft({ ...rewardDraft, date: e.target.value })} /></label></section>
        <section className="reward-step energy-step"><div className="reward-step-heading"><b>3</b><span><strong>共同确认积累节奏</strong><small>能量是家庭合作的记号，不是价格</small></span></div><div className="energy-target-row"><button type="button" aria-label="减少5点目标能量" disabled={rewardDraft.threshold <= rewardMinimumThreshold} onClick={() => setRewardDraft({ ...rewardDraft, threshold: Math.max(rewardMinimumThreshold, rewardDraft.threshold - 5) })}>−</button><span><strong>{rewardDraft.threshold}</strong><small>点家庭能量</small></span><button type="button" aria-label="增加5点目标能量" disabled={rewardDraft.threshold >= rewardMaximumThreshold} onClick={() => setRewardDraft({ ...rewardDraft, threshold: Math.min(rewardMaximumThreshold, rewardDraft.threshold + 5) })}>＋</button></div><input className="energy-target-range branded-range" aria-label="家庭期待目标能量" aria-valuetext={`${rewardDraft.threshold}点家庭能量`} type="range" min={rewardMinimumThreshold} max={rewardMaximumThreshold} step="5" value={rewardDraft.threshold} style={{ "--range-progress": `${(rewardDraft.threshold - rewardMinimumThreshold) / Math.max(1, rewardMaximumThreshold - rewardMinimumThreshold) * 100}%` } as CSSProperties} onChange={e => setRewardDraft({ ...rewardDraft, threshold: Number(e.target.value) })} /><p>当前已有 {data.energy} 点；按每晚约 5–10 点估算，还需要约 {rewardEstimatedNights} 个家庭夜晚。可以随时调整。</p><label className="energy-confirm-check"><input type="checkbox" checked={rewardEnergyConfirmed} onChange={e => setRewardEnergyConfirmed(e.target.checked)} /><span><strong>{data.guardianAlias}和{data.childAlias}一起看过这个节奏</strong><small>这不是孩子单方面必须完成的目标</small></span></label></section>
        <div className="reward-preview"><AppIcon name={rewardDraft.icon} /><div><small>{rewardDraft.date || "还没定时间"} · {data.guardianAlias}和{data.childAlias}</small><strong>{rewardDraft.title.trim() || "一起写下家庭期待"}</strong><p>达到门槛不会自动清零，只有实际一起实现后才记录。</p></div></div>
        <div className="reward-boundary-note"><AppIcon name="home-heart" /><span><strong>尽量不设置现金、充值或高价商品</strong><small>家庭活动不需要与孩子的表现一一交换。</small></span></div>
        <div className="reward-save-dock"><button className="primary-button" disabled={!rewardDraftReady} onClick={saveRewardDraft}>{data.rewardGoal.redeemed ? "一起确认这个期待" : "保存共同调整"}</button><small>{!rewardDraftValid ? "先一起写下想做的事和时间" : !rewardEnergyConfirmed ? "还需要两个人一起确认能量节奏" : "保存后，家庭能量继续从当前数值积累"}</small></div>
      </div>}

      {screen === "reward-achieved" && <div className="screen achievement-screen">
        <Header title="家庭期待" back={keepRewardForLater} />
        <div className="achievement-hero"><div><span className="eyebrow">家庭期待已点亮</span><h1>一起积累到了</h1><p><strong>{data.energy}</strong> 点家庭能量</p></div><Mascot mood="celebrate" compact /></div>
        <div className="achievement-scene"><img src={`/assets/energy-room-v3.jpg?v=${ASSET_VERSION}`} width="960" height="720" loading="eager" decoding="async" fetchPriority="high" alt="点亮的家庭房间" /><span className="achievement-glow" /><AppIcon name={data.rewardGoal.icon} /></div>
        <div className="achievement-card"><AppIcon name={data.rewardGoal.icon} /><div><small>计划在{data.rewardGoal.date}</small><strong>{data.rewardGoal.title}</strong><p>{data.guardianAlias}和{data.childAlias}一起参与</p></div></div>
        <div className="achievement-boundary"><AppIcon name="home-heart" /><p><strong>达到门槛，不等于已经兑现</strong><span>这是一起期待的家庭时光，不是完成任务后必须支付的奖品。</span></p></div>
        {!redeemArmed ? <div className="achievement-actions"><button className="primary-button" onClick={() => setRedeemArmed(true)}>已经一起兑现了</button><button className="secondary-button" onClick={keepRewardForLater}>先保留能量，稍后兑现</button></div> : <div className="redeem-confirm" role="alert"><strong>确认已经一起兑现？</strong><p>“{data.rewardGoal.title}”会记入今天的家庭日历。当前 {data.energy} 点家庭能量将全部归零，再开始新的期待。</p><button className="primary-button" onClick={redeemReward}>确认已兑现并从0开始</button><button className="text-button" onClick={() => setRedeemArmed(false)}>返回再看看</button></div>}
      </div>}

      {screen === "reward-saved" && lastRedeemedReward && <div className="screen reward-saved-screen">
        <div className="reward-saved-hero"><div><span className="eyebrow">已安全记入家庭日历</span><h1>这份共同期待，<br />已经实现了</h1><p>能量从0重新积累，过去的家庭时光不会消失。</p></div><Mascot mood="celebrate" compact /></div>
        <div className="reward-saved-card"><AppIcon name={lastRedeemedReward.icon} /><div><small>{new Date(lastRedeemedReward.redeemedAt).toLocaleDateString("zh-CN", { month: "long", day: "numeric" })} · 已兑现</small><strong>{lastRedeemedReward.title}</strong><p>达到 {lastRedeemedReward.threshold} 点门槛 · 兑现时 {lastRedeemedReward.energyBeforeReset} 点归零</p></div></div>
        <div className="reset-story" aria-label="能量重新开始"><span><b>{lastRedeemedReward.energyBeforeReset}</b><small>兑现前</small></span><i>→</i><span className="fresh-zero"><b>0</b><small>新的开始</small></span></div>
        <div className="reward-saved-note"><AppIcon name="moon" /><p><strong>记录留在日历里</strong><span>以后可以一起回看，不需要连续打卡。</span></p></div>
        <div className="saved-actions"><button className="primary-button" onClick={openRewardSetup}>设置新的家庭期待</button><button className="secondary-button" onClick={() => { const day = localDateKey(lastRedeemedReward.redeemedAt); setSelectedDay(day); setDayDetailsExpanded(false); const date = new Date(lastRedeemedReward.redeemedAt); setCalendarCursor(new Date(date.getFullYear(), date.getMonth(), 1)); go("review"); }}>查看今天的记录</button></div>
      </div>}

      {screen === "review" && <div className="screen with-nav review-screen">
        <Header title="家庭日历" /><span className="eyebrow">每天收尾和家庭期待都会留在这里</span><div className="review-insight"><AppIcon name="quiet" /><div><small>本周复盘 · 不评价孩子</small><strong>{weeklyLessPromptNights ? `有${weeklyLessPromptNights}晚，催促感比平时少` : weeklyReflections.length ? `已记录${weeklyReflections.length}晚，先观察，不急着比较` : weeklyNights ? "收尾时可以给大人记一笔催促感" : "先从一个更容易开始的晚上观察"}</strong><p>{weeklyAdjustments ? `你们主动调整了${weeklyAdjustments}次，改变计划也算合作。` : "这里关注催促和合作，不用追求连续打卡。"}</p></div></div><div className="month-nav"><button onClick={() => shiftMonth(-1)} aria-label="上个月">‹</button><h1>{calendarYear}年{calendarMonth + 1}月</h1><button onClick={() => shiftMonth(1)} aria-label="下个月">›</button></div>
        <div className="calendar-legend"><span><i className="session-dot" />晚间记录</span><span><i className="reward-star">★</i>期待兑换</span></div>
          <div className="calendar-card"><div className="weekdays">{["日","一","二","三","四","五","六"].map(day => <b key={day}>{day}</b>)}</div><div className="calendar-grid">{Array.from({length:firstWeekday}).map((_,i) => <span className="blank-day" key={`blank-${i}`} />)}{Array.from({length:daysInMonth}).map((_,i) => { const day=i+1; const date=new Date(calendarYear,calendarMonth,day); const key=date.toLocaleDateString("en-CA"); const hasSession=data.sessions.some(item => item.nightKey===key); const hasReward=data.rewardHistory.some(item => localDateKey(item.redeemedAt)===key); return <button aria-pressed={selectedDay === key} aria-label={`${calendarMonth + 1}月${day}日${hasSession ? "，有晚间记录" : ""}${hasReward ? "，有期待兑换" : ""}`} key={key} className={`${selectedDay===key ? "selected" : ""} ${hasSession ? "has-session" : ""} ${hasReward ? "has-reward" : ""}`} onClick={() => { setSelectedDay(key); setDayDetailsExpanded(false); }}><strong>{day}</strong><span>{hasSession && <i />} {hasReward && <b>★</b>}</span></button>; })}</div></div>
        <div className="day-detail">
          <div className="day-detail-header"><div><small>家庭夜晚</small><strong>{selectedDateLabel}</strong></div>{selectedSessionSummary && <span>{selectedSessionSummary.settlements} 次收尾</span>}</div>
          {!selectedSessions.length && !selectedRewards.length ? <div className="empty-day"><Mascot mood="breathe" compact /><span>这一天还没有记录</span></div> : <>
            {selectedSessionSummary && <section className="daily-summary"><div className="daily-summary-title"><AppIcon name="moon" /><div><strong>{selectedSessionSummary.settlements > 1 ? `这一晚分${selectedSessionSummary.settlements}次留下记录` : selectedSessionSummary.completed ? `这一晚完成了${selectedSessionSummary.completed}个阶段` : "这一晚选择了温和收尾"}</strong><small>先看整体，不用逐条比较每一次。</small></div></div><div className="daily-summary-stats"><span><b>{selectedSessionSummary.completed}</b><small>完成阶段</small></span><span><b>{selectedSessionSummary.adjustments}</b><small>主动调整</small></span><span><b>+{selectedSessionSummary.energy}</b><small>家庭能量</small></span></div><div className="daily-summary-note"><strong>{selectedSessionSummary.reflection ? promptReflectionCopy[selectedSessionSummary.reflection] : "催促感还没有记录"}</strong><span>{selectedSessionSummary.stageTitles.length ? `这一晚做过：${selectedSessionSummary.stageTitles.join("、")}` : "没有完成事项也可以收尾；记录不会评价孩子。"}</span></div></section>}
            {selectedRewards.map(item => <div className="history-row reward-history reward-highlight" key={item.id}><AppIcon name={item.icon} /><div><small>共同期待已经实现</small><strong>{item.title}</strong><p>达到 {item.threshold} 点门槛 · 兑现时 {item.energyBeforeReset} 点归零</p></div></div>)}
            {selectedSessions.length > 0 && <button className="day-details-toggle" aria-expanded={dayDetailsExpanded} aria-controls="day-session-details" onClick={() => setDayDetailsExpanded(value => !value)}><span>{dayDetailsExpanded ? "收起单次明细" : `查看${selectedSessions.length}次收尾明细`}</span><b>{dayDetailsExpanded ? "⌃" : "⌄"}</b></button>}
            {dayDetailsExpanded && <div id="day-session-details" className="day-session-details">{selectedSessions.map(item => <div className="history-row" key={item.id}><AppIcon name="check" /><div><strong>{new Date(item.date).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })} · {item.completedCount ? `完成${item.completedCount}个阶段` : "温和收尾"}</strong><small>家庭能量 +{item.energyEarned}{item.promptReflection ? ` · ${promptReflectionCopy[item.promptReflection]}` : ""}</small><div className="history-energy"><span>事项 +{item.taskEnergy}</span><span>合作 +{item.cooperationEnergy}</span>{item.adjustmentEnergy > 0 && <span>调整 +{item.adjustmentEnergy}</span>}</div><p>{item.stageTitles.join("、") || "未完成事项已留到明天"}</p></div></div>)}</div>}
          </>}
        </div>
        {metrics && <div className="metric-grid compact-metrics"><div><AppIcon name="moon" /><small>本月记录</small><strong>{metrics.nights}晚</strong></div><div><AppIcon name="speech" /><small>主动调整</small><strong>{metrics.adjustments}次</strong></div><div><AppIcon name="quiet" /><small>少催反馈</small><strong>{metrics.lessPromptNights}晚</strong></div></div>}
        <section className="one-change-card"><div className="one-change-heading"><span><AppIcon name={reviewSuggestion.icon} /></span><div><small>规则建议 · 不评价孩子</small><h2>接下来只试一个小变化</h2></div></div><strong className="one-change-text">{reviewSuggestion.text}</strong><p>{reviewSuggestion.evidence}</p><div className="rule-transparency"><b>建议怎么来的</b><span>只使用本周收尾次数、主动调整和大人的催促感记录；不分析孩子身份或能力。</span></div><button aria-pressed={currentWeekFocus?.text === reviewSuggestion.text} className={currentWeekFocus?.text === reviewSuggestion.text ? "saved" : ""} onClick={toggleWeeklyFocus}>{currentWeekFocus?.text === reviewSuggestion.text ? "已放到首页 · 点击移除" : "这周就试这一件"}</button></section>
      </div>}

      {screen === "settings" && <div className="screen with-nav settings-screen">
        <Header title="设置" /><div className="settings-group"><h2>家庭称呼</h2><div className="setting-row"><span>孩子化名</span><strong>{data.childAlias}</strong></div><div className="setting-row"><span>大人称呼</span><strong>{data.guardianAlias}</strong></div><div className="setting-row"><span>安排方式</span><strong>{modeLabel}</strong></div><button className="setting-action" onClick={() => openProfile("settings")}>修改家庭设置 <span>›</span></button></div>
        <div className="settings-group"><h2>提醒与动效</h2><label className="toggle-row"><span><strong>温和提示音</strong><small>确认、阶段转换和收尾</small></span><input type="checkbox" checked={data.sound} onChange={e => persist({ ...data, sound: e.target.checked })} /></label><label className="toggle-row reminder-toggle"><span><strong>页面在后台时提醒</strong><small>由家长主动授权，不连续催促</small></span><input type="checkbox" checked={backgroundReminder && notificationPermission === "granted"} disabled={notificationPermission === "unsupported"} aria-describedby="background-reminder-status" onChange={e => void changeBackgroundReminder(e.target.checked)} /></label><div id="background-reminder-status" className={`permission-note permission-${notificationPermission}`}><AppIcon name={notificationPermission === "granted" && backgroundReminder ? "check" : "alarm"} /><span><strong>{notificationPermission === "granted" && backgroundReminder ? "后台提醒已就绪" : "后台提醒说明"}</strong><small>{backgroundReminderStatus}</small></span></div><label className="toggle-row"><span><strong>减少动态效果</strong><small>关闭呼吸、漂浮和庆祝动画；也会跟随系统设置</small></span><input type="checkbox" checked={data.reducedMotion} onChange={e => persist({ ...data, reducedMotion: e.target.checked })} /></label></div>
        <div className="settings-group"><h2>隐私与数据</h2><div className="setting-row"><span>未收集年级和学校</span><strong>已启用</strong></div><div className="setting-row"><span>数据状态</span><strong>{syncLabel}</strong></div>{pendingCloudDeletion && <div className="pending-delete-note" role="status"><AppIcon name="alarm" /><span><strong>云端副本等待清理</strong><small>只暂存随机家庭 ID；联网后自动重试，不包含孩子资料。</small></span></div>}<button className="setting-action" onClick={() => openPrivacy("settings")}>查看隐私与数据说明 <span>›</span></button><button className="setting-action" onClick={exportData}>导出家庭数据 <span>›</span></button><button className="setting-action danger" disabled={deletingData} onClick={requestDeleteData}>{deletingData ? "正在删除本机与云端数据…" : "删除孩子全部数据"} <span>{deletingData ? "" : "›"}</span></button></div>
        <button className="risk-entry" onClick={() => go("risk")}><AppIcon name="privacy" /><div><strong>有些情况，需要更多支持</strong><small>查看风险提示与转介建议</small></div><span>›</span></button>
      </div>}

      {screen === "risk" && <div className="screen risk-screen"><Header back={() => back("settings")} /><span className="eyebrow">风险边界</span><h1>有些情况，需要更多支持</h1><p className="lead">这个工具不做诊断，也不能替代专业评估。</p><div className="risk-list"><div><AppIcon name="home-heart" /><strong>困难长期存在于家庭和学校多个场景</strong></div><div><AppIcon name="moon" /><strong>持续拒学或明显躯体不适</strong></div><div><AppIcon name="privacy" /><strong>严重情绪变化或自伤表达</strong></div></div><div className="next-actions"><h2>接下来可以</h2><button onClick={() => setToast("今晚流程已暂停")}>1　先暂停今晚流程</button><button onClick={() => setToast("建议记录事实后联系老师")}>2　联系学校老师</button><button onClick={() => setToast("请选择正规医疗机构")}>3　寻找正规医疗机构</button></div><div className="urgent-note"><strong>存在立即安全风险时</strong><p>请优先联系当地急救或警方，并让可信任的成年人陪在孩子身边。</p></div></div>}

      {(["home", "review", "energy", "settings"] as Screen[]).includes(screen) && <BottomNav screen={screen} go={go} />}
      {deletedStage && <div className="undo-toast" role="status"><span>已移除“{deletedStage.stage.title}”</span><button onClick={undoRemoveStage}>撤销</button></div>}
      {shiftedPlanUndo && <div className="undo-toast" role="status"><span>{shiftedPlanUndo.message}</span><button onClick={undoPlanShift}>撤销</button></div>}
      {toast && <div className="toast" role="status">{toast}</div>}
    </section>
    {deleteArmed && <div className="destructive-dialog-backdrop"><section className="destructive-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-dialog-title" aria-describedby="delete-dialog-description"><span className="destructive-dialog-icon"><AppIcon name="privacy" /></span><small>不可撤销的操作</small><h2 id="delete-dialog-title">删除这个家庭的全部数据？</h2><p id="delete-dialog-description">将清除家庭化名、今晚计划、日历记录、能量和期待；本机立即删除，云端副本会同步清理。</p><div className="destructive-dialog-actions"><button ref={deleteCancelRef} className="secondary-button" disabled={deletingData} onClick={cancelDeleteData}>取消，保留数据</button><button ref={deleteConfirmRef} className="danger-confirm-button" disabled={deletingData} onClick={() => void deleteData()}>{deletingData ? "正在删除…" : "确认永久删除"}</button></div></section></div>}
    <aside className="desktop-note" aria-hidden={deleteArmed || undefined} inert={deleteArmed || undefined}><span className="brand-mark"><AppIcon name="home-heart" /><strong>先开始</strong></span><h2>今晚少催一次，从共同商量开始。</h2><p>共同排时间、双人点亮、阶段柔和提醒，计划随时可以改。</p><div className="desktop-points"><span>不讲题</span><span>不监控</span><span>不比较</span></div></aside>
  </main>;
}
