"use client";

import { useCallback, useEffect, useState } from "react";
import { Notice } from "./ui";

interface SettingsState {
  configured: boolean;
  source: "env" | "stored" | "none";
  masked: string | null;
  editable: boolean;
}

/**
 * API キーの登録画面。
 * デスクトップアプリではユーザーデータ領域に保存し、ブラウザ運用では
 * 環境変数のみ（保存不可）になるので、その違いをそのまま表示する。
 */
export function SettingsPanel() {
  const [state, setState] = useState<SettingsState | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/settings");
      setState((await response.json()) as SettingsState);
    } catch {
      setError("設定の読み込みに失敗しました。");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // キー未設定なら最初から開いておく（何をすればいいか分かるように）
  useEffect(() => {
    if (state && !state.configured) setOpen(true);
  }, [state]);

  async function save() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ api_key: input }),
      });
      const json = await response.json();
      if (!response.ok) {
        setError(json.error?.message ?? "保存に失敗しました。");
      } else {
        setState(json as SettingsState);
        setInput("");
        setMessage("APIキーを保存しました。以降は Claude で生成されます。");
      }
    } catch {
      setError("保存に失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/settings", { method: "DELETE" });
      setState((await response.json()) as SettingsState);
      setMessage("APIキーを削除しました。以降はルールベースで動作します。");
    } catch {
      setError("削除に失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  const statusText = !state
    ? "確認中…"
    : state.source === "env"
      ? `環境変数から読み込み済み（${state.masked}）`
      : state.source === "stored"
        ? `このPCに保存済み（${state.masked}）`
        : "未設定 — ルールベースで動作中";

  return (
    <div
      className="card"
      style={{ padding: "12px 16px", marginBottom: 18 }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: state?.configured ? "var(--good)" : "var(--warn)",
          }}
        />
        <strong style={{ fontSize: 13 }}>Claude API キー</strong>
        <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
          {statusText}
        </span>
        <button
          type="button"
          className="btn"
          style={{ marginLeft: "auto" }}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? "閉じる" : "設定"}
        </button>
      </div>

      {open ? (
        <div style={{ marginTop: 12 }}>
          {!state?.configured ? (
            <Notice>
              キー未設定でも全機能が使えます（同梱のルールベースエンジンで生成）。
              キーを登録すると、ペルソナ生成・スカウトメール・課外活動の文脈判断が
              Claude に切り替わり、文面の自然さと個別性が上がります。
            </Notice>
          ) : null}

          {state?.source === "env" ? (
            <Notice tone="warn">
              環境変数 ANTHROPIC_API_KEY が設定されているため、そちらが優先されます。
              画面からの変更はできません。
            </Notice>
          ) : null}

          {state?.editable ? (
            <>
              <label style={{ display: "block", marginBottom: 8 }}>
                <span className="field-label">APIキー</span>
                <input
                  type="password"
                  value={input}
                  placeholder="sk-ant-..."
                  onChange={(e) => setInput(e.target.value)}
                  autoComplete="off"
                  style={{
                    width: "100%",
                    background: "var(--surface)",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: "7px 10px",
                    font: "inherit",
                    fontSize: 13,
                  }}
                />
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={save}
                  disabled={busy || input.trim().length === 0}
                >
                  {busy ? "保存中…" : "保存"}
                </button>
                {state.source === "stored" ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={clear}
                    disabled={busy}
                  >
                    保存済みのキーを削除
                  </button>
                ) : null}
              </div>
              <p
                style={{
                  fontSize: 11.5,
                  color: "var(--text-muted)",
                  margin: "10px 0 0",
                }}
              >
                キーはこのPCのユーザーデータ領域に、本人のみ読み書きできる権限（0600）で
                保存されます。暗号化はされないため、共用PCで使う場合は環境変数での運用を
                推奨します。使い終わったら上のボタンで削除できます。
              </p>
            </>
          ) : state?.source !== "env" ? (
            <Notice tone="warn">
              ブラウザで開いているため、画面からのキー保存はできません。
              サーバー側で環境変数 ANTHROPIC_API_KEY を設定してください。
            </Notice>
          ) : null}

          {message ? <Notice>{message}</Notice> : null}
          {error ? <Notice tone="bad">{error}</Notice> : null}
        </div>
      ) : null}
    </div>
  );
}
