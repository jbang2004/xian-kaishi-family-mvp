import type { Metadata, Viewport } from "next";
import { versionedAsset } from "./asset-version";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#fff8ec",
};

const title = "先开始｜家庭晚间习惯助手";
const description = "亲子共同安排任务、休息和奖励，双人确认后按时启动，由阶段提醒帮助全家一起完成今晚计划。";
const appIcon = versionedAsset("/assets/icons/home-heart.png");

// Keep the app shell static and edge-cacheable. Family data is loaded by the
// client from the separate no-store API and never enters this public document.
export const metadata: Metadata = {
  metadataBase: new URL("https://xian-kaishi-family-mvp.jbang20042004.workers.dev"),
  title,
  description,
  applicationName: "先开始",
  manifest: "/manifest.webmanifest",
  formatDetection: { telephone: false },
  appleWebApp: { capable: true, title: "先开始", statusBarStyle: "default" },
  icons: { icon: appIcon, shortcut: appIcon, apple: appIcon },
  openGraph: {
    title,
    description,
    type: "website",
    url: "/",
    images: [{ url: "/og.jpg", width: 1672, height: 941, alt: "先开始家庭晚间习惯助手" }],
  },
  twitter: { card: "summary_large_image", title, description, images: ["/og.jpg"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
