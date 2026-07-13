import type { Metadata } from "next";
import { StartApp } from "./StartApp";

export const metadata: Metadata = {
  title: "先开始｜家庭晚间习惯助手",
  description: "亲子共同安排时间、选择家庭能量，把每晚合作和共同期待留在家庭日历里。",
};

export default function Home() {
  return <StartApp />;
}
