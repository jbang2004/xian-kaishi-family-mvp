import type { Metadata } from "next";
import { StartApp } from "./StartApp";

export const metadata: Metadata = {
  title: "先开始｜家庭晚间习惯助手",
  description: "亲子一起安排时间、为事项选择能量，完成与家庭期待都记录在日历里。",
};

export default function Home() {
  return <StartApp />;
}
