/**
 * スキーマで表現できない制約をコードで担保する層。
 *
 * Structured Outputs は「キーと型」は保証するが、
 * 「description が 150〜200 文字」「weights の合計が 1.0」「id が連番」
 * は保証しない（minLength / minimum がサポート外）。ここで機械的に直す。
 */

import type {
  Candidate,
  CompanyInfo,
  ExampleProfile,
  Persona,
  PositionInfo,
  ScoutEmail,
} from "./schema";
import { countChars, truncateChars, truncatePlain } from "./text";
import { normalizeWeights, weightsSum } from "./weights";

export const DESCRIPTION_MIN = 150;
export const DESCRIPTION_MAX = 200;

function asStringArray(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback;
  const out = value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  return out.length > 0 ? out : fallback;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

/**
 * description を 150〜200 文字に収める。
 * 短い場合は company_info 由来の補足文を足し、長い場合は句点で切る。
 */
export function fitDescription(
  description: string,
  filler: string[],
): { value: string; adjusted: "padded" | "truncated" | null } {
  let value = description.trim();
  let adjusted: "padded" | "truncated" | null = null;

  let i = 0;
  while (countChars(value) < DESCRIPTION_MIN && i < filler.length) {
    const next = filler[i++];
    if (!next) continue;
    if (value.includes(next)) continue;
    value = `${value}${value.endsWith("。") ? "" : "。"}${next}`;
    adjusted = "padded";
  }

  if (countChars(value) > DESCRIPTION_MAX) {
    value = truncateChars(value, DESCRIPTION_MAX);
    adjusted = adjusted === "padded" ? "truncated" : "truncated";
  }
  return { value, adjusted };
}

/** description が短すぎたときに足す補足文の候補を company_info から作る。 */
export function buildFiller(company: CompanyInfo): string[] {
  const filler: string[] = [];
  if (company.mission) {
    filler.push(`「${company.mission}」というミッションへの共感が動機になりやすい`);
  }
  if (company.values?.length) {
    filler.push(`${company.values.slice(0, 3).join("・")}といった価値観と相性が良い`);
  }
  if (company.must_have_skills?.length) {
    filler.push(
      `選考では${company.must_have_skills.slice(0, 2).join("と")}を軸に見極めたい`,
    );
  }
  if (company.locations?.length) {
    filler.push(`勤務地は${company.locations.join("・")}を想定している`);
  }
  if (company.target_grad_years?.length) {
    filler.push(
      `${company.target_grad_years.join("・")}年卒を主なターゲットとする`,
    );
  }
  filler.push(
    `${company.name}の事業フェーズを面白がれるかどうかが見極めのポイントになる`,
  );
  filler.push(
    "早期から裁量を持って動きたい志向が強く、スカウトでは具体的な任せ方を示すと反応が良い",
  );
  filler.push(
    "情報収集は就職サイトとSNSの併用が中心で、選考は複数社を並行して進める傾向がある",
  );
  return filler;
}

function sanitizeExampleProfile(raw: unknown): ExampleProfile {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    university_level: asString(r.university_level, "国公立・私立を問わない"),
    majors: asStringArray(r.majors, ["学部・専攻不問"]),
    skills: asStringArray(r.skills, []),
    interests: asStringArray(r.interests, []),
    extracurriculars: asStringArray(r.extracurriculars, []),
    resume_snippet: asString(r.resume_snippet, ""),
  };
}

export interface SanitizeResult {
  personas: Persona[];
  warnings: string[];
}

/**
 * Claude / ルールベースいずれの出力も同じ検証を通す。
 * 返り値は必ず JSON 契約を満たす。
 */
export function sanitizePersonas(
  raw: unknown,
  desiredCount: number,
  company: CompanyInfo,
): SanitizeResult {
  const warnings: string[] = [];
  const filler = buildFiller(company);
  const list = Array.isArray(raw) ? raw : [];

  if (list.length !== desiredCount) {
    warnings.push(
      `ペルソナ数が ${list.length} 件だったため ${desiredCount} 件に揃えました。`,
    );
  }

  const personas: Persona[] = list.slice(0, desiredCount).map((item, index) => {
    const r = (item ?? {}) as Record<string, unknown>;
    const expectedId = `persona-${index + 1}`;
    if (asString(r.id) !== expectedId) {
      warnings.push(`id を ${expectedId} に振り直しました。`);
    }

    const rawWeights = (r.weights ?? {}) as Record<string, number>;
    const sum = weightsSum(rawWeights);
    if (Math.abs(sum - 1) > 0.005) {
      warnings.push(
        `${expectedId}: weights の合計が ${sum} だったため 1.0 に正規化しました。`,
      );
    }

    const profiles = Array.isArray(r.example_profiles)
      ? r.example_profiles.map(sanitizeExampleProfile)
      : [];

    const label = truncatePlain(asString(r.label, `ペルソナ${index + 1}`), 24);
    const { value: description, adjusted } = fitDescription(
      asString(r.description, ""),
      filler,
    );
    if (adjusted === "padded") {
      warnings.push(
        `${expectedId}: description が ${DESCRIPTION_MIN} 文字未満だったため補足しました。`,
      );
    } else if (adjusted === "truncated") {
      warnings.push(
        `${expectedId}: description が ${DESCRIPTION_MAX} 文字を超えたため短縮しました。`,
      );
    }

    return {
      id: expectedId,
      label,
      description,
      weights: normalizeWeights(rawWeights),
      priority_roles: asStringArray(r.priority_roles, ["総合職"]),
      example_profiles:
        profiles.length > 0 ? profiles : [sanitizeExampleProfile({})],
    };
  });

  return { personas, warnings };
}

/* ---------- リクエスト検証 ---------- */

export class ValidationError extends Error {
  readonly status = 400;
}

export function requireCompanyInfo(value: unknown): CompanyInfo {
  const v = (value ?? {}) as Record<string, unknown>;
  const name = asString(v.name);
  const description = asString(v.description);
  if (!name) throw new ValidationError("company_info.name は必須です。");
  if (!description) {
    throw new ValidationError("company_info.description は必須です。");
  }
  return {
    name,
    description,
    mission: asString(v.mission) || undefined,
    values: asStringArray(v.values),
    must_have_skills: asStringArray(v.must_have_skills),
    nice_to_have: asStringArray(v.nice_to_have),
    locations: asStringArray(v.locations),
    hiring_type: asString(v.hiring_type) || undefined,
    target_grad_years: asStringArray(v.target_grad_years),
  };
}

export function requirePersonaCount(value: unknown): number {
  if (value === undefined || value === null) return 3;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new ValidationError("persona_count は 1 以上の整数で指定してください。");
  }
  return Math.min(n, 8);
}

/** 掲載文の下限・上限。上限は 1 回のリクエストのトークン量を抑えるための足切り。 */
export const SOURCE_TEXT_MIN = 40;
export const SOURCE_TEXT_MAX = 30000;

export interface SourceText {
  text: string;
  truncated: boolean;
}

/** 貼り付けられた掲載文を検証する。長すぎる場合は切って続行する。 */
export function requireSourceText(value: unknown): SourceText {
  const text = asString(value);
  if (!text) {
    throw new ValidationError("source_text は必須です。掲載文を貼り付けてください。");
  }
  if (countChars(text) < SOURCE_TEXT_MIN) {
    throw new ValidationError(
      `掲載文が短すぎます（${SOURCE_TEXT_MIN} 文字以上を貼り付けてください）。`,
    );
  }
  if (text.length > SOURCE_TEXT_MAX) {
    return { text: text.slice(0, SOURCE_TEXT_MAX), truncated: true };
  }
  return { text, truncated: false };
}

/**
 * 読み取り結果を company_info の形に整える。
 * Structured Outputs は「空文字を返さない」ことまでは保証しないため、
 * 長さの上限・配列の件数はここで機械的に揃える。
 */
export function sanitizeExtractedCompany(raw: unknown): CompanyInfo {
  const r = (raw ?? {}) as Record<string, unknown>;
  const items = (value: unknown, cap: number, maxLen: number): string[] =>
    asStringArray(value)
      .map((v) => truncatePlain(v, maxLen))
      .slice(0, cap);

  return {
    name: truncatePlain(asString(r.name), 60),
    description: truncateChars(asString(r.description), 400),
    mission: truncatePlain(asString(r.mission), 60) || undefined,
    values: items(r.values, 8, 20),
    must_have_skills: items(r.must_have_skills, 8, 24),
    nice_to_have: items(r.nice_to_have, 8, 24),
    locations: items(r.locations, 6, 30),
    hiring_type: truncatePlain(asString(r.hiring_type), 30) || undefined,
    target_grad_years: items(r.target_grad_years, 4, 8),
  };
}

export function requirePersona(value: unknown): Persona {
  const v = (value ?? {}) as Record<string, unknown>;
  if (!asString(v.id) || !asString(v.label)) {
    throw new ValidationError("persona は id と label を含む必要があります。");
  }
  const profiles = Array.isArray(v.example_profiles)
    ? v.example_profiles.map(sanitizeExampleProfile)
    : [];
  return {
    id: asString(v.id),
    label: asString(v.label),
    description: asString(v.description),
    weights: normalizeWeights((v.weights ?? {}) as Record<string, number>),
    priority_roles: asStringArray(v.priority_roles),
    example_profiles: profiles,
  };
}

export function requireCandidate(value: unknown): Candidate {
  const v = (value ?? {}) as Record<string, unknown>;
  const id = asString(v.id);
  const name = asString(v.name);
  if (!id) throw new ValidationError("candidate.id は必須です。");
  if (!name) throw new ValidationError("candidate.name は必須です。");
  return {
    id,
    name,
    university: asString(v.university) || undefined,
    grad_year: asString(v.grad_year) || undefined,
    major: asString(v.major) || undefined,
    skills: asStringArray(v.skills),
    resume_text: asString(v.resume_text) || undefined,
    location: asString(v.location) || undefined,
    extracurriculars: asStringArray(v.extracurriculars),
    remote_ok: typeof v.remote_ok === "boolean" ? v.remote_ok : undefined,
  };
}

export function requirePositionInfo(value: unknown): PositionInfo {
  const v = (value ?? {}) as Record<string, unknown>;
  const position = asString(v.position);
  if (!position) {
    throw new ValidationError("position_info.position は必須です。");
  }
  return {
    position,
    team: asString(v.team) || undefined,
    apply_link: asString(v.apply_link) || undefined,
  };
}

/** メール出力を JSON 契約に合わせて整える。 */
export function sanitizeEmails(raw: unknown): ScoutEmail[] {
  const list = Array.isArray(raw) ? raw : [];
  return list.map((item) => {
    const r = (item ?? {}) as Record<string, unknown>;
    return {
      tone: asString(r.tone, "標準"),
      subject: truncatePlain(asString(r.subject, "カジュアル面談のご案内"), 40),
      body: asString(r.body, ""),
      recommended_send_time: asString(
        r.recommended_send_time,
        "火〜木の19〜21時",
      ),
      one_line_reason: truncateChars(asString(r.one_line_reason, ""), 120),
    };
  });
}
