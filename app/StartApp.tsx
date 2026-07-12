"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Task = {
  id: string;
  title: string;
  icon: string;
  steps: [string, string];
};

type SessionRecord = {
  id: string;
  date: string;
  tasks: string[];
  rest: string;
  firstStep: string;
  outcome: "done" | "partial" | "paused";
  difficulty: "easy" | "same" | "hard";
  latency: number;
  reminders: number;
  conflict: number;
  childEnergy: number;
  parentEnergy: number;
};

type AppData = {
  consent: boolean;
  alias: string;
  grade: string;
  arrival: string;
  defaultRest: string;
  energy: number;
  sound: boolean;
  reducedMotion: boolean;
  sessions: SessionRecord[];
};

type Screen =
  | "welcome"
  | "profile"
  | "home"
  | "tasks"
  | "negotiate"
  | "rest"
  | "confirm"
  | "first-step"
  | "quiet"
  | "work"
  | "support"
  | "intervene"
  | "outcome"
  | "wrap"
  | "energy"
  | "review"
  | "settings"
  | "risk";

const STORAGE_KEY = "xian-kaishi-family-v1";

const INITIAL_DATA: AppData = {
  consent: false,
  alias: "小橙",
  grade: "二年级",
  arrival: "17:30",
  defaultRest: "活动一下 10分钟",
  energy: 6,
  sound: true,
  reducedMotion: false,
  sessions: [],
};

const TASK_LIBRARY: Task[] = [
  { id: "reading", title: "阅读15分钟", icon: "📖", steps: ["把书翻到今天开始的那一页", "先读第一段"] },
  { id: "math", title: "数学练习", icon: "🧮", steps: ["先读第一项要求", "找出最容易的一题"] },
  { id: "bag", title: "整理书包", icon: "🎒", steps: ["把书包放到桌边", "拿出明天第一节课的书"] },
  { id: "recite", title: "朗读与背诵", icon: "🗣️", steps: ["先完整读一遍", "只读第一句"] },
  { id: "writing", title: "书写练习", icon: "✏️", steps: ["先写日期和标题", "先在草稿纸写第一行"] },
];

const REST_OPTIONS = [
  { id: "snack", icon: "🥣", title: "吃点东西", time: "15分钟" },
  { id: "move", icon: "🤸", title: "活动一下", time: "10分钟" },
  { id: "quiet", icon: "🌿", title: "安静待会儿", time: "10分钟" },
  { id: "tiny", icon: "🪴", title: "先做一个小动作", time: "再休息" },
];

function createId(prefix: string) {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

function Mascot({ mood = "ready", compact = false }: { mood?: "ready" | "breathe" | "celebrate"; compact?: boolean }) {
  return (
    <div className={`mascot mascot-${mood} ${compact ? "mascot-compact" : ""}`} aria-hidden="true">
      <div className="mascot-halo" />
      <img src="/assets/warm-lamp.png" alt="" />
    </div>
  );
}

function Header({ title, onBack, step }: { title?: string; onBack?: () => void; step?: string }) {
  return (
    <header className="app-header">
      {onBack ? <button className="icon-button" onClick={onBack} aria-label="返回">‹</button> : <span className="header-spacer" />}
      {title ? <strong>{title}</strong> : <span />}
      {step ? <span className="step-pill">{step}</span> : <span className="header-spacer" />}
    </header>
  );
}

function BottomNav({ screen, go }: { screen: Screen; go: (screen: Screen) => void }) {
  const items: Array<{ id: Screen; icon: string; label: string }> = [
    { id: "home", icon: "⌂", label: "首页" },
    { id: "review", icon: "▤", label: "复盘" },
    { id: "energy", icon: "❧", label: "能量" },
    { id: "settings", icon: "⚙", label: "设置" },
  ];
  return (
    <nav className="bottom-nav" aria-label="主导航">
      {items.map((item) => (
        <button key={item.id} className={screen === item.id ? "active" : ""} onClick={() => go(item.id)}>
          <span>{item.icon}</span><small>{item.label}</small>
        </button>
      ))}
    </nav>
  );
}

function EnergyLeaves({ value }: { value: number }) {
  const filled = Math.min(5, Math.max(1, Math.round(value / 5)));
  return <div className="energy-leaves" aria-label={`家庭能量 ${value}`}>{[1, 2, 3, 4, 5].map((n) => <span key={n} className={n <= filled ? "filled" : ""}>◆</span>)}</div>;
}

export function StartApp() {
  const [data, setData] = useState<AppData>(INITIAL_DATA);
  const [familyId, setFamilyId] = useState("");
  const [screen, setScreen] = useState<Screen>("welcome");
  const [consentChecked, setConsentChecked] = useState(false);
  const [selectedTasks, setSelectedTasks] = useState<Task[]>(TASK_LIBRARY.slice(0, 3));
  const [customTask, setCustomTask] = useState("");
  const [restChoice, setRestChoice] = useState(REST_OPTIONS[1]);
  const [firstStep, setFirstStep] = useState(TASK_LIBRARY[2].steps[0]);
  const [supportType, setSupportType] = useState("clarify");
  const [outcome, setOutcome] = useState<SessionRecord["outcome"]>("done");
  const [difficulty, setDifficulty] = useState<SessionRecord["difficulty"]>("same");
  const [wrapChecks, setWrapChecks] = useState([false, false, false]);
  const [toast, setToast] = useState("");
  const [syncLabel, setSyncLabel] = useState("本机已保存");
  const hydrated = useRef(false);

  const go = (next: Screen) => {
    setScreen(next);
    window.scrollTo({ top: 0, behavior: data.reducedMotion ? "auto" : "smooth" });
  };

  useEffect(() => {
    const existingId = localStorage.getItem("xian-kaishi-family-id") || createId("family");
    localStorage.setItem("xian-kaishi-family-id", existingId);
    setFamilyId(existingId);
    const local = localStorage.getItem(STORAGE_KEY);
    if (local) {
      try {
        const parsed = JSON.parse(local) as AppData;
        setData(parsed);
        setConsentChecked(parsed.consent);
        setScreen(parsed.consent ? "home" : "welcome");
      } catch { /* keep safe defaults */ }
    }
    fetch(`/api/state?familyId=${encodeURIComponent(existingId)}`)
      .then((response) => response.json())
      .then((result) => {
        if (result.data) {
          setData(result.data);
          setConsentChecked(result.data.consent);
          setScreen(result.data.consent ? "home" : "welcome");
          localStorage.setItem(STORAGE_KEY, JSON.stringify(result.data));
          setSyncLabel("云端已同步");
        }
      })
      .catch(() => setSyncLabel("仅保存在本机"))
      .finally(() => { hydrated.current = true; });
  }, []);

  const persist = (next: AppData, message?: string) => {
    setData(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSyncLabel("正在保存…");
    if (message) {
      setToast(message);
      window.setTimeout(() => setToast(""), 2200);
    }
    if (familyId) {
      fetch(`/api/state?familyId=${encodeURIComponent(familyId)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      })
        .then((response) => response.json())
        .then((result) => setSyncLabel(result.localOnly ? "仅保存在本机" : "云端已同步"))
        .catch(() => setSyncLabel("仅保存在本机"));
    }
  };

  const playTone = (kind: "confirm" | "start" | "support" | "complete") => {
    if (!data.sound || typeof window === "undefined") return;
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const frequencies = { confirm: 520, start: 610, support: 440, complete: 720 };
    oscillator.frequency.value = frequencies[kind];
    oscillator.type = "sine";
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.07, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.45);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.48);
  };

  const addTemplate = (task: Task) => {
    if (selectedTasks.some((item) => item.id === task.id) || selectedTasks.length >= 3) return;
    setSelectedTasks((items) => [...items, task]);
  };

  const removeTask = (id: string) => setSelectedTasks((items) => items.filter((item) => item.id !== id));

  const moveTask = (index: number, direction: -1 | 1) => {
    const next = [...selectedTasks];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setSelectedTasks(next);
  };

  const addCustomTask = () => {
    const title = customTask.trim();
    if (!title || selectedTasks.length >= 3) return;
    setSelectedTasks((items) => [...items, {
      id: createId("custom"), title, icon: "📝", steps: ["先读一遍要求", "只完成第一个小动作"],
    }]);
    setCustomTask("");
  };

  const firstTask = selectedTasks[0] || TASK_LIBRARY[2];

  const finishOnboarding = () => {
    const next = { ...data, consent: true };
    persist(next, "家庭节奏已保存");
    playTone("confirm");
    go("home");
  };

  const completeSession = () => {
    const childEnergy = outcome === "paused" ? 1 : 2;
    const parentEnergy = 2;
    const record: SessionRecord = {
      id: createId("session"),
      date: new Date().toISOString(),
      tasks: selectedTasks.map((task) => task.title),
      rest: `${restChoice.title} ${restChoice.time}`,
      firstStep,
      outcome,
      difficulty,
      latency: outcome === "paused" ? 18 : 12,
      reminders: 1,
      conflict: outcome === "paused" ? 1 : 0,
      childEnergy,
      parentEnergy,
    };
    const next = {
      ...data,
      energy: data.energy + childEnergy + parentEnergy,
      sessions: [record, ...data.sessions].slice(0, 60),
    };
    persist(next, "今晚已经温和收尾");
    playTone("complete");
    setWrapChecks([false, false, false]);
    go("home");
  };

  const metrics = useMemo(() => {
    const sessions = data.sessions.slice(0, 7);
    if (!sessions.length) return null;
    const average = (key: "latency" | "reminders" | "conflict") =>
      Math.round(sessions.reduce((sum, item) => sum + item[key], 0) / sessions.length);
    return { latency: average("latency"), reminders: average("reminders"), conflict: sessions.filter((item) => item.conflict > 0).length };
  }, [data.sessions]);

  const exportData = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), family: data }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "先开始-家庭数据.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setToast("家庭数据已导出");
  };

  const deleteAllData = async () => {
    if (!window.confirm("确定删除孩子全部数据吗？此操作无法撤销。")) return;
    if (familyId) await fetch(`/api/state?familyId=${encodeURIComponent(familyId)}`, { method: "DELETE" }).catch(() => null);
    localStorage.removeItem(STORAGE_KEY);
    const nextId = createId("family");
    localStorage.setItem("xian-kaishi-family-id", nextId);
    setFamilyId(nextId);
    setData(INITIAL_DATA);
    setConsentChecked(false);
    setSyncLabel("本机已清除");
    go("welcome");
  };

  return (
    <main className={`site-shell ${data.reducedMotion ? "reduce-motion" : ""}`}>
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <section className="phone-shell" aria-live="polite">
        {screen === "welcome" && (
          <div className="screen welcome-screen">
            <div className="brand-mark"><span>⌂</span><strong>先开始</strong></div>
            <h1>今晚，一起商量再开始</h1>
            <p className="lead">家长是主要使用者，孩子只在选择和收尾时短暂使用。</p>
            <Mascot mood="ready" />
            <div className="privacy-card">
              <strong>把家庭数据放在安全边界内</strong>
              <div className="privacy-points"><span>不读取微信群</span><span>不录音监控</span><span>不公开孩子数据</span></div>
            </div>
            <label className="consent-row">
              <input type="checkbox" checked={consentChecked} onChange={(event) => setConsentChecked(event.target.checked)} />
              <span>我已阅读并同意监护人授权与儿童隐私说明</span>
            </label>
            <button className="primary-button" disabled={!consentChecked} onClick={() => go("profile")}>继续设置</button>
          </div>
        )}

        {screen === "profile" && (
          <div className="screen">
            <Header onBack={() => go("welcome")} step="1/2" />
            <div className="title-with-mascot"><div><span className="eyebrow">家庭节奏</span><h1>先了解你们家的节奏</h1></div><Mascot compact /></div>
            <div className="form-card">
              <label>孩子化名<input value={data.alias} maxLength={12} onChange={(event) => setData({ ...data, alias: event.target.value })} /></label>
              <fieldset><legend>年级</legend><div className="chip-row">{["一年级", "二年级", "三年级"].map((grade) => <button key={grade} className={data.grade === grade ? "chip selected" : "chip"} onClick={() => setData({ ...data, grade })}>{grade}</button>)}</div></fieldset>
              <label>通常到家<input type="time" value={data.arrival} onChange={(event) => setData({ ...data, arrival: event.target.value })} /></label>
              <fieldset><legend>到家后更需要</legend><div className="choice-grid compact-grid">{REST_OPTIONS.slice(0, 3).map((item) => <button key={item.id} className={data.defaultRest.startsWith(item.title) ? "choice-card selected" : "choice-card"} onClick={() => setData({ ...data, defaultRest: `${item.title} ${item.time}` })}><span>{item.icon}</span><strong>{item.title}</strong></button>)}</div></fieldset>
            </div>
            <p className="microcopy">只使用化名；不需要填写学校、班级或真实姓名。</p>
            <button className="primary-button" onClick={finishOnboarding}>开始使用</button>
          </div>
        )}

        {screen === "home" && (
          <div className="screen home-screen with-nav">
            <div className="home-hero">
              <div><span className="eyebrow">{data.arrival} · 放学后</span><h1>今晚，一起商量再开始</h1><p>用3分钟安排任务、休息和第一小步。</p></div>
              <Mascot compact />
            </div>
            <button className="primary-button large" onClick={() => { playTone("confirm"); go("tasks"); }}>一起安排今晚 <span>›</span></button>
            <div className="insight-card sage"><span className="big-icon">🌿</span><div><small>上次有效做法</small><strong>先休息15分钟，再从容易的一项开始</strong></div></div>
            <button className="insight-card support-entry" onClick={() => { setSupportType("parent"); go("intervene"); }}><span className="big-icon">◉</span><div><small>又卡住了</small><strong>获得即时支持</strong></div><span>›</span></button>
            <div className="stats-row">
              <div><small>本周记录</small><strong>{data.sessions.length} 晚</strong></div>
              <div><small>家庭能量</small><strong>{data.energy}</strong><EnergyLeaves value={data.energy} /></div>
            </div>
            <p className="sync-label">{syncLabel}</p>
            <BottomNav screen={screen} go={go} />
          </div>
        )}

        {screen === "tasks" && (
          <div className="screen">
            <Header onBack={() => go("home")} step="1/4" />
            <span className="eyebrow">今晚事项</span><h1>今晚有哪些事？</h1><p className="lead">只添加真实需要处理的事项，最多先选3件。</p>
            <div className="input-composer"><input placeholder="例：阅读15分钟，整理书包" value={customTask} onChange={(event) => setCustomTask(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addCustomTask()} /><button onClick={addCustomTask} disabled={!customTask.trim() || selectedTasks.length >= 3}>添加</button></div>
            <small className="section-label">常用模板</small>
            <div className="template-row">{TASK_LIBRARY.map((task) => <button key={task.id} disabled={selectedTasks.some((item) => item.id === task.id) || selectedTasks.length >= 3} onClick={() => addTemplate(task)}>{task.icon} {task.title.replace(/\d+分钟/, "")}</button>)}</div>
            <div className="selected-list">{selectedTasks.map((task) => <div className="task-row" key={task.id}><span>{task.icon}</span><strong>{task.title}</strong><button onClick={() => removeTask(task.id)} aria-label={`移除${task.title}`}>×</button></div>)}</div>
            <div className="privacy-note">粘贴内容只在你确认后成为事项；我们不会读取微信或学校系统。</div>
            <button className="primary-button" disabled={!selectedTasks.length} onClick={() => go("negotiate")}>下一步：一起商量</button>
          </div>
        )}

        {screen === "negotiate" && (
          <div className="screen shared-screen">
            <Header onBack={() => go("tasks")} step="2/4" />
            <span className="eyebrow">家长与孩子共用</span><h1>今晚，一起商量</h1><p className="lead">家长提出边界，孩子决定顺序。</p>
            <div className="role-balance"><div><span>家长</span><strong>说明必须处理的范围</strong></div><div><span>孩子</span><strong>选择顺序和第一步</strong></div></div>
            <div className="ordered-list">{selectedTasks.map((task, index) => <div className="ordered-task" key={task.id}><span className="order-number">{index + 1}</span><span>{task.icon}</span><strong>{task.title}</strong><div className="order-actions"><button onClick={() => moveTask(index, -1)} disabled={index === 0} aria-label="向上移动">↑</button><button onClick={() => moveTask(index, 1)} disabled={index === selectedTasks.length - 1} aria-label="向下移动">↓</button></div></div>)}</div>
            <div className="gentle-note">今晚最多3件。任务太大时，可以只保留真正需要完成的部分。</div>
            <button className="primary-button" onClick={() => go("rest")}>下一步：选休息</button>
          </div>
        )}

        {screen === "rest" && (
          <div className="screen shared-screen">
            <Header onBack={() => go("negotiate")} step="3/4" />
            <span className="eyebrow">共同选择</span><h1>先选怎么恢复一下</h1><p className="lead">休息不是奖励，是今晚计划的一部分。</p>
            <div className="choice-grid">{REST_OPTIONS.map((item) => <button key={item.id} className={restChoice.id === item.id ? "choice-card selected" : "choice-card"} onClick={() => setRestChoice(item)}><span>{item.icon}</span><strong>{item.title}</strong><small>{item.time}</small></button>)}</div>
            <div className="plan-preview">选择后：<strong>{restChoice.title} {restChoice.time}</strong>，再从“{firstTask.title}”开始。</div>
            <button className="primary-button" onClick={() => go("confirm")}>确认休息安排</button>
          </div>
        )}

        {screen === "confirm" && (
          <div className="screen">
            <Header onBack={() => go("rest")} step="4/4" />
            <div className="title-with-mascot"><div><span className="eyebrow">今晚计划</span><h1>今晚就这样开始</h1></div><Mascot compact /></div>
            <div className="timeline"><div><span>1</span><p><strong>{data.arrival}</strong> 到家，{restChoice.title}</p></div>{selectedTasks.map((task, index) => <div key={task.id}><span>{index + 2}</span><p>{index === 0 ? "先" : "再"} <strong>{task.title}</strong></p></div>)}<div><span>✓</span><p><strong>温和收尾</strong></p></div></div>
            <div className="promise-grid"><div><span>家长</span><strong>不连续催促</strong></div><div><span>孩子</span><strong>卡住时主动求助</strong></div></div>
            <button className="primary-button" onClick={() => { playTone("confirm"); go("first-step"); }}>把手机给孩子选第一步</button>
          </div>
        )}

        {screen === "first-step" && (
          <div className="screen child-screen">
            <Mascot mood="ready" compact />
            <span className="eyebrow">现在由孩子选择</span><h1>你想从哪一小步开始？</h1>
            <div className="first-step-grid">{firstTask.steps.map((step, index) => <button key={step} className={firstStep === step ? "first-step-card selected" : "first-step-card"} onClick={() => setFirstStep(step)}><span>{index === 0 ? firstTask.icon : "⭐"}</span><strong>{step}</strong></button>)}</div>
            <p className="child-copy">没有选错，选一个就可以。</p>
            <button className="primary-button" onClick={() => { playTone("start"); navigator.vibrate?.(30); go("quiet"); }}>我选好了</button>
            <small>选好后，把手机还给大人</small>
          </div>
        )}

        {screen === "quiet" && (
          <div className="screen quiet-screen">
            <Mascot mood="breathe" />
            <h1>现在，先不追加第二条指令</h1>
            <p className="lead">{data.alias}选择了：<strong>{firstStep}</strong></p>
            <div className="breathing-ring"><span>3分钟</span><small>给这一小步一点空间</small></div>
            <div className="two-buttons"><button className="primary-button" onClick={() => go("work")}>已经开始</button><button className="secondary-button" onClick={() => { playTone("support"); go("support"); }}>需要支持</button></div>
            <div className="privacy-note">孩子正在离屏完成，手机留在大人手里。</div>
          </div>
        )}

        {screen === "work" && (
          <div className="screen">
            <Header onBack={() => go("quiet")} />
            <div className="title-with-mascot"><div><span className="eyebrow">离屏执行中</span><h1>第一小步已经开始</h1></div><Mascot compact /></div>
            <div className="current-task-card"><span>{firstTask.icon}</span><div><small>当前事项</small><strong>{firstTask.title}</strong><p>{firstStep}</p></div></div>
            <div className="calm-space"><span>让屏幕安静下来</span><p>不记录坐姿、声音或人脸。需要时再回来。</p></div>
            <button className="primary-button" onClick={() => go("outcome")}>这一项可以收尾了</button>
            <button className="text-button" onClick={() => go("support")}>中途需要支持</button>
          </div>
        )}

        {screen === "support" && (
          <div className="screen child-screen">
            <Header onBack={() => go("quiet")} />
            <Mascot mood="breathe" compact />
            <h1>卡住了也可以说</h1><p className="lead">选择求助不会扣掉家庭能量。</p>
            <div className="choice-grid support-grid">
              {[
                ["smaller", "🪜", "把这一步再变小"],
                ["clarify", "💬", "请大人帮我看要求"],
                ["break", "🌿", "休息5分钟"],
                ["pause", "🌙", "今晚先停这项"],
              ].map(([id, icon, title]) => <button key={id} className="choice-card" onClick={() => { setSupportType(id); go("intervene"); }}><span>{icon}</span><strong>{title}</strong></button>)}
            </div>
          </div>
        )}

        {screen === "intervene" && (
          <div className="screen">
            <Header onBack={() => go(screen === "intervene" && supportType === "parent" ? "home" : "support")} />
            <span className="eyebrow">给家长的即时支持</span>
            <h1>{supportType === "pause" ? "今晚可以先停这项" : supportType === "break" ? "先让状态缓下来" : supportType === "smaller" ? "把任务再变小一点" : "先帮他看要求，不替他完成"}</h1>
            <div className="speech-card"><small>可以这样说</small><blockquote>{supportType === "pause" ? "“我们先把这项放在这里，明天再决定怎么处理。”" : supportType === "break" ? "“我们先休息五分钟，回来只讨论第一步。”" : supportType === "smaller" ? "“我们先只做刚才选的这一小步，其他的等一下再看。”" : "“你指出最不明白的那一句，我先帮你看要求。”"}</blockquote></div>
            <div className="boundary-card"><span>✓</span><p><strong>介入边界</strong><br />只澄清任务，不评价速度和态度。</p></div>
            <div className="action-stack"><button className="primary-button" onClick={() => supportType === "pause" ? go("outcome") : go("work")}>继续下一步</button><button className="secondary-button" onClick={() => go("outcome")}>先暂停</button></div>
            <button className="parent-pause" onClick={() => { setSupportType("parent"); setToast("请先离开现场两分钟，必要时让另一位成人接替"); }}><Mascot mood="breathe" compact /><span><strong>我快忍不住了</strong><small>先离开一步，等情绪平稳再回来。</small></span></button>
          </div>
        )}

        {screen === "outcome" && (
          <div className="screen">
            <Header onBack={() => go("work")} />
            <div className="title-with-mascot"><div><span className="eyebrow">结束这一项</span><h1>这一项怎么收尾？</h1></div><Mascot compact /></div>
            <div className="outcome-list">{[
              ["done", "✓", "完成了", "这项可以收好了"],
              ["partial", "◔", "完成了一部分", "保留进展，明天接着来"],
              ["paused", "☾", "今晚先暂停", "状态比勉强继续更重要"],
            ].map(([id, icon, title, copy]) => <button key={id} className={outcome === id ? "outcome-card selected" : "outcome-card"} onClick={() => setOutcome(id as SessionRecord["outcome"])}><span>{icon}</span><div><strong>{title}</strong><small>{copy}</small></div></button>)}</div>
            <div className="energy-summary"><strong>已经获得的能量不会被扣掉</strong><span>孩子：主动选择 +1</span><span>家长：没有连续催促 +2</span></div>
            <button className="primary-button" onClick={() => go("wrap")}>进入今晚收尾</button>
          </div>
        )}

        {screen === "wrap" && (
          <div className="screen night-screen">
            <Header onBack={() => go("outcome")} />
            <div className="night-title"><span className="eyebrow">亲子一起 · 30秒</span><h1>今晚，温和收尾</h1></div>
            <div className="wrap-list">{[
              ["📚", "放好已经完成的内容"],
              ["🚩", "标记需要老师帮助的事项"],
              ["🎒", "整理明天要带的东西"],
            ].map(([icon, title], index) => <button key={title} className={wrapChecks[index] ? "wrap-item checked" : "wrap-item"} onClick={() => setWrapChecks((items) => items.map((value, i) => i === index ? !value : value))}><span>{icon}</span><strong>{title}</strong><span>{wrapChecks[index] ? "✓" : "○"}</span></button>)}</div>
            <small className="section-label">今天开始时</small>
            <div className="difficulty-row">{[
              ["easy", "🙂", "比想象中容易"], ["same", "😐", "差不多"], ["hard", "🌧️", "还是有点难"],
            ].map(([id, icon, label]) => <button key={id} className={difficulty === id ? "selected" : ""} onClick={() => setDifficulty(id as SessionRecord["difficulty"])}><span>{icon}</span><small>{label}</small></button>)}</div>
            <button className="primary-button" onClick={completeSession}>结束今晚</button>
          </div>
        )}

        {screen === "energy" && (
          <div className="screen with-nav energy-screen">
            <Header title="家庭能量房间" />
            <div className="room-scene"><div className="window-light" /><div className="room-plant">☘</div><Mascot mood="celebrate" /><div className="room-rug" /></div>
            <div className="energy-panel"><span className="eyebrow">这周一起积累</span><h1>{data.energy} 点能量</h1><div className="energy-bar"><i style={{ width: `${Math.min(100, data.energy * 4)}%` }} /></div><div className="contribution-grid"><div><small>孩子的自主选择</small><strong>{Math.round(data.energy * .45)}</strong></div><div><small>家长的支持行为</small><strong>{Math.round(data.energy * .55)}</strong></div></div></div>
            <small className="section-label">可以一起选择</small>
            <div className="reward-row">{[["🎲", "周末家庭游戏"], ["📚", "选择一次睡前故事"], ["🪴", "给房间添一盆植物"]].map(([icon, title]) => <button key={title} onClick={() => setToast("已经加入本周家庭选择")}><span>{icon}</span><small>{title}</small></button>)}</div>
            <div className="gentle-note">能量不会清零，也不会因为暂停而减少。</div>
            <BottomNav screen={screen} go={go} />
          </div>
        )}

        {screen === "review" && (
          <div className="screen with-nav review-screen">
            <Header title="每周复盘" />
            <span className="eyebrow">看见规律，不给孩子打分</span><h1>这一周，什么真正有帮助？</h1>
            {metrics ? <><div className="metric-grid"><div><span>◷</span><small>启动等待</small><strong>{metrics.latency}分钟</strong></div><div><span>♢</span><small>提醒次数</small><strong>{metrics.reminders}次</strong></div><div><span>☾</span><small>明显冲突</small><strong>{metrics.conflict}晚</strong></div></div><div className="review-insight"><span>✎</span><div><small>本周观察</small><strong>{data.sessions.some((item) => item.difficulty === "hard") ? "困难更常出现在状态不足的晚上" : "先休息，再从最小一步开始更顺畅"}</strong></div></div></> : <div className="empty-review"><Mascot mood="breathe" compact /><strong>完成一个晚间流程后，这里会出现家庭规律</strong><p>不需要追求连续记录。</p></div>}
            <div className="one-change"><span>下周只改一件事</span><strong>到家后固定恢复15分钟</strong><button onClick={() => setToast("已经保存为下周尝试")}>保存尝试</button></div>
            <BottomNav screen={screen} go={go} />
          </div>
        )}

        {screen === "settings" && (
          <div className="screen with-nav settings-screen">
            <Header title="设置" />
            <div className="settings-group"><h2>体验偏好</h2><label className="toggle-row"><span><strong>温和提示音</strong><small>确认、开始、支持与收尾</small></span><input type="checkbox" checked={data.sound} onChange={(event) => persist({ ...data, sound: event.target.checked })} /></label><label className="toggle-row"><span><strong>减少动态效果</strong><small>关闭呼吸、漂浮和弹跳动画</small></span><input type="checkbox" checked={data.reducedMotion} onChange={(event) => persist({ ...data, reducedMotion: event.target.checked })} /></label></div>
            <div className="settings-group"><h2>隐私与数据</h2><div className="setting-row"><span>监护人授权</span><strong>已同意</strong></div><div className="setting-row"><span>孩子档案</span><strong>仅使用化名</strong></div><div className="setting-row"><span>云端最小记录</span><strong>{syncLabel}</strong></div><button className="setting-action" onClick={exportData}>导出家庭数据 <span>›</span></button><button className="setting-action danger" onClick={deleteAllData}>删除孩子全部数据 <span>›</span></button></div>
            <button className="risk-entry" onClick={() => go("risk")}><span>♡</span><div><strong>有些情况，需要更多支持</strong><small>查看风险提示与转介建议</small></div><span>›</span></button>
            <div className="privacy-note">我们不收集学校、精确位置、通讯录、人脸和连续录音。</div>
            <BottomNav screen={screen} go={go} />
          </div>
        )}

        {screen === "risk" && (
          <div className="screen risk-screen">
            <Header onBack={() => go("settings")} />
            <span className="eyebrow">风险边界</span><h1>有些情况，需要更多支持</h1><p className="lead">这个工具不做诊断，也不能替代专业评估。</p>
            <div className="risk-list"><div><span>⌂</span><strong>长期存在于家庭和学校多个场景</strong></div><div><span>○</span><strong>持续拒学或明显躯体不适</strong></div><div><span>♡</span><strong>严重情绪变化或自伤表达</strong></div></div>
            <div className="next-actions"><h2>接下来可以</h2><button onClick={() => setToast("今晚流程已暂停")}>1　先暂停今晚流程</button><button onClick={() => setToast("建议记录事实后联系老师")}>2　联系学校老师</button><button onClick={() => setToast("请选择正规医疗机构")}>3　寻找正规医疗机构</button></div>
            <div className="urgent-note"><strong>存在立即安全风险时</strong><p>请优先联系当地急救或警方，并让可信任的成年人陪在孩子身边。</p></div>
          </div>
        )}

        {toast && <div className="toast" role="status">{toast}</div>}
      </section>
      <aside className="desktop-note"><span className="brand-mark"><span>⌂</span><strong>先开始</strong></span><h2>今晚少催一次，从共同商量开始。</h2><p>这是移动端测试版。请缩窄窗口或直接在手机上使用，体验完整的亲子共商、离屏启动与温和收尾流程。</p><div className="desktop-points"><span>不讲题</span><span>不监控</span><span>不比较</span></div></aside>
    </main>
  );
}
