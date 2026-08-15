"use client";

import { useRef, useState } from "react";
import {
  parseProjectFile,
  safeFileName,
  type ProjectFile,
} from "@/lib/project";

/**
 * 設計データ一式（企業情報・ペルソナ・採点結果・メール）の保存と読み込み。
 * 保存はブラウザのダウンロード機能をそのまま使うので、Electron でも
 * OS の「ダウンロード」フォルダに .json が落ちる。
 */
export function ProjectBar({
  buildProject,
  onImport,
  personaCount,
  scoredCount,
  savedAt,
}: {
  buildProject: () => ProjectFile;
  onImport: (project: ProjectFile) => void;
  personaCount: number;
  scoredCount: number;
  savedAt: string | null;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function download() {
    setError(null);
    try {
      const project = buildProject();
      const blob = new Blob([JSON.stringify(project, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const stamp = project.saved_at.slice(0, 10);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${safeFileName(project.company_info.name)}_ペルソナ設計_${stamp}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      // Blob URL は解放しないとメモリに残り続ける
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("設計データを書き出しました。");
      setTimeout(() => setMessage(null), 2600);
    } catch (e) {
      setError(e instanceof Error ? e.message : "書き出しに失敗しました。");
    }
  }

  async function handleFile(file: File) {
    setError(null);
    setMessage(null);
    try {
      const project = parseProjectFile(JSON.parse(await file.text()));
      onImport(project);
      setMessage(
        `読み込みました（ペルソナ ${project.personas.length} 件 / 採点済み ${project.scored_candidates.length} 名）。`,
      );
      setTimeout(() => setMessage(null), 3200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました。");
    }
  }

  return (
    <div
      className="card"
      style={{
        padding: "10px 16px",
        marginBottom: 18,
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
      }}
    >
      <strong style={{ fontSize: 13 }}>設計データ</strong>
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
        ペルソナ {personaCount} 件 ／ 採点済み {scoredCount} 名
        {savedAt ? ` ／ 自動保存 ${savedAt}` : ""}
      </span>

      <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
          JSONを読み込む
        </button>
        <button type="button" className="btn btn-primary" onClick={download}>
          JSONで書き出す
        </button>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          // 同じファイルを続けて選べるようにリセットする
          e.target.value = "";
        }}
      />

      {message ? (
        <span style={{ fontSize: 12, color: "var(--good)", width: "100%" }}>
          {message}
        </span>
      ) : null}
      {error ? (
        <span style={{ fontSize: 12, color: "var(--bad)", width: "100%" }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
