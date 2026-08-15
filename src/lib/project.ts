/**
 * 設計データ一式のファイル形式。
 *
 * 「企業情報 → ペルソナ定義と重み → 採点した候補者の結果 → スカウトメール」
 * までを1ファイルにまとめる。保存したファイルを読み込めば作業を再開できるし、
 * 採点結果だけを他システムに渡すこともできる。
 */

import type { ScoreTrace } from "./matchEngine";
import type {
  Candidate,
  CompanyInfo,
  Match,
  Persona,
  PositionInfo,
  ScoutEmail,
} from "./schema";

export const PROJECT_FORMAT = "shinsotsu-persona-studio";
export const PROJECT_VERSION = 1;

export interface ScoredCandidate {
  candidate: Candidate;
  match: Match;
  trace?: ScoreTrace;
  /** どのペルソナで採点したか */
  persona_id: string;
  persona_label: string;
  scored_at: string;
}

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  saved_at: string;
  company_info: CompanyInfo;
  persona_count: number;
  personas: Persona[];
  selected_persona_id: string | null;
  position_info: PositionInfo;
  scored_candidates: ScoredCandidate[];
  emails: ScoutEmail[];
}

export class ProjectParseError extends Error {}

/** 読み込んだ JSON がこのアプリの設計ファイルか検証する。 */
export function parseProjectFile(raw: unknown): ProjectFile {
  if (typeof raw !== "object" || raw === null) {
    throw new ProjectParseError("ファイルの中身が JSON オブジェクトではありません。");
  }
  const r = raw as Record<string, unknown>;

  if (r.format !== PROJECT_FORMAT) {
    throw new ProjectParseError(
      "このアプリの設計ファイルではないようです（format が一致しません）。",
    );
  }
  const version = Number(r.version);
  if (!Number.isFinite(version)) {
    throw new ProjectParseError("version が読み取れません。");
  }
  if (version > PROJECT_VERSION) {
    throw new ProjectParseError(
      `このファイルは新しい形式（version ${version}）です。アプリを更新してください。`,
    );
  }

  const company = r.company_info as CompanyInfo | undefined;
  if (!company || typeof company.name !== "string") {
    throw new ProjectParseError("company_info が含まれていません。");
  }

  return {
    format: PROJECT_FORMAT,
    version,
    saved_at: typeof r.saved_at === "string" ? r.saved_at : "",
    company_info: company,
    persona_count: Number(r.persona_count) || 3,
    personas: Array.isArray(r.personas) ? (r.personas as Persona[]) : [],
    selected_persona_id:
      typeof r.selected_persona_id === "string" ? r.selected_persona_id : null,
    position_info:
      (r.position_info as PositionInfo | undefined) ?? { position: "" },
    scored_candidates: Array.isArray(r.scored_candidates)
      ? (r.scored_candidates as ScoredCandidate[])
      : [],
    emails: Array.isArray(r.emails) ? (r.emails as ScoutEmail[]) : [],
  };
}

export function buildProjectFile(input: {
  company_info: CompanyInfo;
  persona_count: number;
  personas: Persona[];
  selected_persona_id: string | null;
  position_info: PositionInfo;
  scored_candidates: ScoredCandidate[];
  emails: ScoutEmail[];
  now: string;
}): ProjectFile {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    saved_at: input.now,
    company_info: input.company_info,
    persona_count: input.persona_count,
    personas: input.personas,
    selected_persona_id: input.selected_persona_id,
    position_info: input.position_info,
    scored_candidates: input.scored_candidates,
    emails: input.emails,
  };
}

/** ファイル名に使えない文字を落とす。 */
export function safeFileName(input: string): string {
  const cleaned = input.replace(/[\\/:*?"<>|]/g, "").trim();
  return cleaned.length > 0 ? cleaned : "persona-project";
}
