"use client";

import { WEIGHT_KEYS, WEIGHT_LABELS, type Persona } from "@/lib/schema";
import { countChars } from "@/lib/text";
import { DESCRIPTION_MAX, DESCRIPTION_MIN } from "@/lib/validate";

export function PersonaCard({
  persona,
  selected,
  onSelect,
}: {
  persona: Persona;
  selected: boolean;
  onSelect: () => void;
}) {
  const length = countChars(persona.description);
  const inRange = length >= DESCRIPTION_MIN && length <= DESCRIPTION_MAX;

  return (
    <article
      className="card"
      style={{
        padding: 16,
        borderColor: selected ? "var(--accent)" : "var(--border)",
        borderWidth: selected ? 2 : 1,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
          flexWrap: "wrap",
        }}
      >
        <span className="mono tag">{persona.id}</span>
        <h3 style={{ margin: 0, fontSize: 15, flex: "1 1 auto" }}>
          {persona.label}
        </h3>
        <button
          type="button"
          className={selected ? "btn btn-primary" : "btn"}
          onClick={onSelect}
          aria-pressed={selected}
        >
          {selected ? "選択中" : "このペルソナで採点"}
        </button>
      </div>

      <p style={{ margin: "0 0 6px", fontSize: 13 }}>{persona.description}</p>
      <p
        style={{
          margin: "0 0 12px",
          fontSize: 11,
          color: inRange ? "var(--text-muted)" : "var(--warn)",
        }}
      >
        description: {length}文字（規定 {DESCRIPTION_MIN}〜{DESCRIPTION_MAX}）
        {inRange ? "" : " ← 規定外のため自動調整済み"}
      </p>

      <div style={{ marginBottom: 12 }}>
        {WEIGHT_KEYS.map((key) => (
          <div
            key={key}
            style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}
          >
            <span
              style={{ fontSize: 11.5, color: "var(--text-muted)", minWidth: 72 }}
            >
              {WEIGHT_LABELS[key]}
            </span>
            <div
              style={{
                flex: 1,
                height: 6,
                background: "var(--surface-2)",
                borderRadius: 3,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${persona.weights[key] * 100}%`,
                  height: "100%",
                  background: "var(--accent)",
                }}
              />
            </div>
            <span className="mono" style={{ fontSize: 11, minWidth: 34, textAlign: "right" }}>
              {persona.weights[key].toFixed(2)}
            </span>
          </div>
        ))}
      </div>

      {persona.priority_roles.length > 0 ? (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>
          {persona.priority_roles.map((role) => (
            <span key={role} className="tag">
              {role}
            </span>
          ))}
        </div>
      ) : null}

      <details>
        <summary
          style={{
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
            color: "var(--text-muted)",
          }}
        >
          想定プロフィール {persona.example_profiles.length} 件
        </summary>
        <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
          {persona.example_profiles.map((p, i) => (
            <li key={i} style={{ marginBottom: 10, fontSize: 12.5 }}>
              <div style={{ color: "var(--text-muted)" }}>
                {p.university_level} ／ {p.majors.join("・")}
              </div>
              <div style={{ marginTop: 2 }}>
                <strong>skills:</strong> {p.skills.join(", ") || "—"}
              </div>
              {p.extracurriculars.length > 0 ? (
                <div>
                  <strong>課外:</strong> {p.extracurriculars.join(", ")}
                </div>
              ) : null}
              {p.resume_snippet ? (
                <div style={{ marginTop: 2, color: "var(--text-muted)" }}>
                  「{p.resume_snippet}」
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}
