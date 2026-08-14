/**
 * 3つのエンジン（ペルソナ生成 / マッチング / スカウトメール）が共有する型定義。
 * 入出力の JSON 契約は src/lib/jsonSchemas.ts の JSON Schema と 1:1 対応する。
 */

/* ---------- 企業情報 ---------- */

export interface CompanyInfo {
  name: string;
  description: string;
  mission?: string;
  values?: string[];
  must_have_skills?: string[];
  nice_to_have?: string[];
  locations?: string[];
  hiring_type?: string;
  target_grad_years?: string[];
}

/* ---------- ペルソナ ---------- */

/** weights のキー。extracurricular は breakdown 側では extras と呼ばれる（仕様どおり）。 */
export const WEIGHT_KEYS = [
  "skills",
  "culture",
  "major",
  "location",
  "extracurricular",
] as const;
export type WeightKey = (typeof WEIGHT_KEYS)[number];
export type Weights = Record<WeightKey, number>;

export const WEIGHT_LABELS: Record<WeightKey, string> = {
  skills: "スキル",
  culture: "カルチャー",
  major: "専攻",
  location: "勤務地",
  extracurricular: "課外活動",
};

export interface ExampleProfile {
  university_level: string;
  majors: string[];
  skills: string[];
  interests: string[];
  extracurriculars: string[];
  resume_snippet: string;
}

export interface Persona {
  id: string;
  label: string;
  description: string;
  weights: Weights;
  priority_roles: string[];
  example_profiles: ExampleProfile[];
}

export interface PersonaGenerationInput {
  company_info: CompanyInfo;
  persona_count?: number;
}

export interface PersonaGenerationOutput {
  personas: Persona[];
}

/* ---------- 候補者 ---------- */

export interface Candidate {
  id: string;
  name: string;
  university?: string;
  grad_year?: string;
  major?: string;
  skills?: string[];
  resume_text?: string;
  location?: string;
  extracurriculars?: string[];
  remote_ok?: boolean;
}

/* ---------- マッチング ---------- */

/** breakdown のキー。extras は weights 側の extracurricular に対応する。 */
export const SCORE_KEYS = [
  "skills",
  "culture",
  "major",
  "location",
  "extras",
] as const;
export type ScoreKey = (typeof SCORE_KEYS)[number];
export type Breakdown = Record<ScoreKey, number>;

export const SCORE_LABELS: Record<ScoreKey, string> = {
  skills: "スキル",
  culture: "カルチャー",
  major: "専攻",
  location: "勤務地",
  extras: "課外活動",
};

/** breakdown のキー → weights のキー */
export const SCORE_TO_WEIGHT: Record<ScoreKey, WeightKey> = {
  skills: "skills",
  culture: "culture",
  major: "major",
  location: "location",
  extras: "extracurricular",
};

export interface Match {
  candidate_id: string;
  persona_id: string;
  final_score: number;
  breakdown: Breakdown;
  weight_used: Weights;
  notes: string;
}

export interface MatchOutput {
  match: Match;
}

/* ---------- スカウトメール ---------- */

export interface PositionInfo {
  position: string;
  team?: string;
  apply_link?: string;
}

export interface ScoutEmail {
  tone: string;
  subject: string;
  body: string;
  recommended_send_time: string;
  one_line_reason: string;
}

export interface ScoutEmailOutput {
  emails: ScoutEmail[];
}

/* ---------- API レスポンスのメタ情報 ---------- */

/** どのエンジンが結果を出したかを UI に見せるための付帯情報（JSON 契約の外側）。 */
export interface EngineMeta {
  engine: "claude" | "rules";
  model?: string;
  note?: string;
  warnings?: string[];
}
