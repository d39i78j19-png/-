/**
 * ブラウザ完結デモのエントリ。
 * 本番と同じ src/app/page.tsx をそのままマウントし、API 呼び出しだけを
 * apiShim（ルールベース実装）に差し替える。UI コードは一切分岐させない。
 */

import { createRoot } from "react-dom/client";
import Page from "@/app/page";
import { installApiShim } from "./apiShim";
import { installDownloadShim } from "./downloadShim";

// SettingsPanel がマウント直後に /api/settings を叩くので、React より先に差し替える
installApiShim();
installDownloadShim();

function DemoBanner() {
  return (
    <div
      style={{
        maxWidth: 1080,
        margin: "0 auto",
        padding: "16px 20px 0",
      }}
    >
      <div
        style={{
          borderLeft: "3px solid var(--accent)",
          background: "var(--surface-2)",
          borderRadius: "0 6px 6px 0",
          padding: "10px 14px",
          fontSize: 12.5,
          lineHeight: 1.7,
        }}
      >
        <strong>これはブラウザだけで動くデモ版です。</strong>
        入力内容はこのページの外に出ません（サーバー送信なし・お使いのブラウザ内に自動保存）。
        生成はすべて同梱のルールベースエンジンで行います。デスクトップアプリ版で Claude API キーを
        登録すると、ペルソナ文面・スカウトメール・課外活動の判定が Claude に切り替わり、
        文面の自然さと個別性が上がります（マッチ採点は説明可能性のため常に同じ計算式です）。
      </div>
    </div>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("#root が見つかりません。");

createRoot(container).render(
  <>
    <DemoBanner />
    <Page />
  </>,
);
