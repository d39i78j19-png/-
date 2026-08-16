/**
 * ペルソナのセグメント定義と推定。
 *
 * 顔写真プールを「志向 × 志望企業規模」で分類し、ペルソナ側も同じ軸で判定して
 * 突き合わせる。用意された写真がこの6分類で作られているため、割り当ての主軸に
 * するのがいちばん素直に効く。
 *
 *   志向         成長志向 / 安定志向
 *   志望企業規模 大手 / ベンチャー / 中小
 *
 * 「成長志向で大手に行きたい学生の顔」と「安定志向で中小に行きたい学生の顔」は
 * 実際に雰囲気が違う。ここを合わせると、同じ年齢・同じ性別でも「その人らしさ」が出る。
 */

"use strict";

const ORIENTATIONS = [
  { key: "growth", label: "成長志向" },
  { key: "stability", label: "安定志向" },
];

const COMPANY_SIZES = [
  { key: "large", label: "大手" },
  { key: "venture", label: "ベンチャー" },
  { key: "small", label: "中小" },
];

/** 6分類の全組み合わせ。UI のプルダウンと取り込み時の割り当てに使う。 */
const SEGMENTS = ORIENTATIONS.flatMap((o) =>
  COMPANY_SIZES.map((s) => ({
    key: `${o.key}:${s.key}`,
    orientation: o.key,
    companySize: s.key,
    label: `${o.label}ー${s.label}に行きたい顔`,
  })),
);

const orientationLabel = (k) => (ORIENTATIONS.find((o) => o.key === k) || {}).label || "";
const companySizeLabel = (k) => (COMPANY_SIZES.find((s) => s.key === k) || {}).label || "";

/* ===================== 志向の推定 =====================
   画面の「志向性・価値観」チェックが最優先。そこに無ければ本文から拾う。 */

const GROWTH_WORDS = [
  "成長志向", "挑戦", "ゼロイチ", "起業", "グローバル", "海外", "裁量",
  "スピード", "リーダー", "上を目指", "早く成長", "変化",
];
const STABILITY_WORDS = [
  "安定志向", "安定", "WLB", "ワークライフ", "腰を据え", "長く働",
  "地元", "転勤がない", "福利厚生", "堅実", "落ち着い",
];

/**
 * ペルソナの志向を推定する。
 * @returns {"growth"|"stability"} 判別できない場合は growth に寄せない（既定は stability）
 */
function inferOrientation(persona = {}, conditions = {}) {
  // 画面のチェックボックス（stance）が最も確度が高い
  const stance = [].concat(conditions.stance || []).join(" ");
  if (/成長志向|ゼロイチ|挑戦|グローバル/.test(stance)) return "growth";
  if (/安定志向|WLB|地元/.test(stance)) return "stability";

  const blob = [
    persona.personality,
    persona.summary,
    ...(persona.values || []),
    ...(persona.orientation || []),
    ...(persona.job_axis || []),
  ]
    .filter(Boolean)
    .join(" ");

  const g = GROWTH_WORDS.filter((w) => blob.includes(w)).length;
  const s = STABILITY_WORDS.filter((w) => blob.includes(w)).length;
  if (g > s) return "growth";
  if (s > g) return "stability";
  // 新卒市場の実勢では「安定した会社」が選社理由の上位。迷ったらこちらに寄せる。
  return "stability";
}

/* ===================== 志望企業規模の推定 =====================
   このツールのペルソナは「自社に来てほしい学生」なので、
   自社の規模がそのまま「その学生が志望する規模」になる。 */

/** 画面の従業員数バンド（SIZE）→ 大手 / ベンチャー / 中小 */
const SIZE_BAND_MAP = [
  [/〜?\s*50名/, "venture"],
  [/51\s*〜\s*100名/, "venture"],
  [/101\s*〜\s*300名/, "small"],
  [/301\s*〜\s*1,?000名/, "small"],
  [/1,?001名\s*〜/, "large"],
];

/**
 * @param {string} sizeLabel 画面の従業員数バンド（例 "101〜300名"）
 * @returns {"large"|"venture"|"small"}
 */
function inferCompanySize(sizeLabel = "") {
  const s = String(sizeLabel);
  // 明示的な言葉があればそちらを優先する
  if (/大手|大企業|上場/.test(s)) return "large";
  if (/ベンチャー|スタートアップ/.test(s)) return "venture";
  if (/中小|中堅/.test(s)) return "small";

  for (const [re, key] of SIZE_BAND_MAP) if (re.test(s)) return key;
  return "small"; // 判別できない場合、母数が最も多い中小に寄せる
}

/**
 * ペルソナ1人分のセグメントを決める。
 * @param {object} persona
 * @param {object} context  { conditions, company:{size} }
 */
function segmentOf(persona = {}, context = {}) {
  const orientation = inferOrientation(persona, context.conditions || {});
  const companySize = inferCompanySize((context.company || {}).size || context.companySize || "");
  return {
    orientation,
    companySize,
    key: `${orientation}:${companySize}`,
    label: `${orientationLabel(orientation)}ー${companySizeLabel(companySize)}`,
  };
}

module.exports = {
  ORIENTATIONS,
  COMPANY_SIZES,
  SEGMENTS,
  orientationLabel,
  companySizeLabel,
  inferOrientation,
  inferCompanySize,
  segmentOf,
};
