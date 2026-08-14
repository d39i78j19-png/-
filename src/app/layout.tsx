import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "新卒採用ペルソナ設計スタジオ",
  description:
    "企業情報から新卒ペルソナを生成し、候補者とのマッチ度を数値化して、ペルソナ別スカウトメールまで作成するツール",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
