"use client";

import {
  SCORE_KEYS,
  SCORE_LABELS,
  SCORE_TO_WEIGHT,
  type Breakdown,
  type Weights,
} from "@/lib/schema";
import { gradeOf } from "@/lib/matchEngine";
import type { ScoreTrace } from "@/lib/matchEngine";

/**
 * 5軸の内訳を横棒で見せる。
 * 棒の長さ = 軸スコア（0-100）、棒の下の細い帯 = 総合点への寄与（重み×スコア）。
 * レーダーではなく棒にしているのは、5軸の大小と「どの軸が総合を動かしたか」を
 * 同時に正確に読ませたいため。面積で表すレーダーは重み付き比較に向かない。
 */
export function ScoreBars({
  breakdown,
  weights,
  trace,
}: {
  breakdown: Breakdown;
  weights: Weights;
  trace?: ScoreTrace;
}) {
  const contributions = SCORE_KEYS.map((key) => ({
    key,
    score: breakdown[key],
    weight: weights[SCORE_TO_WEIGHT[key]],
    points: weights[SCORE_TO_WEIGHT[key]] * breakdown[key],
  }));
  const maxPoints = Math.max(...contributions.map((c) => c.points), 1);

  return (
    <div>
      {contributions.map((c) => (
        <div key={c.key} style={{ marginBottom: 14 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              marginBottom: 4,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, minWidth: 82 }}>
              {SCORE_LABELS[c.key]}
            </span>
            <span className="tag">重み {c.weight.toFixed(2)}</span>
            <span
              className="mono"
              style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700 }}
            >
              {c.score}
            </span>
          </div>

          <div
            role="img"
            aria-label={`${SCORE_LABELS[c.key]} ${c.score}点、重み${c.weight.toFixed(2)}`}
            style={{
              height: 8,
              borderRadius: 4,
              background: "var(--surface-2)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${c.score}%`,
                height: "100%",
                background: "var(--accent)",
                borderRadius: 4,
              }}
            />
          </div>

          {/* 総合点への寄与（相対） */}
          <div
            style={{
              height: 3,
              marginTop: 3,
              borderRadius: 2,
              background: "transparent",
            }}
          >
            <div
              style={{
                width: `${(c.points / maxPoints) * 100}%`,
                height: "100%",
                background: "var(--text-muted)",
                opacity: 0.55,
                borderRadius: 2,
              }}
            />
          </div>

          {trace ? (
            <p
              style={{
                margin: "5px 0 0",
                fontSize: 11.5,
                color: "var(--text-muted)",
              }}
            >
              {describeTrace(c.key, trace)}
            </p>
          ) : null}
        </div>
      ))}
      <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "10px 0 0" }}>
        濃い棒＝軸スコア（0-100）／その下の細い帯＝総合点への寄与（重み×スコア、最大値を基準にした相対長）
      </p>
    </div>
  );
}

function describeTrace(
  key: (typeof SCORE_KEYS)[number],
  trace: ScoreTrace,
): string {
  switch (key) {
    case "skills": {
      const t = trace.skills;
      if (t.personaSkills.length === 0) return "ペルソナ側の想定スキルが空のため 0";
      return `Jaccard ${t.jaccard} ／ 一致: ${
        t.matched.length > 0 ? t.matched.join("、") : "なし"
      }`;
    }
    case "culture": {
      const t = trace.culture;
      if (t.keywords.length === 0) return "照合キーワードを抽出できず 0";
      return `${t.matched.length}/${t.keywords.length} 件一致${
        t.matched.length > 0 ? `（${t.matched.slice(0, 5).join("、")}）` : ""
      }`;
    }
    case "major":
      return trace.major.rule;
    case "location":
      return `${trace.location.rule} ／ 候補者: ${trace.location.candidate}`;
    case "extras":
      return trace.extras.rule;
    default:
      return "";
  }
}

export function FinalScore({ score }: { score: number }) {
  const grade = gradeOf(score);
  const color =
    grade === "S" || grade === "A"
      ? "var(--good)"
      : grade === "B"
        ? "var(--accent)"
        : grade === "C"
          ? "var(--warn)"
          : "var(--bad)";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 12,
        padding: "12px 16px",
        borderRadius: 8,
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
      }}
    >
      <div>
        <div
          style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}
        >
          final_score
        </div>
        <div
          className="mono"
          style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.1, color }}
        >
          {score}
        </div>
      </div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 700,
          color,
          border: `2px solid ${color}`,
          borderRadius: 6,
          padding: "0 10px",
        }}
      >
        {grade}
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 11.5,
          color: "var(--text-muted)",
          maxWidth: 260,
        }}
      >
        S:85+ / A:70+ / B:55+ / C:40+ / D:40未満（UI 表示用の区分で、JSON 契約には含みません）
      </p>
    </div>
  );
}
