import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { versionedAsset } from "./asset-version";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#fff8ec",
};

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = "先开始｜家庭晚间习惯助手";
  const description = "共同安排时间、选择事项能量，每晚完成和家庭期待兑换都记录在日历里。";
  const appIcon = versionedAsset("/assets/icons/home-heart.png");
  return {
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
      url: origin,
      images: [{ url: `${origin}/og.png`, width: 1672, height: 941, alt: "先开始家庭晚间习惯助手" }],
    },
    twitter: { card: "summary_large_image", title, description, images: [`${origin}/og.png`] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
