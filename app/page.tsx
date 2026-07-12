import type { Metadata } from "next";
import { StartApp } from "./StartApp";

export const metadata: Metadata = {
  title: "先开始｜家庭晚间习惯助手",
  description: "和孩子一起安排时间、共同启动、随时调整，让晚间少一点催促。",
};

export default function Home() {
  return <StartApp />;
}
