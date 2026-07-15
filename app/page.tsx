import type { Metadata } from "next";
import { StartApp } from "./StartApp";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "先开始｜家庭晚间习惯助手",
  description: "亲子共同安排任务、休息和奖励，双人确认后按时启动，由阶段提醒帮助全家一起完成今晚计划。",
};

export default function Home() {
  return <StartApp />;
}
