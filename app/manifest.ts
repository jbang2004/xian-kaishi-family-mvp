import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "先开始｜家庭晚间习惯助手",
    short_name: "先开始",
    description: "共同安排今晚、温和开始、完成与收尾，不讲题、不监控、不比较。",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#fff8ec",
    theme_color: "#fff8ec",
    lang: "zh-CN",
    categories: ["education", "lifestyle"],
    icons: [
      { src: "/assets/icons/home-heart.png", sizes: "320x320", type: "image/png", purpose: "any" },
    ],
  };
}
