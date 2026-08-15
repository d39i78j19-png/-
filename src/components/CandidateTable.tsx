"use client";

import { gradeOf } from "@/lib/matchEngine";
import { SCORE_KEYS, SCORE_LABELS } from "@/lib/schema";
import type { ScoredCandidate } from "@/lib/project";

/** 採点済み候補者の一覧。総合点の降順で並べ、母集団の中での位置を見せる。 */
export function CandidateTable({
  rows,
  onRemove,
}: {
  rows: ScoredCandidate[];
  onRemove: (candidateId: string, personaId: string) => void;
}) {
  if (rows.length === 0) return null;

  const sorted = [...rows].sort((a, b) => b.match.final_score - a.match.final_score);

  return (
    <div style={{ overflowX: "auto", marginTop: 16 }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 12.5,
          minWidth: 720,
        }}
      >
        <caption
          style={{
            captionSide: "top",
            textAlign: "left",
            fontSize: 13,
            fontWeight: 600,
            paddingBottom: 8,
          }}
        >
          採点済み候補者 {rows.length} 名（総合点の降順）
        </caption>
        <thead>
          <tr style={{ borderBottom: "2px solid var(--border)" }}>
            <th style={th}>候補者</th>
            <th style={th}>ペルソナ</th>
            <th style={{ ...th, textAlign: "right" }}>総合</th>
            {SCORE_KEYS.map((k) => (
              <th key={k} style={{ ...th, textAlign: "right" }}>
                {SCORE_LABELS[k]}
              </th>
            ))}
            <th style={th} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const grade = gradeOf(row.match.final_score);
            const color =
              grade === "S" || grade === "A"
                ? "var(--good)"
                : grade === "B"
                  ? "var(--accent)"
                  : grade === "C"
                    ? "var(--warn)"
                    : "var(--bad)";
            return (
              <tr
                key={`${row.candidate.id}:${row.persona_id}`}
                style={{ borderBottom: "1px solid var(--border)" }}
              >
                <td style={td}>
                  <div style={{ fontWeight: 600 }}>{row.candidate.name}</div>
                  <div className="mono" style={{ color: "var(--text-muted)" }}>
                    {row.candidate.id}
                  </div>
                </td>
                <td style={{ ...td, color: "var(--text-muted)" }}>
                  {row.persona_label}
                </td>
                <td style={{ ...td, textAlign: "right" }}>
                  <span
                    className="mono"
                    style={{ fontWeight: 700, fontSize: 15, color }}
                  >
                    {row.match.final_score}
                  </span>
                  <span style={{ color, marginLeft: 4, fontWeight: 700 }}>
                    {grade}
                  </span>
                </td>
                {SCORE_KEYS.map((k) => (
                  <td key={k} className="mono" style={{ ...td, textAlign: "right" }}>
                    {row.match.breakdown[k]}
                  </td>
                ))}
                <td style={{ ...td, textAlign: "right" }}>
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: "3px 8px", fontSize: 11 }}
                    onClick={() => onRemove(row.candidate.id, row.persona_id)}
                    aria-label={`${row.candidate.name} の採点結果を削除`}
                  >
                    削除
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "6px 8px",
  fontWeight: 600,
  color: "var(--text-muted)",
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  padding: "8px",
  verticalAlign: "top",
};
