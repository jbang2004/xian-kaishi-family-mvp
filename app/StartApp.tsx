"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";

type Effort = 1 | 2 | 3;
type StageStatus = "pending" | "active" | "done" | "tomorrow";
type PlanningMode = "adult" | "together" | "child";
type Screen = "welcome" | "profile" | "home" | "plan" | "effort" | "confirm" | "dual-start" | "running" | "transition" | "adjust" | "wrap" | "energy" | "reward-setup" | "reward-achieved" | "review" | "settings" | "risk";

type Stage = {
  id: string;
  title: string;
  icon: string;
  start: string;
  end: string;
  effort: Effort;
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
};

type AppData = {
  consent: boolean;
  childAlias: string;
  guardianAlias: string;
  planningMode: PlanningMode;
  arrival: string;
  energy: number;
  sound: boolean;
  reducedMotion: boolean;
  rewardGoal: RewardGoal;
  sessions: SessionRecord[];
};

const STORAGE_KEY = "xian-kaishi-family-v2";

const DEFAULT_DATA: AppData = {
  consent: false,
  childAlias: "小橙",
  guardianAlias: "妈妈",
  planningMode: "together",
  arrival: "17:30",
  energy: 18,
  sound: true,
  reducedMotion: false,
  rewardGoal: { threshold: 30, title: "周末一起玩桌游", date: "周六", participants: ["妈妈", "小橙"], redeemed: false },
  sessions: [],
};

const DEFAULT_STAGES: Stage[] = [
  { id: "snack", title: "吃点东西", icon: "snack", start: "18:10", end: "18:30", effort: 1, status: "pending", kind: "rest" },
  { id: "math", title: "数学练习", icon: "chart", start: "18:30", end: "19:00", effort: 2, status: "pending", kind: "task" },
  { id: "move", title: "活动一下", icon: "move", start: "19:00", end: "19:10", effort: 1, status: "pending", kind: "rest" },
  { id: "reading", title: "阅读", icon: "book", start: "19:10", end: "19:35", effort: 1, status: "pending", kind: "task" },
  { id: "bag", title: "整理书包", icon: "backpack", start: "19:35", end: "19:45", effort: 1, status: "pending", kind: "task" },
];

const STAGE_TEMPLATES = [
  ["book", "阅读", "task"], ["chart", "数学练习", "task"], ["pencil", "书写练习", "task"],
  ["backpack", "整理书包", "task"], ["speech", "朗读背诵", "task"], ["quiet", "安静休息", "rest"],
] as const;

function createId(prefix: string) {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `${prefix}-${suffix}`;
}

function addMinutes(time: string, amount: number) {
  const [h, m] = time.split(":").map(Number);
  const total = (h * 60 + m + amount + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
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
    <strong>{title}</strong>
    {step ? <span className="step-pill">{step}</span> : <span className="header-spacer" />}
  </header>;
}

function BottomNav({ screen, go }: { screen: Screen; go: (screen: Screen) => void }) {
  const items: Array<[Screen, string, string]> = [["home", "home-heart", "首页"], ["review", "chart", "复盘"], ["energy", "plant", "能量"], ["settings", "privacy", "设置"]];
  return <nav className="bottom-nav" aria-label="主导航">{items.map(([id, icon, label]) => <button key={id} className={screen === id ? "active" : ""} onClick={() => go(id)}><AppIcon name={icon} /><small>{label}</small></button>)}</nav>;
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
    } satisfies SessionRecord;
  }) : [];
  return {
    consent: Boolean(old.consent ?? DEFAULT_DATA.consent), childAlias, guardianAlias,
    planningMode: old.planningMode === "adult" || old.planningMode === "child" || old.planningMode === "together" ? old.planningMode : DEFAULT_DATA.planningMode,
    arrival: String(old.arrival ?? DEFAULT_DATA.arrival), energy: Number(old.energy ?? DEFAULT_DATA.energy),
    sound: typeof old.sound === "boolean" ? old.sound : DEFAULT_DATA.sound,
    reducedMotion: typeof old.reducedMotion === "boolean" ? old.reducedMotion : DEFAULT_DATA.reducedMotion,
    rewardGoal: { ...DEFAULT_DATA.rewardGoal, ...goal, participants: [guardianAlias, childAlias] }, sessions,
  };
}

export function StartApp() {
  const [data, setData] = useState(DEFAULT_DATA);
  const [familyId, setFamilyId] = useState("");
  const [screen, setScreen] = useState<Screen>("welcome");
  const [consent, setConsent] = useState(false);
  const [stages, setStages] = useState<Stage[]>(DEFAULT_STAGES);
  const [customTitle, setCustomTitle] = useState("");
  const [editingStageId, setEditingStageId] = useState(DEFAULT_STAGES[1].id);
  const [activeIndex, setActiveIndex] = useState(0);
  const [adjustments, setAdjustments] = useState(0);
  const [adjustChoice, setAdjustChoice] = useState<"extend" | "rest" | "swap" | "tomorrow">("extend");
  const [guardianConfirmed, setGuardianConfirmed] = useState(false);
  const [childConfirmed, setChildConfirmed] = useState(false);
  const [toast, setToast] = useState("");
  const [syncLabel, setSyncLabel] = useState("本机已保存");

  const go = (next: Screen) => {
    setScreen(next);
    window.scrollTo({ top: 0, behavior: data.reducedMotion ? "auto" : "smooth" });
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const id = localStorage.getItem("xian-kaishi-family-id") || createId("family");
      localStorage.setItem("xian-kaishi-family-id", id);
      setFamilyId(id);
      const local = localStorage.getItem(STORAGE_KEY) || localStorage.getItem("xian-kaishi-family-v1");
      if (local) {
        try {
          const next = normalizeData(JSON.parse(local));
          setData(next); setConsent(next.consent); setScreen(next.consent ? "home" : "welcome");
        } catch { /* keep safe defaults */ }
      }
      fetch(`/api/state?familyId=${encodeURIComponent(id)}`).then(r => r.json()).then(result => {
        if (result.data) {
          const next = normalizeData(result.data);
          setData(next); setConsent(next.consent); setScreen(next.consent ? "home" : "welcome");
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); setSyncLabel("云端已同步");
        }
      }).catch(() => setSyncLabel("仅保存在本机"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const persist = (next: AppData, message?: string) => {
    setData(next); localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); setSyncLabel("正在保存…");
    if (message) { setToast(message); window.setTimeout(() => setToast(""), 2200); }
    if (familyId) fetch(`/api/state?familyId=${encodeURIComponent(familyId)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(next) })
      .then(r => r.json()).then(result => setSyncLabel(result.localOnly ? "仅保存在本机" : "云端已同步")).catch(() => setSyncLabel("仅保存在本机"));
  };

  const playTone = (kind: "confirm" | "transition" | "complete") => {
    if (!data.sound || typeof window === "undefined") return;
    const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx(); const gain = ctx.createGain(); const osc = ctx.createOscillator();
    osc.type = "sine"; osc.frequency.value = kind === "complete" ? 720 : kind === "transition" ? 540 : 620;
    gain.gain.setValueAtTime(.0001, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(.055, ctx.currentTime + .02); gain.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + .55);
    osc.connect(gain).connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + .58);
  };

  const finishProfile = () => {
    const next = { ...data, consent: true, rewardGoal: { ...data.rewardGoal, participants: [data.guardianAlias, data.childAlias] } };
    persist(next, "家庭称呼已保存"); playTone("confirm"); go("home");
  };

  const addStage = (icon = "pencil", title?: string, kind: Stage["kind"] = "task") => {
    const lastEnd = stages.at(-1)?.end ?? "18:10";
    const name = title || customTitle.trim() || "新事项";
    setStages(items => [...items, { id: createId("stage"), title: name, icon, start: lastEnd, end: addMinutes(lastEnd, kind === "rest" ? 10 : 20), effort: 1, status: "pending", kind }]);
    setCustomTitle("");
  };

  const updateStage = (id: string, patch: Partial<Stage>) => setStages(items => items.map(item => item.id === id ? { ...item, ...patch } : item));
  const moveStage = (index: number, delta: -1 | 1) => {
    const target = index + delta; if (target < 0 || target >= stages.length) return;
    const next = [...stages]; [next[index], next[target]] = [next[target], next[index]]; setStages(next);
  };

  const startPlan = () => {
    setStages(items => items.map((item, index) => ({ ...item, status: index === 0 ? "active" : "pending" })));
    setActiveIndex(0); setAdjustments(0); setGuardianConfirmed(false); setChildConfirmed(false); playTone("confirm"); go("running");
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

  const stageFinished = () => {
    setStages(items => items.map((item, index) => index === activeIndex ? { ...item, status: "done" } : item));
    playTone("transition"); navigator.vibrate?.([25, 35, 25]); go("transition");
  };

  const continueToNext = () => {
    const nextIndex = nextPendingIndex(activeIndex);
    if (nextIndex < 0) { go("wrap"); return; }
    setStages(items => items.map((item, index) => index === nextIndex ? { ...item, status: "active" } : item));
    setActiveIndex(nextIndex); go("running");
  };

  const extendCurrent = () => {
    updateStage(activeStage.id, { end: addMinutes(activeStage.end, 10), status: "active" });
    setAdjustments(value => value + 1); setToast("这一阶段延长了10分钟"); go("running");
  };

  const insertRest = (startNow = false) => {
    const start = activeStage.end;
    const rest: Stage = { id: createId("rest"), title: "安静休息", icon: "quiet", start, end: addMinutes(start, 10), effort: 1, status: startNow ? "active" : "pending", kind: "rest" };
    setStages(items => [...items.slice(0, activeIndex + 1), rest, ...items.slice(activeIndex + 1)]);
    if (startNow) setActiveIndex(activeIndex + 1);
    setAdjustments(value => value + 1); setToast(startNow ? "现在先休息10分钟" : "已在下一阶段前加入休息"); go("running");
  };

  const applyAdjustment = () => {
    if (adjustChoice === "extend") { extendCurrent(); return; }
    if (adjustChoice === "rest") { insertRest(false); return; }
    if (adjustChoice === "swap") {
      const pending = stages.map((item, index) => ({ item, index })).filter(({ item, index }) => index > activeIndex && item.status === "pending");
      if (pending.length >= 2) { const next = [...stages]; [next[pending[0].index], next[pending[1].index]] = [next[pending[1].index], next[pending[0].index]]; setStages(next); setToast("后两项顺序已调换"); }
    } else {
      const idx = nextPendingIndex(activeIndex);
      if (idx >= 0) { setStages(items => items.map((item, index) => index === idx ? { ...item, status: "tomorrow" } : item)); setToast("下一项已移到明天"); }
    }
    setAdjustments(value => value + 1); go("running");
  };

  const finishNight = () => {
    const completedCount = stages.filter(item => item.status === "done").length;
    const childEnergy = 2; const guardianEnergy = 2; const adjustmentEnergy = adjustments ? 1 : 0;
    const nextEnergy = data.energy + childEnergy + guardianEnergy + adjustmentEnergy;
    const record: SessionRecord = { id: createId("session"), date: new Date().toISOString(), stageCount: stages.length, completedCount, adjustments, childEnergy, guardianEnergy };
    const next = { ...data, energy: nextEnergy, sessions: [record, ...data.sessions].slice(0, 60) };
    persist(next, "今晚已经温和收尾"); playTone("complete");
    if (!next.rewardGoal.redeemed && nextEnergy >= next.rewardGoal.threshold) go("reward-achieved"); else go("home");
  };

  const metrics = useMemo(() => {
    if (!data.sessions.length) return null;
    const recent = data.sessions.slice(0, 7);
    return { nights: recent.length, completed: recent.reduce((sum, item) => sum + item.completedCount, 0), adjustments: recent.reduce((sum, item) => sum + item.adjustments, 0) };
  }, [data.sessions]);

  const exportData = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), family: data }, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "先开始-家庭数据.json"; a.click(); URL.revokeObjectURL(url); setToast("家庭数据已导出");
  };

  const deleteData = async () => {
    if (!window.confirm("确定删除孩子全部数据吗？此操作无法撤销。")) return;
    if (familyId) await fetch(`/api/state?familyId=${encodeURIComponent(familyId)}`, { method: "DELETE" }).catch(() => null);
    localStorage.removeItem(STORAGE_KEY); localStorage.removeItem("xian-kaishi-family-v1"); setData(DEFAULT_DATA); setConsent(false); setStages(DEFAULT_STAGES); go("welcome");
  };

  const modeLabel = { adult: "大人先安排", together: "一起安排", child: "孩子先安排" }[data.planningMode];
  const effortCopy = { 1: "一小步", 2: "需要专注", 3: "今天比较费力" } as const;
  const progress = Math.max(0, data.rewardGoal.threshold - data.energy);
  const goalReady = !data.rewardGoal.redeemed && progress === 0;

  return <main className={`site-shell ${data.reducedMotion ? "reduce-motion" : ""}`}>
    <div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <section className="phone-shell" aria-live="polite">
      {screen === "welcome" && <div className="screen welcome-screen">
        <div className="brand-mark"><AppIcon name="home-heart" /><strong>先开始</strong></div>
        <h1>今晚，一起商量再开始</h1><p className="lead">安排时间、共同启动、需要时随时调整。孩子只短暂看屏幕。</p>
        <Mascot />
        <div className="privacy-card"><strong>先把家庭数据放在安全边界内</strong><div className="privacy-points"><span>不读取社交平台</span><span>不录音监控</span><span>不收集年级学校</span></div></div>
        <label className="consent-row"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /><span>我已阅读并同意监护人授权与儿童隐私说明</span></label>
        <button className="primary-button" disabled={!consent} onClick={() => go("profile")}>继续设置</button>
      </div>}

      {screen === "profile" && <div className="screen">
        <Header back={() => go("welcome")} title="家庭设置" step="1/2" />
        <div className="title-with-mascot"><div><span className="eyebrow">只填写今晚真正会用到的信息</span><h1>今晚，谁一起安排？</h1></div><Mascot compact /></div>
        <div className="form-card family-form"><label>孩子怎么称呼<input maxLength={12} value={data.childAlias} onChange={e => setData({ ...data, childAlias: e.target.value })} /></label><label>大人怎么称呼<input maxLength={12} value={data.guardianAlias} onChange={e => setData({ ...data, guardianAlias: e.target.value })} /></label>
          <fieldset><legend>今晚主要由谁安排</legend><div className="mode-grid">{(["adult", "together", "child"] as PlanningMode[]).map(mode => <button key={mode} className={data.planningMode === mode ? "selected" : ""} onClick={() => setData({ ...data, planningMode: mode })}>{({ adult: "大人先安排", together: "一起安排", child: "孩子先安排" })[mode]}</button>)}</div></fieldset>
          <label>通常到家<input type="time" value={data.arrival} onChange={e => setData({ ...data, arrival: e.target.value })} /></label>
        </div>
        <p className="microcopy">不需要填写年级、学校、班级或真实姓名。</p><button className="primary-button" disabled={!data.childAlias.trim() || !data.guardianAlias.trim()} onClick={finishProfile}>保存家庭称呼</button>
      </div>}

      {screen === "home" && <div className="screen with-nav home-screen">
        <div className="home-hero"><div><span className="eyebrow">{data.arrival} · {modeLabel}</span><h1>今晚，一起找到舒服的节奏</h1><p>先排时间，再一起点亮开始。</p></div><Mascot mood="confirm" compact /></div>
        <button className="primary-button large" onClick={() => { setStages(DEFAULT_STAGES.map(item => ({ ...item, status: "pending" }))); go("plan"); }}>一起安排今晚 <span>›</span></button>
        <div className="insight-card sage"><span className="big-icon"><AppIcon name="quiet" /></span><div><small>今晚的默认提醒</small><strong>每个阶段只提醒一次，也可以继续或调整</strong></div></div>
        <button className="insight-card support-entry" onClick={() => go("energy")}><span className="big-icon"><AppIcon name="plant" /></span><div><small>家庭期待</small><strong>{data.rewardGoal.title}</strong><small>{data.rewardGoal.redeemed ? "已一起兑现，可以设置新期待" : progress ? `还差${progress}点` : "已经可以一起兑现"}</small></div><span>›</span></button>
        <div className="stats-row"><div><small>本周记录</small><strong>{data.sessions.length} 晚</strong></div><div><small>家庭能量</small><strong>{data.energy}</strong><div className="energy-leaves">{[1,2,3,4,5].map(n => <i className={n <= Math.min(5, Math.ceil(data.energy / 6)) ? "filled" : ""} key={n} />)}</div></div></div>
        <p className="sync-label">{syncLabel}</p><BottomNav screen={screen} go={go} />
      </div>}

      {screen === "plan" && <div className="screen plan-screen">
        <Header back={() => go("home")} title="一起安排今晚" step="1/3" />
        <div className="availability-card"><AppIcon name="moon" /><div><small>今晚可用时间</small><strong>{stages[0]?.start ?? "18:10"}—{stages.at(-1)?.end ?? "20:30"}</strong></div><Mascot compact /></div>
        <div className="plan-list">{stages.map((stage, index) => <div className={`stage-editor ${stage.status === "tomorrow" ? "muted-stage" : ""}`} key={stage.id}>
          <AppIcon name={stage.icon} /><div className="stage-main"><input className="stage-title-input" value={stage.title} onChange={e => updateStage(stage.id, { title: e.target.value })} /><div className="time-range"><input aria-label={`${stage.title}开始时间`} type="time" value={stage.start} onChange={e => updateStage(stage.id, { start: e.target.value })} /><span>—</span><input aria-label={`${stage.title}结束时间`} type="time" value={stage.end} onChange={e => updateStage(stage.id, { end: e.target.value })} /></div>{stage.kind === "task" && <button className={`effort-pill effort-${stage.effort}`} onClick={() => { setEditingStageId(stage.id); go("effort"); }}>{effortCopy[stage.effort]} · 调整</button>}</div>
          <div className="stage-actions"><button onClick={() => moveStage(index, -1)} disabled={index === 0} aria-label="向上移动">↑</button><button onClick={() => moveStage(index, 1)} disabled={index === stages.length - 1} aria-label="向下移动">↓</button><button onClick={() => setStages(items => items.filter(item => item.id !== stage.id))} aria-label={`删除${stage.title}`}>×</button></div>
        </div>)}</div>
        <div className="add-stage"><input placeholder="写下新的事项" value={customTitle} onChange={e => setCustomTitle(e.target.value)} onKeyDown={e => e.key === "Enter" && addStage()} /><button onClick={() => addStage()} disabled={!customTitle.trim()}>添加</button></div>
        <div className="template-row">{STAGE_TEMPLATES.map(([icon,title,kind]) => <button key={title} onClick={() => addStage(icon,title,kind)}><AppIcon name={icon} />{title}</button>)}</div>
        <div className="gentle-note">今晚安排可以随时调整。先装下真实需要处理的部分。</div><button className="primary-button" disabled={!stages.length} onClick={() => go("confirm")}>下一步：一起确认</button>
      </div>}

      {screen === "effort" && <div className="screen effort-screen">
        <Header back={() => go("plan")} />
        <span className="eyebrow">用来决定支持方式，不决定奖励</span><h1>这项今天需要多少力气？</h1>
        <div className="current-task-card"><AppIcon name={stages.find(item => item.id === editingStageId)?.icon ?? "pencil"} /><div><strong>{stages.find(item => item.id === editingStageId)?.title}</strong><small>没有标准答案，选今天的感觉就好</small></div></div>
        <div className="effort-options">{([1,2,3] as Effort[]).map(level => { const copy = { 1: ["一小步", "我可以先自己试试"], 2: ["需要专注", "请帮我把第一步说清楚"], 3: ["今天比较费力", "先缩小任务或多休息"] }[level]; const selected = stages.find(item => item.id === editingStageId)?.effort === level; return <button key={level} className={selected ? `selected effort-${level}` : `effort-${level}`} onClick={() => updateStage(editingStageId, { effort: level })}><span className="effort-leaves">{Array.from({ length: level }).map((_, i) => <i key={i} />)}</span><span><strong>{copy[0]}</strong><small>{copy[1]}</small></span><b>{selected ? "✓" : "○"}</b></button>; })}</div>
        <div className="support-suggestion"><Mascot mood="support" compact /><div><small>今晚建议</small><strong>{(stages.find(item => item.id === editingStageId)?.effort ?? 1) === 3 ? "先休息10分钟，再缩小第一步" : "从第一小步开始，卡住时再求助"}</strong><p>用力程度不会改变奖励，也不会给孩子打分。</p></div></div>
        <button className="primary-button" onClick={() => go("plan")}>保存到时间表</button>
      </div>}

      {screen === "confirm" && <div className="screen confirm-screen">
        <Header back={() => go("plan")} title="共同确认" step="2/3" /><h1>今晚的安排，我们一起确认</h1>
        <div className="summary-strip"><span><strong>{stages[0]?.start}</strong><small>开始</small></span><span><strong>{stages.filter(s => s.status !== "tomorrow").length}</strong><small>个阶段</small></span><span><strong>{stages.at(-1)?.end}</strong><small>左右收尾</small></span></div>
        <div className="promise-card guardian"><AppIcon name="family" /><span><strong>{data.guardianAlias}</strong><small>先给第一步留出空间</small></span></div><div className="promise-card child"><AppIcon name="home-heart" /><span><strong>{data.childAlias}</strong><small>卡住时可以主动说</small></span></div>
        <Mascot mood="confirm" /><div className="privacy-note">时间表不是命令。中途改变顺序、休息或移到明天，都不算失败。</div><button className="primary-button" onClick={() => go("dual-start")}>进入共同启动</button>
      </div>}

      {screen === "dual-start" && <div className="screen dual-start-screen">
        <Header back={() => go("confirm")} title="一起点亮" step="3/3" /><span className="eyebrow">可以同时按，也可以一个一个来</span><h1>两个人都准备好，就开始</h1><Mascot mood={guardianConfirmed && childConfirmed ? "celebrate" : "ready"} />
        <div className="light-bridge" data-ready={guardianConfirmed && childConfirmed} />
        <div className="dual-press"><button className={`press-zone guardian-zone ${guardianConfirmed ? "confirmed" : ""}`} onPointerDown={() => setGuardianConfirmed(true)} onClick={() => setGuardianConfirmed(true)}><span className="finger-tip"><small>{data.guardianAlias}</small></span><strong>{data.guardianAlias}</strong><small>{guardianConfirmed ? "准备好了" : "按住"}</small></button><button className={`press-zone child-zone ${childConfirmed ? "confirmed" : ""}`} onPointerDown={() => setChildConfirmed(true)} onClick={() => setChildConfirmed(true)}><span className="finger-tip"><small>{data.childAlias}</small></span><strong>{data.childAlias}</strong><small>{childConfirmed ? "准备好了" : "按住"}</small></button></div>
        <p className="child-copy">{guardianConfirmed && childConfirmed ? "今晚的安排，已经一起点亮" : "不需要完全同时，两个名字都亮起来就可以。"}</p>
      </div>}

      {screen === "running" && <div className="screen running-screen">
        <Header title="今晚进行中" /><div className="running-hero"><span className="eyebrow">当前阶段 · {activeIndex + 1}/{stages.filter(s => s.status !== "tomorrow").length}</span><Mascot mood="breathe" compact /></div>
        <div className="active-stage-card"><AppIcon name={activeStage.icon} /><div><small>{activeStage.start}—{activeStage.end}</small><h1>{activeStage.title}</h1><span className={`effort-pill effort-${activeStage.effort}`}>{effortCopy[activeStage.effort]}</span></div></div>
        <div className="calm-space"><strong>手机留在大人手里</strong><p>不记录坐姿、声音、人脸或孩子是否一直在桌前。</p></div>
        <div className="mini-timeline">{stages.map((stage, index) => <div key={stage.id} className={`${stage.status} ${index === activeIndex ? "now" : ""}`}><i /><span>{stage.title}</span><small>{stage.status === "done" ? "完成" : stage.status === "tomorrow" ? "明天" : stage.start}</small></div>)}</div>
        <button className="primary-button" onClick={stageFinished}>这一阶段可以收尾了</button><button className="secondary-button adjust-button" onClick={() => go("adjust")}>调整今晚计划</button>
      </div>}

      {screen === "transition" && <div className="screen transition-screen">
        <span className="eyebrow">阶段提醒 · 只提醒一次</span><h1>{activeStage.title}这一段预计到时间了</h1><p className="lead">不用马上切换，看看现在更适合哪一步。</p><div className="transition-art"><AppIcon name="moon" /><Mascot mood="confirm" /></div>
        <div className="transition-actions"><button className="primary-button" onClick={continueToNext}>进入下一阶段</button><button className="secondary-button" onClick={extendCurrent}>再继续10分钟</button><button className="soft-button" onClick={() => insertRest(true)}>先休息一下</button></div><button className="text-button" onClick={() => go("adjust")}>调整今晚计划</button>
        <div className="privacy-note">锁屏提醒只显示“该看看下一步了”，不展示孩子任务。</div>
      </div>}

      {screen === "adjust" && <div className="screen adjust-screen">
        <Header back={() => go("running")} title="调整今晚" /><div className="title-with-mascot"><div><span className="eyebrow">计划服务于家庭，而不是反过来</span><h1>现在更适合怎么调整？</h1></div><Mascot mood="support" compact /></div>
        <div className="adjust-grid">{([
          ["extend", "steps", "延长当前阶段", "加10分钟"], ["rest", "quiet", "先休息一下", "把状态缓下来"], ["swap", "speech", "调换下一项", "顺序可以改变"], ["tomorrow", "moon", "移到明天", "保留已经完成的进展"],
        ] as const).map(([id,icon,title,copy]) => <button key={id} className={adjustChoice === id ? "selected" : ""} onClick={() => setAdjustChoice(id)}><AppIcon name={icon} /><span><strong>{title}</strong><small>{copy}</small></span></button>)}</div>
        <div className="change-preview"><small>本次调整预览</small><strong>{adjustChoice === "extend" ? `${activeStage.title}延长10分钟` : adjustChoice === "rest" ? "下一阶段前加入10分钟休息" : adjustChoice === "swap" ? "调换后两项顺序" : "把下一项移到明天"}</strong></div>
        <div className="gentle-note">调整不会扣掉家庭能量，已经完成的进展会保留。</div><button className="primary-button" onClick={applyAdjustment}>双方确认调整</button><button className="text-button" onClick={() => go("running")}>取消</button>
      </div>}

      {screen === "wrap" && <div className="screen wrap-screen">
        <Header back={() => go("running")} /><span className="eyebrow">亲子一起 · 30秒</span><h1>今晚，温和收尾</h1><Mascot mood="celebrate" />
        <div className="wrap-summary"><div><strong>{stages.filter(s => s.status === "done").length}</strong><small>完成阶段</small></div><div><strong>{adjustments}</strong><small>次主动调整</small></div></div>
        <div className="energy-summary"><strong>今晚看见的积极行为</strong><span>{data.childAlias}：参与选择、卡住可以说 +2</span><span>{data.guardianAlias}：共同商量、没有连续催促 +2</span>{adjustments > 0 && <span>双方：一起调整计划 +1</span>}</div>
        <p className="lead">没有完成的事项可以留到明天，能量不会被扣掉。</p><button className="primary-button" onClick={finishNight}>结束今晚</button>
      </div>}

      {screen === "energy" && <div className="screen with-nav energy-screen">
        <Header title="家庭能量房间" /><div className="room-scene"><img className="room-art" src="/assets/energy-room-v2.png" alt="温暖的家庭学习角" /><div className="room-light" /><Mascot mood={goalReady ? "celebrate" : "ready"} /></div>
        <div className="energy-panel"><span className="eyebrow">共同积累，不给孩子打分</span><h1>{data.energy} 点家庭能量</h1><div className="energy-bar"><i style={{ width: `${Math.min(100, data.energy / data.rewardGoal.threshold * 100)}%` }} /></div></div>
        <div className="goal-card"><AppIcon name="game" /><div><small>家庭期待</small><strong>{data.rewardGoal.title}</strong><p>{data.rewardGoal.redeemed ? "已经一起兑现，可以开始新的家庭期待" : progress ? `还差${progress}点，一起积累，不用赶` : "已经点亮，可以一起兑现"}</p></div></div>
        {data.rewardGoal.redeemed ? <button className="secondary-button" onClick={() => go("reward-setup")}>设置新的家庭期待</button> : progress ? <button className="secondary-button" onClick={() => go("reward-setup")}>调整家庭期待</button> : <button className="primary-button" onClick={() => go("reward-achieved")}>查看达成图</button>}
        <div className="gentle-note">能量不会清零、倒扣或过期，也不会因为暂停而减少。</div><BottomNav screen={screen} go={go} />
      </div>}

      {screen === "reward-setup" && <div className="screen reward-setup-screen">
        <Header back={() => go("energy")} /><span className="eyebrow">一起定义值得期待的家庭时光</span><h1>一起定一个家庭期待</h1>
        <div className="threshold-card"><small>达到多少能量</small><div><button onClick={() => setData({ ...data, rewardGoal: { ...data.rewardGoal, threshold: Math.max(data.energy + 1, data.rewardGoal.threshold - 5) } })}>−</button><strong>{data.rewardGoal.threshold}</strong><button onClick={() => setData({ ...data, rewardGoal: { ...data.rewardGoal, threshold: data.rewardGoal.threshold + 5 } })}>＋</button></div></div>
        <label className="reward-input">实现这个期待：做什么<input value={data.rewardGoal.title} maxLength={24} onChange={e => setData({ ...data, rewardGoal: { ...data.rewardGoal, title: e.target.value } })} /></label>
        <div className="reward-row">{[["game","家庭游戏","周末一起玩桌游"],["book","选择故事","一起选睡前故事"],["move","一起散步","周末一起散步"]].map(([icon,label,title]) => <button key={label} className={data.rewardGoal.title === title ? "selected" : ""} onClick={() => setData({ ...data, rewardGoal: { ...data.rewardGoal, title } })}><AppIcon name={icon} /><small>{label}</small></button>)}</div>
        <label className="reward-input">计划兑现<input value={data.rewardGoal.date} onChange={e => setData({ ...data, rewardGoal: { ...data.rewardGoal, date: e.target.value } })} /></label>
        <div className="participant-row"><span>谁会一起参与</span><strong>{data.guardianAlias}　✓</strong><strong>{data.childAlias}　✓</strong></div><div className="gentle-note">不建议设置现金、充值或高价商品。优先选择可以一起完成的家庭活动。</div>
        <button className="primary-button" onClick={() => { persist({ ...data, rewardGoal: { ...data.rewardGoal, participants: [data.guardianAlias, data.childAlias], redeemed: false } }, "家庭期待已保存"); go("energy"); }}>保存家庭期待</button>
      </div>}

      {screen === "reward-achieved" && <div className="screen achievement-screen">
        <span className="eyebrow">家庭期待已点亮</span><h1>你们一起积累到了</h1><div className="achievement-energy"><strong>{data.rewardGoal.threshold}</strong><span>点家庭能量</span></div>
        <div className="achievement-art"><img src="/assets/energy-room-v2.png" alt="点亮的家庭房间" /><Mascot mood="celebrate" /><AppIcon name="game" /></div>
        <div className="achievement-card"><AppIcon name="game" /><div><strong>{data.rewardGoal.title}</strong><p>这是一起兑现的家庭时光</p></div></div>
        <button className="primary-button" onClick={() => { persist({ ...data, rewardGoal: { ...data.rewardGoal, redeemed: true } }, "已经记录为一起兑现"); go("energy"); }}>已经一起兑现</button><button className="secondary-button" onClick={() => { setToast(`已计划到${data.rewardGoal.date}`); go("energy"); }}>计划到{data.rewardGoal.date}</button><p className="microcopy">能量不会因此清零。</p>
      </div>}

      {screen === "review" && <div className="screen with-nav review-screen">
        <Header title="每周复盘" /><span className="eyebrow">看见规律，不给孩子打分</span><h1>这一周，什么真正有帮助？</h1>
        {metrics ? <><div className="metric-grid"><div><AppIcon name="moon" /><small>记录晚数</small><strong>{metrics.nights}晚</strong></div><div><AppIcon name="check" /><small>完成阶段</small><strong>{metrics.completed}个</strong></div><div><AppIcon name="speech" /><small>主动调整</small><strong>{metrics.adjustments}次</strong></div></div><div className="review-insight"><AppIcon name="plant" /><div><small>本周观察</small><strong>{metrics.adjustments ? "会调整计划，比硬撑着完成更接近真实的自主" : "先一起安排，再离开屏幕，节奏更清楚"}</strong></div></div></> : <div className="empty-review"><Mascot mood="breathe" compact /><strong>完成一个晚间流程后，这里会出现家庭规律</strong><p>不需要追求连续记录。</p></div>}
        <BottomNav screen={screen} go={go} />
      </div>}

      {screen === "settings" && <div className="screen with-nav settings-screen">
        <Header title="设置" /><div className="settings-group"><h2>家庭称呼</h2><div className="setting-row"><span>孩子化名</span><strong>{data.childAlias}</strong></div><div className="setting-row"><span>大人称呼</span><strong>{data.guardianAlias}</strong></div><div className="setting-row"><span>安排方式</span><strong>{modeLabel}</strong></div><button className="setting-action" onClick={() => go("profile")}>修改家庭设置 <span>›</span></button></div>
        <div className="settings-group"><h2>体验偏好</h2><label className="toggle-row"><span><strong>温和提示音</strong><small>确认、阶段转换和收尾</small></span><input type="checkbox" checked={data.sound} onChange={e => persist({ ...data, sound: e.target.checked })} /></label><label className="toggle-row"><span><strong>减少动态效果</strong><small>关闭呼吸、漂浮和庆祝动画</small></span><input type="checkbox" checked={data.reducedMotion} onChange={e => persist({ ...data, reducedMotion: e.target.checked })} /></label></div>
        <div className="settings-group"><h2>隐私与数据</h2><div className="setting-row"><span>未收集年级和学校</span><strong>已启用</strong></div><div className="setting-row"><span>数据状态</span><strong>{syncLabel}</strong></div><button className="setting-action" onClick={exportData}>导出家庭数据 <span>›</span></button><button className="setting-action danger" onClick={deleteData}>删除孩子全部数据 <span>›</span></button></div>
        <button className="risk-entry" onClick={() => go("risk")}><AppIcon name="privacy" /><div><strong>有些情况，需要更多支持</strong><small>查看风险提示与转介建议</small></div><span>›</span></button><BottomNav screen={screen} go={go} />
      </div>}

      {screen === "risk" && <div className="screen risk-screen"><Header back={() => go("settings")} /><span className="eyebrow">风险边界</span><h1>有些情况，需要更多支持</h1><p className="lead">这个工具不做诊断，也不能替代专业评估。</p><div className="risk-list"><div><AppIcon name="home-heart" /><strong>困难长期存在于家庭和学校多个场景</strong></div><div><AppIcon name="moon" /><strong>持续拒学或明显躯体不适</strong></div><div><AppIcon name="privacy" /><strong>严重情绪变化或自伤表达</strong></div></div><div className="next-actions"><h2>接下来可以</h2><button onClick={() => setToast("今晚流程已暂停")}>1　先暂停今晚流程</button><button onClick={() => setToast("建议记录事实后联系老师")}>2　联系学校老师</button><button onClick={() => setToast("请选择正规医疗机构")}>3　寻找正规医疗机构</button></div><div className="urgent-note"><strong>存在立即安全风险时</strong><p>请优先联系当地急救或警方，并让可信任的成年人陪在孩子身边。</p></div></div>}

      {toast && <div className="toast" role="status">{toast}</div>}
    </section>
    <aside className="desktop-note"><span className="brand-mark"><AppIcon name="home-heart" /><strong>先开始</strong></span><h2>今晚少催一次，从共同商量开始。</h2><p>共同排时间、双人点亮、阶段柔和提醒，计划随时可以改。</p><div className="desktop-points"><span>不讲题</span><span>不监控</span><span>不比较</span></div></aside>
  </main>;
}
