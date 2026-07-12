"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { addMinutes, analyzePlan, durationMinutes, reflowTimedItemsFrom, shiftTimedItemsFrom } from "./plan-utils";

type Effort = 1 | 2 | 3;
type StageStatus = "pending" | "active" | "done" | "tomorrow";
type PlanningMode = "adult" | "together" | "child";
type PromptReflection = "less" | "same" | "more";
type TransitionReason = "completed" | "due";
type Screen = "welcome" | "privacy" | "profile" | "home" | "plan" | "icon-picker" | "effort" | "confirm" | "dual-start" | "running" | "transition" | "adjust" | "wrap" | "energy" | "reward-setup" | "reward-achieved" | "review" | "settings" | "risk";
type LiveScreen = "running" | "transition" | "adjust" | "wrap";

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
  date: string;
  participants: string[];
  redeemed: boolean;
};

type SessionRecord = {
  id: string;
  date: string;
  stageCount: number;
  completedCount: number;
  adjustments: number;
  childEnergy: number;
  guardianEnergy: number;
  energyEarned: number;
  stageTitles: string[];
  promptReflection: PromptReflection | null;
};

type RewardHistory = { id: string; title: string; threshold: number; redeemedAt: string };
type PlanDraft = { updatedAt: string; planStart: string; planEnd: string; stages: Stage[] };
type LiveSessionDraft = { updatedAt: string; screen: LiveScreen; stages: Stage[]; activeIndex: number; adjustments: number; activeEndsAt: number; stageDue: boolean; promptReflection: PromptReflection | null; transitionReason: TransitionReason };

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
};

const STORAGE_KEY = "xian-kaishi-family-v2";
const PLAN_DRAFT_KEY = "xian-kaishi-plan-draft-v1";
const LIVE_SESSION_KEY = "xian-kaishi-live-session-v1";
const LIVE_SCREENS: LiveScreen[] = ["running", "transition", "adjust", "wrap"];

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
  rewardGoal: { threshold: 30, title: "周末一起玩桌游", date: "周六", participants: ["妈妈", "小橙"], redeemed: false },
  rewardHistory: [],
  sessions: [],
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
      id: String(item.id || createId("stage")), title: String(item.title ?? "新事项").slice(0, 24),
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

function AppIcon({ name, className = "" }: { name: string; className?: string }) {
  return <img className={`app-icon ${className}`} src={`/assets/icons/${name}.png`} alt="" aria-hidden="true" />;
}

function Mascot({ mood = "ready", compact = false }: { mood?: "ready" | "confirm" | "breathe" | "support" | "celebrate"; compact?: boolean }) {
  return <div className={`mascot mascot-${mood} ${compact ? "mascot-compact" : ""}`} aria-hidden="true">
    <div className="mascot-halo" />
    <img className="mascot-pose" src={`/assets/mascot/${mood}.png`} alt="" />
    {mood === "ready" && <img className="mascot-pose mascot-blink-frame" src="/assets/mascot/blink.png" alt="" />}
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
  const goal = old.rewardGoal && typeof old.rewardGoal === "object" ? old.rewardGoal as RewardGoal : DEFAULT_DATA.rewardGoal;
  const sessions = Array.isArray(old.sessions) ? old.sessions.map((item, index) => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const legacyTasks = Array.isArray(record.tasks) ? record.tasks.length : 0;
    return {
      id: String(record.id ?? `legacy-${index}`), date: String(record.date ?? new Date().toISOString()),
      stageCount: Number(record.stageCount ?? legacyTasks), completedCount: Number(record.completedCount ?? legacyTasks),
      adjustments: Number(record.adjustments ?? 0), childEnergy: Number(record.childEnergy ?? 0), guardianEnergy: Number(record.guardianEnergy ?? record.parentEnergy ?? 0),
      energyEarned: Number(record.energyEarned ?? (Number(record.childEnergy ?? 0) + Number(record.guardianEnergy ?? record.parentEnergy ?? 0))),
      stageTitles: Array.isArray(record.stageTitles) ? record.stageTitles.map(String) : Array.isArray(record.tasks) ? record.tasks.map(String) : [],
      promptReflection: normalizePromptReflection(record.promptReflection),
    } satisfies SessionRecord;
  }) : [];
  return {
    consent: Boolean(old.consent ?? DEFAULT_DATA.consent), childAlias, guardianAlias,
    planningMode: old.planningMode === "adult" || old.planningMode === "child" || old.planningMode === "together" ? old.planningMode : DEFAULT_DATA.planningMode,
    arrival: String(old.arrival ?? DEFAULT_DATA.arrival), planStart: String(old.planStart ?? DEFAULT_DATA.planStart), planEnd: String(old.planEnd ?? DEFAULT_DATA.planEnd), energy: Number(old.energy ?? DEFAULT_DATA.energy),
    sound: typeof old.sound === "boolean" ? old.sound : DEFAULT_DATA.sound,
    reducedMotion: typeof old.reducedMotion === "boolean" ? old.reducedMotion : DEFAULT_DATA.reducedMotion,
    rewardGoal: { ...DEFAULT_DATA.rewardGoal, ...goal, participants: [guardianAlias, childAlias] },
    rewardHistory: Array.isArray(old.rewardHistory) ? old.rewardHistory as RewardHistory[] : [], sessions,
  };
}

export function StartApp() {
  const [data, setData] = useState(DEFAULT_DATA);
  const [familyId, setFamilyId] = useState("");
  const [screen, setScreen] = useState<Screen>("welcome");
  const [consent, setConsent] = useState(false);
  const [stages, setStages] = useState<Stage[]>(DEFAULT_STAGES);
  const [editingStageId, setEditingStageId] = useState(DEFAULT_STAGES[1].id);
  const [activeIndex, setActiveIndex] = useState(0);
  const [adjustments, setAdjustments] = useState(0);
  const [adjustChoice, setAdjustChoice] = useState<"extend" | "rest" | "swap" | "tomorrow" | "finish">("extend");
  const [guardianConfirmed, setGuardianConfirmed] = useState(false);
  const [childConfirmed, setChildConfirmed] = useState(false);
  const [selectedDay, setSelectedDay] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [calendarCursor, setCalendarCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [toast, setToast] = useState("");
  const [syncLabel, setSyncLabel] = useState("本机已保存");
  const [activeEndsAt, setActiveEndsAt] = useState(0);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [stageDue, setStageDue] = useState(false);
  const [planHydrated, setPlanHydrated] = useState(false);
  const [draftUpdatedAt, setDraftUpdatedAt] = useState("");
  const [clearPlanArmed, setClearPlanArmed] = useState(false);
  const [liveSessionAvailable, setLiveSessionAvailable] = useState(false);
  const [liveResumeScreen, setLiveResumeScreen] = useState<LiveScreen>("running");
  const [privacyReturn, setPrivacyReturn] = useState<"welcome" | "settings">("welcome");
  const [profileReturn, setProfileReturn] = useState<"welcome" | "settings">("welcome");
  const [deletedStage, setDeletedStage] = useState<{ stage: Stage; index: number } | null>(null);
  const [promptReflection, setPromptReflection] = useState<PromptReflection | null>(null);
  const [transitionReason, setTransitionReason] = useState<TransitionReason>("completed");
  const dueReminderPlayed = useRef(false);
  const phoneShellRef = useRef<HTMLElement>(null);
  const clearPlanDeadline = useRef(0);

  const go = (next: Screen) => {
    if (LIVE_SCREENS.includes(next as LiveScreen)) { setLiveResumeScreen(next as LiveScreen); setLiveSessionAvailable(true); }
    setScreen(next);
    phoneShellRef.current?.scrollTo({ top: 0, behavior: "auto" });
    window.requestAnimationFrame(() => {
      const heading = phoneShellRef.current?.querySelector<HTMLElement>("[data-screen-heading], h1");
      if (!heading) return;
      if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    });
  };

  const openPrivacy = (from: "welcome" | "settings") => { setPrivacyReturn(from); go("privacy"); };
  const openProfile = (from: "welcome" | "settings") => { setProfileReturn(from); go("profile"); };
  const openAdjust = () => { setAdjustChoice("extend"); go("adjust"); };

  useEffect(() => {
    const timer = window.setTimeout(() => {
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
      if (localLive) {
        try {
          const live = JSON.parse(localLive) as Partial<LiveSessionDraft>;
          const updatedAt = new Date(String(live.updatedAt)).getTime();
          const fresh = Number.isFinite(updatedAt) && Date.now() - updatedAt < 18 * 60 * 60 * 1000;
          const liveStages = normalizeStages(live.stages, true);
          const savedScreen = LIVE_SCREENS.includes(live.screen as LiveScreen) ? live.screen as LiveScreen : "running";
          if (fresh && liveStages.length) {
            setStages(liveStages); setActiveIndex(Math.max(0, Math.min(liveStages.length - 1, Number(live.activeIndex) || 0)));
            setAdjustments(Math.max(0, Number(live.adjustments) || 0)); setActiveEndsAt(Math.max(0, Number(live.activeEndsAt) || 0));
            setStageDue(Boolean(live.stageDue)); setTransitionReason(normalizeTransitionReason(live.transitionReason, Boolean(live.stageDue))); setPromptReflection(normalizePromptReflection(live.promptReflection)); setLiveResumeScreen(savedScreen); setLiveSessionAvailable(true);
          } else localStorage.removeItem(LIVE_SESSION_KEY);
        } catch { localStorage.removeItem(LIVE_SESSION_KEY); }
      }
      const withDraftWindow = (next: AppData): AppData => ({
        ...next,
        planStart: /^\d{2}:\d{2}$/.test(String(parsedDraft?.planStart)) ? String(parsedDraft?.planStart) : next.planStart,
        planEnd: /^\d{2}:\d{2}$/.test(String(parsedDraft?.planEnd)) ? String(parsedDraft?.planEnd) : next.planEnd,
      });
      const local = localStorage.getItem(STORAGE_KEY) || localStorage.getItem("xian-kaishi-family-v1");
      if (local) {
        try {
          const next = withDraftWindow(normalizeData(JSON.parse(local)));
          setData(next); setConsent(next.consent); setScreen(next.consent ? "home" : "welcome");
        } catch { /* keep safe defaults */ }
      }
      setPlanHydrated(true);
      fetch(`/api/state?familyId=${encodeURIComponent(id)}`).then(r => r.json()).then(result => {
        if (result.data) {
          const next = withDraftWindow(normalizeData(result.data));
          setData(next); setConsent(next.consent); setScreen(next.consent ? "home" : "welcome");
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); setSyncLabel("云端已同步");
        }
      }).catch(() => setSyncLabel("仅保存在本机"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!planHydrated) return;
    const timer = window.setTimeout(() => {
      const updatedAt = new Date().toISOString();
      const safeStages = stages.map(item => ({ ...item, status: "pending" as const }));
      localStorage.setItem(PLAN_DRAFT_KEY, JSON.stringify({ updatedAt, planStart: data.planStart, planEnd: data.planEnd, stages: safeStages } satisfies PlanDraft));
      setDraftUpdatedAt(updatedAt);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [data.planEnd, data.planStart, planHydrated, stages]);

  useEffect(() => {
    if (!planHydrated || !LIVE_SCREENS.includes(screen as LiveScreen) || !stages.length) return;
    const updatedAt = new Date().toISOString();
    const liveScreen = screen as LiveScreen;
    localStorage.setItem(LIVE_SESSION_KEY, JSON.stringify({ updatedAt, screen: liveScreen, stages, activeIndex, adjustments, activeEndsAt, stageDue, promptReflection, transitionReason } satisfies LiveSessionDraft));
  }, [activeEndsAt, activeIndex, adjustments, planHydrated, promptReflection, screen, stageDue, stages, transitionReason]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!deletedStage) return;
    const timer = window.setTimeout(() => setDeletedStage(null), 8000);
    return () => window.clearTimeout(timer);
  }, [deletedStage]);

  const persist = (next: AppData, message?: string) => {
    const activeFamilyId = familyId || createId("family");
    if (!familyId) { localStorage.setItem("xian-kaishi-family-id", activeFamilyId); setFamilyId(activeFamilyId); }
    setData(next); localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); setSyncLabel("正在保存…");
    if (message) setToast(message);
    fetch(`/api/state?familyId=${encodeURIComponent(activeFamilyId)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(next) })
      .then(r => r.json()).then(result => setSyncLabel(result.localOnly ? "仅保存在本机" : "云端已同步")).catch(() => setSyncLabel("仅保存在本机"));
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
    const next = { ...data, consent: true, rewardGoal: { ...data.rewardGoal, participants: [data.guardianAlias, data.childAlias] } };
    setPlanHydrated(true); persist(next, "家庭称呼已保存"); playTone("confirm"); go(profileReturn === "settings" ? "settings" : "home");
  };

  const addStage = () => {
    const lastEnd = stages.at(-1)?.end ?? data.planStart;
    const id = createId("stage");
    setStages(items => [...items, { id, title: "新事项", icon: "custom", start: lastEnd, end: addMinutes(lastEnd, 20), effort: 1, energy: 1, status: "pending", kind: "task" }]);
    setEditingStageId(id);
  };

  const updateStage = (id: string, patch: Partial<Stage>) => setStages(items => items.map(item => item.id === id ? { ...item, ...patch } : item));
  const removeStage = (stage: Stage, index: number) => {
    setStages(items => items.filter(item => item.id !== stage.id));
    setDeletedStage({ stage, index });
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
    clearPlanDeadline.current = 0; setStages([]); setClearPlanArmed(false); setToast("今晚已从空白开始");
  };
  const moveStage = (index: number, delta: -1 | 1) => {
    const target = index + delta; if (target < 0 || target >= stages.length) return;
    const next = [...stages]; [next[index], next[target]] = [next[target], next[index]];
    setStages(reflowTimedItemsFrom(next, 0, data.planStart));
  };

  const startPlan = () => {
    setStages(items => items.map((item, index) => ({ ...item, status: index === 0 ? "active" : "pending" })));
    const firstDuration = Math.max(1, durationMinutes(stages[0]?.start ?? data.planStart, stages[0]?.end ?? addMinutes(data.planStart, 1)));
    setActiveEndsAt(Date.now() + firstDuration * 60_000); setClockNow(Date.now()); setStageDue(false); dueReminderPlayed.current = false;
    setActiveIndex(0); setAdjustments(0); setPromptReflection(null); setTransitionReason("completed"); setGuardianConfirmed(false); setChildConfirmed(false); playTone("confirm"); go("running");
  };

  useEffect(() => {
    if (screen === "dual-start" && guardianConfirmed && childConfirmed) {
      const timer = window.setTimeout(startPlan, 650); return () => window.clearTimeout(timer);
    }
    // startPlan intentionally reads the latest plan only after both confirmations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guardianConfirmed, childConfirmed, screen]);

  const activeStage = stages[activeIndex] ?? stages[0];
  const nextPendingIndex = (from: number) => stages.findIndex((item, index) => index > from && item.status === "pending");
  const hasNextPending = nextPendingIndex(activeIndex) >= 0;
  const remainingSeconds = activeEndsAt ? Math.max(0, Math.ceil((activeEndsAt - clockNow) / 1000)) : 0;

  useEffect(() => {
    if (screen !== "running" || !activeEndsAt) return;
    const tick = () => {
      const now = Date.now(); setClockNow(now);
      if (now >= activeEndsAt && !dueReminderPlayed.current) {
        dueReminderPlayed.current = true; setStageDue(true); playTone("transition"); navigator.vibrate?.([25, 35, 25]);
      }
    };
    tick(); const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
    // playTone uses the latest experience preference; the interval is recreated for each stage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, activeEndsAt]);

  const stageFinished = () => {
    setTransitionReason(stageDue ? "due" : "completed");
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
    setStages(items => shiftTimedItemsFrom(items, activeIndex + 1, 10).map((item, index) => index === activeIndex ? { ...item, end: addMinutes(item.end, 10), status: "active" } : item));
    setActiveEndsAt(value => restartFromNow ? Date.now() + 10 * 60_000 : Math.max(value, Date.now()) + 10 * 60_000); setClockNow(Date.now()); setStageDue(false); dueReminderPlayed.current = false;
    setAdjustments(value => value + 1); setToast("当前阶段和后续时间都顺延了10分钟"); go("running");
  };

  const startRestNow = () => {
    const insertAt = activeStage.status === "done" ? activeIndex + 1 : activeIndex;
    const start = activeStage.status === "done" ? activeStage.end : activeStage.start;
    const rest: Stage = { id: createId("rest"), title: "安静休息", icon: "quiet", start, end: addMinutes(start, 10), effort: 1, energy: 1, status: "active", kind: "rest" };
    setStages(items => {
      const shifted = shiftTimedItemsFrom(items, insertAt, 10).map((item, index) => index === activeIndex && item.status === "active" ? { ...item, status: "pending" as const } : item);
      return [...shifted.slice(0, insertAt), rest, ...shifted.slice(insertAt)];
    });
    setActiveIndex(insertAt); setActiveEndsAt(Date.now() + 10 * 60_000); setClockNow(Date.now()); setStageDue(false); dueReminderPlayed.current = false;
    setAdjustments(value => value + 1); setToast("现在休息10分钟，后续时间已顺延"); go("running");
  };

  const applyAdjustment = () => {
    if (adjustChoice === "finish") { endTonightEarly(); return; }
    if (adjustChoice === "extend") { extendCurrent(); return; }
    if (adjustChoice === "rest") { startRestNow(); return; }
    if (adjustChoice === "swap") {
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
    setStages(items => items.map(item => item.status === "done" ? item : { ...item, status: "tomorrow" }));
    setAdjustments(value => value + 1); setToast("已保留进展，今晚先到这里"); go("wrap");
  };

  const resumeTonightFromWrap = () => {
    const nextIndex = stages.findIndex(item => item.status === "tomorrow");
    if (nextIndex < 0) return;
    const resumedStage = stages[nextIndex];
    setStages(items => items.map((item, index) => item.status === "done" ? item : { ...item, status: index === nextIndex ? "active" : "pending" }));
    setActiveIndex(nextIndex); setActiveEndsAt(Date.now() + Math.max(1, durationMinutes(resumedStage.start, resumedStage.end)) * 60_000);
    setClockNow(Date.now()); setStageDue(false); dueReminderPlayed.current = false; setToast("已回到今晚，继续也来得及"); go("running");
  };

  const finishNight = () => {
    const completedCount = stages.filter(item => item.status === "done").length;
    const childEnergy = stages.filter(item => item.status === "done").reduce((sum, item) => sum + item.energy, 0);
    const guardianEnergy = 2; const adjustmentEnergy = adjustments ? 1 : 0;
    const nextEnergy = data.energy + childEnergy + guardianEnergy + adjustmentEnergy;
    const record: SessionRecord = { id: createId("session"), date: new Date().toISOString(), stageCount: stages.length, completedCount, adjustments, childEnergy, guardianEnergy, energyEarned: childEnergy + guardianEnergy + adjustmentEnergy, stageTitles: stages.filter(item => item.status === "done").map(item => item.title), promptReflection };
    const next = { ...data, energy: nextEnergy, sessions: [record, ...data.sessions].slice(0, 60) };
    localStorage.removeItem(LIVE_SESSION_KEY); setLiveSessionAvailable(false);
    persist(next, "今晚已经温和收尾"); playTone("complete");
    if (!next.rewardGoal.redeemed && nextEnergy >= next.rewardGoal.threshold) go("reward-achieved"); else go("home");
  };

  const redeemReward = () => {
    const redeemedAt = new Date().toISOString();
    const history: RewardHistory = { id: createId("reward"), title: data.rewardGoal.title, threshold: data.rewardGoal.threshold, redeemedAt };
    const next: AppData = {
      ...data, energy: 0, rewardHistory: [history, ...data.rewardHistory].slice(0, 60),
      rewardGoal: { threshold: 20, title: "新的家庭期待", date: "周六", participants: [data.guardianAlias, data.childAlias], redeemed: true },
    };
    persist(next, "已经记录，家庭能量从0重新积累"); go("energy");
  };

  const exportData = () => {
    const planDraft: PlanDraft = { updatedAt: draftUpdatedAt || new Date().toISOString(), planStart: data.planStart, planEnd: data.planEnd, stages: stages.map(item => ({ ...item, status: "pending" })) };
    const activeSession: LiveSessionDraft | null = liveSessionAvailable ? { updatedAt: new Date().toISOString(), screen: liveResumeScreen, stages, activeIndex, adjustments, activeEndsAt, stageDue, promptReflection, transitionReason } : null;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), family: data, planDraft, activeSession }, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "先开始-家庭数据.json"; a.click(); URL.revokeObjectURL(url); setToast("家庭数据已导出");
  };

  const deleteData = async () => {
    if (!window.confirm("确定删除孩子全部数据吗？此操作无法撤销。")) return;
    if (familyId) await fetch(`/api/state?familyId=${encodeURIComponent(familyId)}`, { method: "DELETE" }).catch(() => null);
    localStorage.removeItem(STORAGE_KEY); localStorage.removeItem("xian-kaishi-family-v1"); localStorage.removeItem(PLAN_DRAFT_KEY); localStorage.removeItem(LIVE_SESSION_KEY); localStorage.removeItem("xian-kaishi-family-id"); setPlanHydrated(false); setFamilyId(""); setData(DEFAULT_DATA); setConsent(false); setStages(DEFAULT_STAGES); setDraftUpdatedAt(""); setPromptReflection(null); setLiveSessionAvailable(false); go("welcome");
  };

  const modeLabel = { adult: "大人先安排", together: "一起安排", child: "孩子先安排" }[data.planningMode];
  const effortCopy = { 1: "一小步", 2: "需要专注", 3: "今天比较费力" } as const;
  const promptReflectionCopy: Record<PromptReflection, string> = { less: "催促感少一些", same: "和往常差不多", more: "催促感多一些" };
  const progress = Math.max(0, data.rewardGoal.threshold - data.energy);
  const goalReady = !data.rewardGoal.redeemed && progress === 0;
  const hasDeferredStages = stages.some(item => item.status === "tomorrow");
  const monthStart = calendarCursor;
  const calendarYear = monthStart.getFullYear(); const calendarMonth = monthStart.getMonth();
  const firstWeekday = monthStart.getDay(); const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const monthSessions = data.sessions.filter(item => { const date = new Date(item.date); return date.getFullYear() === calendarYear && date.getMonth() === calendarMonth; });
  const monthRewards = data.rewardHistory.filter(item => { const date = new Date(item.redeemedAt); return date.getFullYear() === calendarYear && date.getMonth() === calendarMonth; });
  const metrics = !monthSessions.length && !monthRewards.length ? null : { nights: new Set(monthSessions.map(item => localDateKey(item.date))).size, adjustments: monthSessions.reduce((sum, item) => sum + item.adjustments, 0), lessPromptNights: monthSessions.filter(item => item.promptReflection === "less").length };
  const selectedSessions = data.sessions.filter(item => localDateKey(item.date) === selectedDay);
  const selectedRewards = data.rewardHistory.filter(item => localDateKey(item.redeemedAt) === selectedDay);
  const weekStart = new Date(); weekStart.setHours(0, 0, 0, 0); weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weeklySessions = data.sessions.filter(item => new Date(item.date) >= weekStart);
  const weeklyNights = new Set(weeklySessions.map(item => localDateKey(item.date))).size;
  const weeklyReflections = weeklySessions.filter(item => item.promptReflection);
  const weeklyLessPromptNights = weeklySessions.filter(item => item.promptReflection === "less").length;
  const weeklyAdjustments = weeklySessions.reduce((sum, item) => sum + item.adjustments, 0);
  const planAnalysis = analyzePlan(data.planStart, data.planEnd, stages);
  const { availableMinutes, scheduledMinutes, issues: planIssues, hasErrors: planHasErrors, balanceMinutes: planBalance } = planAnalysis;
  const draftEnergy = stages.reduce((sum, item) => sum + item.energy, 0);
  const draftStart = stages[0]?.start ?? data.planStart;
  const draftEnd = stages.at(-1)?.end ?? data.planEnd;
  const editingStage = stages.find(item => item.id === editingStageId);
  const shiftMonth = (delta: number) => {
    const next = new Date(calendarYear, calendarMonth + delta, 1);
    setCalendarCursor(next); setSelectedDay(next.toLocaleDateString("en-CA"));
  };

  return <main className={`site-shell ${data.reducedMotion ? "reduce-motion" : ""}`}>
    <div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <section className="phone-shell" ref={phoneShellRef}>
      {screen === "welcome" && <div className="screen welcome-screen">
        <div className="brand-mark"><AppIcon name="home-heart" /><strong>先开始</strong></div>
        <h1>今晚，一起商量再开始</h1><p className="lead">安排时间、共同启动、需要时随时调整。孩子只短暂看屏幕。</p>
        <Mascot />
        <div className="privacy-card"><strong>先把家庭数据放在安全边界内</strong><div className="privacy-points"><span>不读取社交平台</span><span>不录音监控</span><span>不收集年级学校</span></div></div>
        <div className="consent-row"><input id="guardian-consent" type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /><label htmlFor="guardian-consent">我已阅读并同意监护人授权与儿童隐私说明</label><button type="button" onClick={() => openPrivacy("welcome")}>查看说明</button></div>
        <button className="primary-button" disabled={!consent} onClick={() => openProfile("welcome")}>继续设置</button>
      </div>}

      {screen === "privacy" && <div className="screen privacy-screen">
        <Header back={() => go(privacyReturn)} title="隐私与数据说明" />
        <div className="title-with-mascot"><div><span className="eyebrow">监护人先看清楚，再决定是否使用</span><h1>哪些数据保存在哪里？</h1></div><Mascot mood="support" compact /></div>
        <p className="lead">我们只保留完成核心流程需要的信息，不收集孩子真实姓名、年级、学校、精确位置、通讯录、人脸、声音或持续行为监控数据。</p>
        <div className="privacy-storage-list">
          <div><span className="big-icon"><AppIcon name="moon" /></span><section><small>仅保存在当前设备</small><strong>今晚计划草稿与进行中状态</strong><p>用于刷新或意外关页后继续；进行中状态超过18小时会自动失效。</p></section></div>
          <div><span className="big-icon"><AppIcon name="privacy" /></span><section><small>当前测试版会同步到云端</small><strong>家庭化名、设置、能量、晚间与兑换记录</strong><p>通过随机家庭 ID 关联，不使用手机号、真实姓名或 OpenAI 登录身份作为家庭账号。</p></section></div>
          <div><span className="big-icon"><AppIcon name="quiet" /></span><section><small>不会收集</small><strong>学校、位置、通讯录、人脸、录音与社交平台数据</strong><p>外部内容只能由监护人主动输入，不读取微信、小红书或学校系统。</p></section></div>
        </div>
        <div className="privacy-transparency"><strong>测试版安全边界</strong><p>随机家庭 ID 不是正式账号鉴权。当前站点保持私有；公开测试前需要增加监护人登录与访问控制，或关闭云端同步。</p></div>
        <div className="data-rights-card"><span className="eyebrow">家庭可以随时</span><h2>导出或删除全部数据</h2><p>导出文件包含家庭状态、本机计划草稿和进行中状态。删除会清除本机数据、云端记录和旧的随机家庭 ID。</p>{data.consent && <div className="two-buttons"><button className="secondary-button" onClick={exportData}>导出数据</button><button className="secondary-button danger-outline" onClick={deleteData}>删除数据</button></div>}</div>
        <button className="primary-button" onClick={() => go(privacyReturn)}>{privacyReturn === "welcome" ? "我已了解，返回授权" : "返回设置"}</button>
      </div>}

      {screen === "profile" && <div className="screen">
        <Header back={() => go(profileReturn)} title="家庭设置" />
        <div className="title-with-mascot"><div><span className="eyebrow">只填写今晚真正会用到的信息</span><h1>今晚，谁一起安排？</h1></div><Mascot compact /></div>
        <div className="form-card family-form"><label>孩子怎么称呼<input maxLength={12} value={data.childAlias} onChange={e => setData({ ...data, childAlias: e.target.value })} /></label><label>大人怎么称呼<input maxLength={12} value={data.guardianAlias} onChange={e => setData({ ...data, guardianAlias: e.target.value })} /></label>
          <fieldset><legend>今晚主要由谁安排</legend><div className="mode-grid">{(["adult", "together", "child"] as PlanningMode[]).map(mode => <button key={mode} aria-pressed={data.planningMode === mode} className={data.planningMode === mode ? "selected" : ""} onClick={() => setData({ ...data, planningMode: mode })}>{({ adult: "大人先安排", together: "一起安排", child: "孩子先安排" })[mode]}</button>)}</div></fieldset>
          <label>通常到家<input type="time" value={data.arrival} onChange={e => setData({ ...data, arrival: e.target.value })} /></label>
        </div>
        <p className="microcopy">不需要填写年级、学校、班级或真实姓名。</p><button className="primary-button" disabled={!data.childAlias.trim() || !data.guardianAlias.trim()} onClick={finishProfile}>{profileReturn === "settings" ? "保存修改" : "保存家庭称呼"}</button>
      </div>}

      {screen === "home" && <div className="screen with-nav home-screen">
        <div className="home-hero"><div><span className="eyebrow">{data.arrival} · {modeLabel}</span><h1>今晚，一起找到舒服的节奏</h1><p>先排时间，再一起点亮开始。</p></div><Mascot mood="confirm" compact /></div>
        {liveSessionAvailable ? <div className="live-session-panel"><button className="live-resume-card" onClick={() => go(liveResumeScreen)}><span className="live-pulse"><AppIcon name={liveResumeScreen === "wrap" ? "home-heart" : "alarm"} /></span><span><small>{liveResumeScreen === "wrap" ? "今晚等待温和收尾 · 进度已保存在本机" : "今晚正在进行 · 进度已保存在本机"}</small><strong>{liveResumeScreen === "wrap" ? "今晚，温和收尾" : activeStage?.title || "继续今晚"}</strong><em>{liveResumeScreen === "wrap" ? "只差最后30秒，一起看见已经做到的部分" : stageDue ? "这一段预计到时间了" : `${stages.filter(item => item.status === "done").length}/${stages.filter(item => item.status !== "tomorrow").length} 个阶段已完成`}</em></span><b>{liveResumeScreen === "wrap" ? "继续收尾 ›" : "继续 ›"}</b></button>{liveResumeScreen !== "wrap" && <button className="soft-end-button" onClick={endTonightEarly}>今晚先到这里</button>}</div> : <button className="primary-button large" onClick={() => { setStages(items => items.map(item => ({ ...item, status: "pending" }))); go("plan"); }}>{stages.length ? "继续安排今晚" : "开始安排今晚"} <span>›</span></button>}
        <div className="draft-summary"><span className="big-icon"><AppIcon name="moon" /></span><div><small>今晚草稿 · 仅保存在这台设备</small><strong>{stages.length ? `${stages.length}个节点 · ${draftStart}—${draftEnd} · ${draftEnergy}点能量` : "还没有节点，可以从空白开始"}</strong></div><span className="draft-saved">{draftUpdatedAt ? "已保存" : "准备中"}</span></div>
        <div className="insight-card sage"><span className="big-icon"><AppIcon name="quiet" /></span><div><small>今晚的默认提醒</small><strong>每个阶段只提醒一次，也可以继续或调整</strong></div></div>
        <button className="insight-card support-entry" onClick={() => go("energy")}><span className="big-icon"><AppIcon name="plant" /></span><div><small>家庭期待</small><strong>{data.rewardGoal.title}</strong><small>{data.rewardGoal.redeemed ? "已一起兑现，可以设置新期待" : progress ? `还差${progress}点` : "已经可以一起兑现"}</small></div><span>›</span></button>
        <div className="stats-row"><div><small>本周记录</small><strong>{weeklyNights} 晚</strong></div><div><small>家庭能量</small><strong>{data.energy}</strong><div className="energy-leaves">{[1,2,3,4,5].map(n => <i className={n <= Math.min(5, Math.ceil(data.energy / 6)) ? "filled" : ""} key={n} />)}</div></div></div>
        <p className="sync-label">{syncLabel}</p>
      </div>}

      {screen === "plan" && <div className="screen plan-screen">
        <Header back={() => go("home")} title="一起安排今晚" step="1/3" />
        <div className="availability-card custom-window"><AppIcon name="moon" /><div><small>今晚可用时间 · 可以自定义</small><div className="window-inputs"><input aria-label="今晚开始时间" type="time" value={data.planStart} onChange={e => setData({ ...data, planStart: e.target.value })} /><span>—</span><input aria-label="今晚结束时间" type="time" value={data.planEnd} onChange={e => setData({ ...data, planEnd: e.target.value })} /></div></div><Mascot compact /></div>
        <div className={`plan-balance ${planHasErrors ? "has-error" : ""}`} role="status"><div><span>{planHasErrors ? "先调整一下时间" : `已安排 ${scheduledMinutes} 分钟`}</span><strong>{planHasErrors ? planIssues[0] : planBalance ? `还留有 ${planBalance} 分钟空白` : "刚好装下今晚"}</strong></div><div className="balance-track"><i style={{ width: `${availableMinutes ? Math.min(100, scheduledMinutes / availableMinutes * 100) : 100}%` }} /></div></div>
        <div className="plan-tools"><span>草稿会自动保存在本机</span>{stages.length > 0 && <button className={clearPlanArmed ? "armed" : ""} onClick={clearPlan}>{clearPlanArmed ? "确认清空" : "从空白开始"}</button>}</div>
        <div className={`plan-list ${!stages.length ? "is-empty" : ""}`}>{!stages.length && <div className="empty-plan"><Mascot mood="breathe" compact /><strong>今晚还没有节点</strong><span>先加一件最容易开始的小事就好</span></div>}{stages.map((stage, index) => <div className={`stage-editor ${stage.status === "tomorrow" ? "muted-stage" : ""}`} key={stage.id}>
          <button className="stage-icon-button" onClick={() => { setEditingStageId(stage.id); go("icon-picker"); }} aria-label={`更换${stage.title}图标`}><AppIcon name={stage.icon} /><small>换图标</small></button><div className="stage-main"><input className="stage-title-input" aria-label={`第${index + 1}项名称`} value={stage.title} onChange={e => updateStage(stage.id, { title: e.target.value })} /><div className="time-range"><input aria-label={`${stage.title}开始时间`} type="time" value={stage.start} onChange={e => updateStage(stage.id, { start: e.target.value })} /><span>—</span><input aria-label={`${stage.title}结束时间`} type="time" value={stage.end} onChange={e => updateStage(stage.id, { end: e.target.value })} /></div><div className="stage-meta"><button className={`effort-pill effort-${stage.kind === "rest" ? "rest" : stage.effort}`} onClick={() => { setEditingStageId(stage.id); go("effort"); }}>{stage.kind === "rest" ? "休息放松" : effortCopy[stage.effort]} · 调整</button><span className="task-energy"><b>能量</b>{[1,2,3,4,5].map(value => <button key={value} aria-pressed={value === stage.energy} className={value <= stage.energy ? "filled" : ""} onClick={() => updateStage(stage.id, { energy: value })} aria-label={`${stage.title}设置${value}点能量`}>{value}</button>)}</span></div></div>
          <div className="stage-actions"><button onClick={() => moveStage(index, -1)} disabled={index === 0} aria-label="向上移动">↑</button><button onClick={() => moveStage(index, 1)} disabled={index === stages.length - 1} aria-label="向下移动">↓</button><button onClick={() => removeStage(stage, index)} aria-label={`删除${stage.title}，可撤销`}>×</button></div>
        </div>)}</div>
        <button className="add-node-button" onClick={addStage} aria-label="增加一个时间节点"><span>＋</span><strong>增加一个节点</strong></button>
        <div className="gentle-note">今晚安排可以随时调整。留一点空白，比把时间装满更容易开始。</div><button className="primary-button" disabled={!stages.length || planHasErrors} onClick={() => go("confirm")}>{planHasErrors ? "先调整标出的时间" : "下一步：一起确认"}</button>
      </div>}

      {screen === "icon-picker" && <div className="screen icon-picker-screen">
        <Header back={() => go("plan")} title="选择活动图标" /><span className="eyebrow">图标只是帮助快速识别，名称仍然由你们决定</span><h1>这件事看起来像什么？</h1>
        <div className="icon-library">{ICON_LIBRARY.map(([icon,label]) => { const selected = stages.find(item => item.id === editingStageId)?.icon === icon; return <button key={icon} aria-pressed={selected} className={selected ? "selected" : ""} onClick={() => { updateStage(editingStageId, { icon }); go("plan"); }}><AppIcon name={icon} /><small>{label}</small></button>; })}</div>
      </div>}

      {screen === "effort" && <div className="screen effort-screen">
        <Header back={() => go("plan")} />
        <span className="eyebrow">先确定它是投入，还是恢复</span><h1>这段时间更像什么？</h1>
        <div className="current-task-card"><AppIcon name={editingStage?.icon ?? "pencil"} /><div><strong>{editingStage?.title}</strong><small>同一件事在不同晚上，也可以有不同感觉</small></div></div>
        <div className="stage-kind-picker" role="group" aria-label="节点类型"><button aria-pressed={editingStage?.kind === "task"} className={editingStage?.kind === "task" ? "selected" : ""} onClick={() => updateStage(editingStageId, { kind: "task" })}><AppIcon name="pencil" /><span><strong>要做的事</strong><small>需要投入一点注意力</small></span></button><button aria-pressed={editingStage?.kind === "rest"} className={editingStage?.kind === "rest" ? "selected" : ""} onClick={() => updateStage(editingStageId, { kind: "rest", effort: 1 })}><AppIcon name="quiet" /><span><strong>休息放松</strong><small>让身体和情绪恢复</small></span></button></div>
        {editingStage?.kind === "task" ? <><h2 className="detail-heading">今天需要多少力气？</h2><div className="effort-options">{([1,2,3] as Effort[]).map(level => { const copy = { 1: ["一小步", "我可以先自己试试"], 2: ["需要专注", "请帮我把第一步说清楚"], 3: ["今天比较费力", "先缩小任务或多休息"] }[level]; const selected = editingStage?.effort === level; return <button key={level} aria-pressed={selected} className={selected ? `selected effort-${level}` : `effort-${level}`} onClick={() => updateStage(editingStageId, { effort: level })}><span className="effort-leaves">{Array.from({ length: level }).map((_, i) => <i key={i} />)}</span><span><strong>{copy[0]}</strong><small>{copy[1]}</small></span><b>{selected ? "✓" : "○"}</b></button>; })}</div></> : <div className="rest-duration"><span>这次准备休息多久？</span><div>{[5,10,15].map(minutes => { const selected = durationMinutes(editingStage?.start ?? "00:00", editingStage?.end ?? "00:00") === minutes; return <button key={minutes} aria-pressed={selected} className={selected ? "selected" : ""} onClick={() => editingStage && updateStage(editingStageId, { end: addMinutes(editingStage.start, minutes) })}>{minutes}分钟</button>; })}</div><small>先约定时长，到点再一起看看下一步，不用突然打断。</small></div>}
        <div className="support-suggestion"><Mascot mood="support" compact /><div><small>今晚建议</small><strong>{editingStage?.kind === "rest" ? "休息也算照顾计划的一部分" : (editingStage?.effort ?? 1) === 3 ? "先休息10分钟，再缩小第一步" : "从第一小步开始，卡住时再求助"}</strong><p>{editingStage?.kind === "rest" ? "休息不会被当作偷懒，也不需要用屏幕填满。" : "用力程度不会改变奖励，也不会给孩子打分。"}</p></div></div>
        <button className="primary-button" onClick={() => go("plan")}>保存到时间表</button>
      </div>}

      {screen === "confirm" && <div className="screen confirm-screen">
        <Header back={() => go("plan")} title="共同确认" step="2/3" /><h1>今晚的安排，我们一起确认</h1>
        <div className="summary-strip"><span><strong>{stages[0]?.start}</strong><small>开始</small></span><span><strong>{stages.filter(s => s.status !== "tomorrow").length}</strong><small>个阶段</small></span><span><strong>{stages.at(-1)?.end}</strong><small>左右收尾</small></span></div>
        <div className="promise-card guardian"><AppIcon name="family" /><span><strong>{data.guardianAlias}</strong><small>先给第一步留出空间</small></span></div><div className="promise-card child"><AppIcon name="home-heart" /><span><strong>{data.childAlias}</strong><small>卡住时可以主动说</small></span></div>
        <Mascot mood="confirm" /><div className="privacy-note">时间表不是命令。中途改变顺序、休息或移到明天，都不算失败。</div><button className="primary-button" onClick={() => go("dual-start")}>进入共同启动</button>
      </div>}

      {screen === "dual-start" && <div className="screen dual-start-screen">
        <Header back={() => go("confirm")} title="一起点亮" step="3/3" /><span className="eyebrow">可以同时点，也可以一个一个来</span><h1>两个人都准备好，就开始</h1><Mascot mood={guardianConfirmed && childConfirmed ? "celebrate" : "ready"} />
        <div className="light-bridge" data-ready={guardianConfirmed && childConfirmed} />
        <div className="dual-press"><button aria-label={`${data.guardianAlias}${guardianConfirmed ? "已点亮，再点一次取消" : "点一下确认准备"}`} aria-pressed={guardianConfirmed} className={`press-zone guardian-zone ${guardianConfirmed ? "confirmed" : ""}`} onClick={() => setGuardianConfirmed(value => !value)}><span className="finger-tip"><small>{data.guardianAlias}</small></span><strong>{data.guardianAlias}</strong><small>{guardianConfirmed ? "已点亮" : "点一下"}</small></button><button aria-label={`${data.childAlias}${childConfirmed ? "已点亮，再点一次取消" : "点一下确认准备"}`} aria-pressed={childConfirmed} className={`press-zone child-zone ${childConfirmed ? "confirmed" : ""}`} onClick={() => setChildConfirmed(value => !value)}><span className="finger-tip"><small>{data.childAlias}</small></span><strong>{data.childAlias}</strong><small>{childConfirmed ? "已点亮" : "点一下"}</small></button></div>
        <p className="child-copy" role="status">{guardianConfirmed && childConfirmed ? "今晚的安排，已经一起点亮" : "不需要完全同时，两个名字都亮起来就可以。"}</p>
      </div>}

      {screen === "running" && <div className="screen running-screen">
        <Header title="今晚进行中" /><div className="running-hero"><span className="eyebrow">当前阶段 · {activeIndex + 1}/{stages.filter(s => s.status !== "tomorrow").length}</span><Mascot mood="breathe" compact /></div>
        {stageDue && <span className="sr-only" role="status">{activeStage.title}预计到时间了，可以完成、继续或调整。</span>}
        <div className={`active-stage-card ${stageDue ? "is-due" : ""}`}><AppIcon name={activeStage.icon} /><div><small>计划时间 {activeStage.start}—{activeStage.end}</small><h1>{activeStage.title}</h1><span className={`effort-pill effort-${activeStage.effort}`}>{effortCopy[activeStage.effort]}</span><span className="active-energy">完成后 +{activeStage.energy} 能量</span></div><div className="stage-timer"><small>{stageDue ? "可以看看下一步了" : "距离柔和提醒"}</small><strong>{stageDue ? "到时间啦" : formatCountdown(remainingSeconds)}</strong><div><i style={{ width: `${Math.max(0, Math.min(100, remainingSeconds / Math.max(1, durationMinutes(activeStage.start, activeStage.end) * 60) * 100))}%` }} /></div></div></div>
        <div className="calm-space"><strong>手机留在大人手里</strong><p>不记录坐姿、声音、人脸或孩子是否一直在桌前。</p></div>
        <div className="mini-timeline">{stages.map((stage, index) => <div key={stage.id} className={`${stage.status} ${index === activeIndex ? "now" : ""}`}><i /><span>{stage.title}</span><small>{stage.status === "done" ? "完成" : stage.status === "tomorrow" ? "明天" : stage.start}</small></div>)}</div>
        <button className="primary-button" onClick={stageFinished}>{stageDue ? "完成这一段，看看下一步" : "提前完成这一阶段"}</button><button className="secondary-button adjust-button" onClick={openAdjust}>调整今晚计划</button>
      </div>}

      {screen === "transition" && <div className={`screen transition-screen ${transitionReason}-transition`}>
        <span className="eyebrow">{transitionReason === "completed" ? "这一段完成了" : "阶段提醒 · 只提醒一次"}</span><h1>{transitionReason === "completed" ? `${activeStage.title}已经告一段落` : `${activeStage.title}这一段预计到时间了`}</h1><p className="lead">{transitionReason === "completed" ? "先看见已经做到的，再决定下一步。" : "不用马上切换，看看现在更适合哪一步。"}</p><div className="transition-art"><AppIcon name={transitionReason === "completed" ? "check" : "moon"} /><Mascot mood={transitionReason === "completed" ? "celebrate" : "confirm"} /></div>
        <div className="transition-actions"><button className="primary-button" onClick={continueToNext}>{hasNextPending ? "进入下一阶段" : "进入今晚收尾"}</button><button className="secondary-button" onClick={extendCurrent}>{transitionReason === "completed" ? "还想继续10分钟" : "再继续10分钟"}</button><button className="soft-button" onClick={startRestNow}>先休息一下</button></div><button className="text-button" onClick={openAdjust}>调整今晚计划</button>
        <div className="privacy-note">{transitionReason === "completed" ? "提前完成不是必须；按自己的节奏走，也可以停下来调整。" : "页面保持打开时，会有一次柔和声音或震动提醒；不会连续催促。"}</div>
      </div>}

      {screen === "adjust" && <div className="screen adjust-screen">
        <Header back={() => go("running")} title="调整今晚" /><div className="title-with-mascot"><div><span className="eyebrow">计划服务于家庭，而不是反过来</span><h1>现在更适合怎么调整？</h1></div><Mascot mood="support" compact /></div>
        <div className="adjust-grid">{([
          ["extend", "steps", "延长当前阶段", "后续时间顺延10分钟"], ["rest", "quiet", "现在休息10分钟", "原事项随后继续"], ["swap", "speech", "调换后两项", "时间会自动重排"], ["tomorrow", "moon", "下一项移到明天", "保留已经完成的进展"],
          ["finish", "home-heart", "今晚先到这里", "保留进展，温和收尾"],
        ] as const).map(([id,icon,title,copy]) => <button key={id} aria-pressed={adjustChoice === id} className={`${adjustChoice === id ? "selected" : ""} ${id === "finish" ? "finish-choice" : ""}`} onClick={() => setAdjustChoice(id)}><AppIcon name={icon} /><span><strong>{title}</strong><small>{copy}</small></span></button>)}</div>
        <div className="change-preview"><small>本次调整预览</small><strong>{adjustChoice === "extend" ? `${activeStage.title}延长10分钟，后续顺延` : adjustChoice === "rest" ? `现在休息10分钟，再继续${activeStage.title}` : adjustChoice === "swap" ? "调换后两项，并重新排好时间" : adjustChoice === "tomorrow" ? "把下一项移到明天" : "保留已完成的部分，今晚温和收尾"}</strong></div>
        <div className="gentle-note">调整不会扣掉家庭能量，已经完成的进展会保留。</div><button className="primary-button" onClick={applyAdjustment}>{adjustChoice === "finish" ? "确认并温和收尾" : "双方确认调整"}</button><button className="text-button" onClick={() => go("running")}>取消</button>
      </div>}

      {screen === "wrap" && <div className="screen wrap-screen">
        <Header title="今晚收尾" /><span className="eyebrow">亲子一起 · 30秒</span><h1>今晚，温和收尾</h1><Mascot mood="celebrate" />
        <div className="wrap-summary"><div><strong>{stages.filter(s => s.status === "done").length}</strong><small>完成阶段</small></div><div><strong>{adjustments}</strong><small>次主动调整</small></div></div>
        <div className="energy-summary"><strong>今晚积累的家庭能量</strong>{stages.some(item => item.status === "done") ? <span>完成的节点：+{stages.filter(item => item.status === "done").reduce((sum,item) => sum + item.energy, 0)}</span> : <span>愿意一起停下来调整，进展留到明天</span>}<span>共同商量并完成收尾：+2</span>{adjustments > 0 && <span>一起调整计划：+1</span>}</div>
        <fieldset className="prompt-reflection"><legend>只给大人记一笔</legend><strong>和你们平时相比，今晚催促感怎么样？</strong><div>{(["less", "same", "more"] as PromptReflection[]).map(value => <button type="button" key={value} aria-pressed={promptReflection === value} className={promptReflection === value ? "selected" : ""} onClick={() => setPromptReflection(current => current === value ? null : value)}>{({ less: "少一些", same: "差不多", more: "多一些" })[value]}</button>)}</div><small>可选，不影响能量，也不评价孩子。</small></fieldset>
        <p className="lead">没有完成的事项可以留到明天，能量不会被扣掉。</p><button className="primary-button" onClick={finishNight}>结束今晚</button>{hasDeferredStages && <button className="secondary-button wrap-resume-button" onClick={resumeTonightFromWrap}>还想继续今晚</button>}
      </div>}

      {screen === "energy" && <div className="screen with-nav energy-screen">
        <Header title="家庭能量房间" /><div className="room-scene"><img className="room-art" src="/assets/energy-room-v2.png" alt="温暖的家庭学习角" /><div className="room-light" /><Mascot mood={goalReady ? "celebrate" : "ready"} /></div>
        <div className="energy-panel"><span className="eyebrow">共同积累，不给孩子打分</span><h1>{data.energy} 点家庭能量</h1><div className="energy-bar"><i style={{ width: `${Math.min(100, data.energy / data.rewardGoal.threshold * 100)}%` }} /></div></div>
        <div className="goal-card"><AppIcon name="game" /><div><small>家庭期待</small><strong>{data.rewardGoal.title}</strong><p>{data.rewardGoal.redeemed ? "已经一起兑现，可以开始新的家庭期待" : progress ? `还差${progress}点，一起积累，不用赶` : "已经点亮，可以一起兑现"}</p></div></div>
        {data.rewardGoal.redeemed ? <button className="secondary-button" onClick={() => go("reward-setup")}>设置新的家庭期待</button> : progress ? <button className="secondary-button" onClick={() => go("reward-setup")}>调整家庭期待</button> : <button className="primary-button" onClick={() => go("reward-achieved")}>查看达成图</button>}
        <div className="gentle-note">能量不会清零、倒扣或过期，也不会因为暂停而减少。</div>
      </div>}

      {screen === "reward-setup" && <div className="screen reward-setup-screen">
        <Header back={() => go("energy")} /><span className="eyebrow">一起定义值得期待的家庭时光</span><h1>一起定一个家庭期待</h1>
        <div className="threshold-card"><small>达到多少能量</small><div><button onClick={() => setData({ ...data, rewardGoal: { ...data.rewardGoal, threshold: Math.max(data.energy + 1, data.rewardGoal.threshold - 5) } })}>−</button><strong>{data.rewardGoal.threshold}</strong><button onClick={() => setData({ ...data, rewardGoal: { ...data.rewardGoal, threshold: data.rewardGoal.threshold + 5 } })}>＋</button></div></div>
        <label className="reward-input">实现这个期待：做什么<input value={data.rewardGoal.title} maxLength={24} onChange={e => setData({ ...data, rewardGoal: { ...data.rewardGoal, title: e.target.value } })} /></label>
        <div className="reward-row">{[["game","家庭游戏","周末一起玩桌游"],["book","选择故事","一起选睡前故事"],["move","一起散步","周末一起散步"]].map(([icon,label,title]) => <button key={label} aria-pressed={data.rewardGoal.title === title} className={data.rewardGoal.title === title ? "selected" : ""} onClick={() => setData({ ...data, rewardGoal: { ...data.rewardGoal, title } })}><AppIcon name={icon} /><small>{label}</small></button>)}</div>
        <label className="reward-input">计划兑现<input value={data.rewardGoal.date} onChange={e => setData({ ...data, rewardGoal: { ...data.rewardGoal, date: e.target.value } })} /></label>
        <div className="participant-row"><span>谁会一起参与</span><strong>{data.guardianAlias}　✓</strong><strong>{data.childAlias}　✓</strong></div><div className="gentle-note">不建议设置现金、充值或高价商品。优先选择可以一起完成的家庭活动。</div>
        <button className="primary-button" onClick={() => { persist({ ...data, rewardGoal: { ...data.rewardGoal, participants: [data.guardianAlias, data.childAlias], redeemed: false } }, "家庭期待已保存"); go("energy"); }}>保存家庭期待</button>
      </div>}

      {screen === "reward-achieved" && <div className="screen achievement-screen">
        <span className="eyebrow">家庭期待已点亮</span><h1>你们一起积累到了</h1><div className="achievement-energy"><strong>{data.rewardGoal.threshold}</strong><span>点家庭能量</span></div>
        <div className="achievement-art"><img src="/assets/energy-room-v2.png" alt="点亮的家庭房间" /><Mascot mood="celebrate" /><AppIcon name="game" /></div>
        <div className="achievement-card"><AppIcon name="game" /><div><strong>{data.rewardGoal.title}</strong><p>这是一起兑现的家庭时光</p></div></div>
        <button className="primary-button" onClick={redeemReward}>记录兑换并开始新的期待</button><button className="secondary-button" onClick={() => { setToast(`已计划到${data.rewardGoal.date}`); go("energy"); }}>计划到{data.rewardGoal.date}</button><p className="microcopy">记录兑换后能量归零，完成的期待会出现在日历里。</p>
      </div>}

      {screen === "review" && <div className="screen with-nav review-screen">
        <Header title="家庭日历" /><span className="eyebrow">每天收尾和家庭期待都会留在这里</span><div className="review-insight"><AppIcon name="quiet" /><div><small>本周复盘 · 不评价孩子</small><strong>{weeklyLessPromptNights ? `有${weeklyLessPromptNights}晚，催促感比平时少` : weeklyReflections.length ? `已记录${weeklyReflections.length}晚，先观察，不急着比较` : weeklyNights ? "收尾时可以给大人记一笔催促感" : "先从一个更容易开始的晚上观察"}</strong><p>{weeklyAdjustments ? `你们主动调整了${weeklyAdjustments}次，改变计划也算合作。` : "这里关注催促和合作，不用追求连续打卡。"}</p></div></div><div className="month-nav"><button onClick={() => shiftMonth(-1)} aria-label="上个月">‹</button><h1>{calendarYear}年{calendarMonth + 1}月</h1><button onClick={() => shiftMonth(1)} aria-label="下个月">›</button></div>
        <div className="calendar-legend"><span><i className="session-dot" />晚间记录</span><span><i className="reward-star">★</i>期待兑换</span></div>
        <div className="calendar-card"><div className="weekdays">{["日","一","二","三","四","五","六"].map(day => <b key={day}>{day}</b>)}</div><div className="calendar-grid">{Array.from({length:firstWeekday}).map((_,i) => <span className="blank-day" key={`blank-${i}`} />)}{Array.from({length:daysInMonth}).map((_,i) => { const day=i+1; const date=new Date(calendarYear,calendarMonth,day); const key=date.toLocaleDateString("en-CA"); const hasSession=data.sessions.some(item => localDateKey(item.date)===key); const hasReward=data.rewardHistory.some(item => localDateKey(item.redeemedAt)===key); return <button aria-pressed={selectedDay === key} aria-label={`${calendarMonth + 1}月${day}日${hasSession ? "，有晚间记录" : ""}${hasReward ? "，有期待兑换" : ""}`} key={key} className={`${selectedDay===key ? "selected" : ""} ${hasSession ? "has-session" : ""} ${hasReward ? "has-reward" : ""}`} onClick={() => setSelectedDay(key)}><strong>{day}</strong><span>{hasSession && <i />} {hasReward && <b>★</b>}</span></button>; })}</div></div>
        <div className="day-detail"><small>{selectedDay}</small>{!selectedSessions.length && !selectedRewards.length ? <div className="empty-day"><Mascot mood="breathe" compact /><span>这一天还没有记录</span></div> : <>{selectedSessions.map(item => <div className="history-row" key={item.id}><AppIcon name="check" /><div><strong>{item.completedCount ? "完成晚间流程" : "今晚已温和收尾"}</strong><small>{item.completedCount}个完成阶段 · 获得{item.energyEarned}点能量{item.promptReflection ? ` · ${promptReflectionCopy[item.promptReflection]}` : ""}</small><p>{item.stageTitles.join("、") || "未完成事项已留到明天"}</p></div></div>)}{selectedRewards.map(item => <div className="history-row reward-history" key={item.id}><AppIcon name="game" /><div><strong>兑换家庭期待</strong><small>{item.threshold}点 · 能量已归零</small><p>{item.title}</p></div></div>)}</>}</div>
        {metrics && <div className="metric-grid compact-metrics"><div><AppIcon name="moon" /><small>本月记录</small><strong>{metrics.nights}晚</strong></div><div><AppIcon name="speech" /><small>主动调整</small><strong>{metrics.adjustments}次</strong></div><div><AppIcon name="quiet" /><small>少催反馈</small><strong>{metrics.lessPromptNights}晚</strong></div></div>}
      </div>}

      {screen === "settings" && <div className="screen with-nav settings-screen">
        <Header title="设置" /><div className="settings-group"><h2>家庭称呼</h2><div className="setting-row"><span>孩子化名</span><strong>{data.childAlias}</strong></div><div className="setting-row"><span>大人称呼</span><strong>{data.guardianAlias}</strong></div><div className="setting-row"><span>安排方式</span><strong>{modeLabel}</strong></div><button className="setting-action" onClick={() => openProfile("settings")}>修改家庭设置 <span>›</span></button></div>
        <div className="settings-group"><h2>体验偏好</h2><label className="toggle-row"><span><strong>温和提示音</strong><small>确认、阶段转换和收尾</small></span><input type="checkbox" checked={data.sound} onChange={e => persist({ ...data, sound: e.target.checked })} /></label><label className="toggle-row"><span><strong>减少动态效果</strong><small>关闭呼吸、漂浮和庆祝动画</small></span><input type="checkbox" checked={data.reducedMotion} onChange={e => persist({ ...data, reducedMotion: e.target.checked })} /></label></div>
        <div className="settings-group"><h2>隐私与数据</h2><div className="setting-row"><span>未收集年级和学校</span><strong>已启用</strong></div><div className="setting-row"><span>数据状态</span><strong>{syncLabel}</strong></div><button className="setting-action" onClick={() => openPrivacy("settings")}>查看隐私与数据说明 <span>›</span></button><button className="setting-action" onClick={exportData}>导出家庭数据 <span>›</span></button><button className="setting-action danger" onClick={deleteData}>删除孩子全部数据 <span>›</span></button></div>
        <button className="risk-entry" onClick={() => go("risk")}><AppIcon name="privacy" /><div><strong>有些情况，需要更多支持</strong><small>查看风险提示与转介建议</small></div><span>›</span></button>
      </div>}

      {screen === "risk" && <div className="screen risk-screen"><Header back={() => go("settings")} /><span className="eyebrow">风险边界</span><h1>有些情况，需要更多支持</h1><p className="lead">这个工具不做诊断，也不能替代专业评估。</p><div className="risk-list"><div><AppIcon name="home-heart" /><strong>困难长期存在于家庭和学校多个场景</strong></div><div><AppIcon name="moon" /><strong>持续拒学或明显躯体不适</strong></div><div><AppIcon name="privacy" /><strong>严重情绪变化或自伤表达</strong></div></div><div className="next-actions"><h2>接下来可以</h2><button onClick={() => setToast("今晚流程已暂停")}>1　先暂停今晚流程</button><button onClick={() => setToast("建议记录事实后联系老师")}>2　联系学校老师</button><button onClick={() => setToast("请选择正规医疗机构")}>3　寻找正规医疗机构</button></div><div className="urgent-note"><strong>存在立即安全风险时</strong><p>请优先联系当地急救或警方，并让可信任的成年人陪在孩子身边。</p></div></div>}

      {(["home", "review", "energy", "settings"] as Screen[]).includes(screen) && <BottomNav screen={screen} go={go} />}
      {deletedStage && <div className="undo-toast" role="status"><span>已移除“{deletedStage.stage.title}”</span><button onClick={undoRemoveStage}>撤销</button></div>}
      {toast && <div className="toast" role="status">{toast}</div>}
    </section>
    <aside className="desktop-note"><span className="brand-mark"><AppIcon name="home-heart" /><strong>先开始</strong></span><h2>今晚少催一次，从共同商量开始。</h2><p>共同排时间、双人点亮、阶段柔和提醒，计划随时可以改。</p><div className="desktop-points"><span>不讲题</span><span>不监控</span><span>不比较</span></div></aside>
  </main>;
}
