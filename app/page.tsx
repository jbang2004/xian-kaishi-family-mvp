import type { Metadata } from "next";
import { StartApp } from "./StartApp";

export const metadata: Metadata = {
  title: "先开始｜家庭晚间习惯助手",
  description: "和孩子一起商量任务、休息与第一小步，让晚间少一点催促。",
};

export default function Home() {
  return <StartApp />;
}
