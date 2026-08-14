"use client";

import { useState, type ReactNode } from "react";

export function Section({
  step,
  title,
  description,
  right,
  children,
}: {
  step: number;
  title: string;
  description: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card" style={{ padding: 20, marginBottom: 18 }}>
      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <span
          aria-hidden
          style={{
            flex: "0 0 auto",
            width: 26,
            height: 26,
            borderRadius: 999,
            background: "var(--accent-soft)",
            color: "var(--accent)",
            display: "grid",
            placeItems: "center",
            fontWeight: 700,
            fontSize: 13,
          }}
        >
          {step}
        </span>
        <div style={{ flex: "1 1 260px", minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 16, letterSpacing: "0.01em" }}>
            {title}
          </h2>
          <p
            style={{
              margin: "2px 0 0",
              fontSize: 12.5,
              color: "var(--text-muted)",
            }}
          >
            {description}
          </p>
        </div>
        {right ? <div style={{ flex: "0 0 auto" }}>{right}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span className="field-label">
        {label}
        {hint ? (
          <span style={{ fontWeight: 400, marginLeft: 6 }}>{hint}</span>
        ) : null}
      </span>
      {children}
    </label>
  );
}

export function Grid({
  min = 220,
  gap = 12,
  children,
}: {
  min?: number;
  gap?: number;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`,
        gap,
      }}
    >
      {children}
    </div>
  );
}

/** JSON を折りたたみで見せる。API 契約をそのまま確認・コピーできるようにする。 */
export function JsonBlock({
  label,
  value,
  defaultOpen = false,
}: {
  label: string;
  value: unknown;
  defaultOpen?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const text = JSON.stringify(value, null, 2);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <details open={defaultOpen} style={{ marginTop: 12 }}>
      <summary
        style={{
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--text-muted)",
          marginBottom: 8,
        }}
      >
        {label}
      </summary>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
        <button type="button" className="btn" onClick={copy}>
          {copied ? "コピーしました" : "JSON をコピー"}
        </button>
      </div>
      <pre className="json">{text}</pre>
    </details>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "bad";
  children: ReactNode;
}) {
  const color =
    tone === "bad" ? "var(--bad)" : tone === "warn" ? "var(--warn)" : "var(--accent)";
  return (
    <div
      role={tone === "bad" ? "alert" : "status"}
      style={{
        borderLeft: `3px solid ${color}`,
        background: "var(--surface-2)",
        borderRadius: "0 6px 6px 0",
        padding: "8px 12px",
        fontSize: 12.5,
        marginBottom: 12,
        color: "var(--text)",
      }}
    >
      {children}
    </div>
  );
}

export function EngineBadge({
  engine,
  model,
}: {
  engine: "claude" | "rules";
  model?: string;
}) {
  return (
    <span className={engine === "claude" ? "tag tag-accent" : "tag"}>
      {engine === "claude" ? `Claude (${model ?? "claude-opus-5"})` : "ルールベース"}
    </span>
  );
}
