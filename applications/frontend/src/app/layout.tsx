import type { Metadata } from "next";
import "./globals.css";
import "./design-components.css";

export const metadata: Metadata = {
  title: "NativeTrace — 英語発音チェック",
  description: "日本語話者向け英語発音チェック（General American 基準）",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
