"use client";

import { useState } from "react";
import type { ScoutEmail } from "@/lib/schema";
import { countChars } from "@/lib/text";

export function EmailCard({ email }: { email: ScoutEmail }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(
        `件名: ${email.subject}\n\n${email.body}`,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <article className="card" style={{ padding: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
          flexWrap: "wrap",
        }}
      >
        <span className="tag tag-accent">{email.tone}</span>
        <span className="tag">本文 {countChars(email.body)}文字</span>
        <button
          type="button"
          className="btn"
          style={{ marginLeft: "auto" }}
          onClick={copy}
        >
          {copied ? "コピーしました" : "件名+本文をコピー"}
        </button>
      </div>

      <div style={{ marginBottom: 10 }}>
        <span className="field-label">件名</span>
        <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>
          {email.subject}
        </p>
      </div>

      <div style={{ marginBottom: 10 }}>
        <span className="field-label">本文</span>
        <pre
          style={{
            margin: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            font: "inherit",
            fontSize: 13,
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: 12,
          }}
        >
          {email.body}
        </pre>
      </div>

      <dl style={{ margin: 0, fontSize: 12 }}>
        <dt className="field-label" style={{ marginBottom: 2 }}>
          推奨送信タイミング
        </dt>
        <dd style={{ margin: "0 0 8px" }}>{email.recommended_send_time}</dd>
        <dt className="field-label" style={{ marginBottom: 2 }}>
          このトーンを薦める理由
        </dt>
        <dd style={{ margin: 0, color: "var(--text-muted)" }}>
          {email.one_line_reason}
        </dd>
      </dl>
    </article>
  );
}
