/**
 * ブラウザ完結デモ用の fetch シム。
 *
 * 通常版は Next.js の API ルート（/api/*）がリクエストを受けるが、デモは
 * 単一 HTML として配布するためサーバーが存在しない。そこで fetch を差し替え、
 * 各ルートと同じ入力検証・同じルールベースエンジンをブラウザ内で直接呼ぶ。
 *
 * Claude を使う分岐はサーバー側にしか無い（APIキーをブラウザに置かないため）ので、
 * デモは常にルールベースで動く。UI から見た JSON の形は本番と同じ。
 */

import { generateEmailsByRules } from "@/lib/emailEngine";
import {
  extractCompanyByRules,
  listMissing,
} from "@/lib/extractEngine";
import { scoreCandidate } from "@/lib/matchEngine";
import { generatePersonasByRules } from "@/lib/personaEngine";
import type { EngineMeta } from "@/lib/schema";
import {
  requireCandidate,
  requireCompanyInfo,
  requirePersona,
  requirePersonaCount,
  requirePositionInfo,
  requireSourceText,
  sanitizeEmails,
  sanitizePersonas,
  SOURCE_TEXT_MAX,
  ValidationError,
} from "@/lib/validate";

const DEMO_NOTE = "ブラウザ完結のデモのため、すべてルールベースで生成しています。";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function failure(error: unknown): Response {
  if (error instanceof ValidationError) {
    return json({ error: { type: "validation_error", message: error.message } }, 400);
  }
  const message =
    error instanceof Error ? error.message : "予期しないエラーが発生しました。";
  return json({ error: { type: "server_error", message } }, 500);
}

/* ---------- 各ルートの代替実装 ---------- */

function handleExtract(body: Record<string, unknown>): Response {
  const source = requireSourceText(body.source_text);
  const meta: EngineMeta = { engine: "rules", warnings: [], note: DEMO_NOTE };
  if (source.truncated) {
    meta.warnings?.push(
      `掲載文が長いため先頭 ${SOURCE_TEXT_MAX.toLocaleString("ja-JP")} 文字だけを読み取りました。`,
    );
  }
  const { company_info } = extractCompanyByRules(source.text);
  return json({
    company_info,
    missing_fields: listMissing(company_info),
    _meta: meta,
  });
}

function handlePersonas(body: Record<string, unknown>): Response {
  const company = requireCompanyInfo(body.company_info);
  const count = requirePersonaCount(body.persona_count);
  const { personas, warnings } = sanitizePersonas(
    generatePersonasByRules(company, count),
    count,
    company,
  );
  return json({
    personas,
    _meta: { engine: "rules", warnings, note: DEMO_NOTE } satisfies EngineMeta,
  });
}

function handleMatch(body: Record<string, unknown>): Response {
  const persona = requirePersona(body.persona);
  const candidate = requireCandidate(body.candidate);

  // company_info は任意。壊れていても採点自体は続行する（本番ルートと同じ扱い）。
  let company;
  if (body.company_info) {
    try {
      company = requireCompanyInfo(body.company_info);
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
    }
  }

  const { match, trace } = scoreCandidate(persona, candidate, { company });
  return json({
    match,
    _trace: trace,
    _meta: {
      engine: "rules",
      warnings: [],
      note: "5軸すべてルール計算で算出しています（本番でも skills / culture / major / location は同じ計算式です）。",
    } satisfies EngineMeta,
  });
}

function handleEmails(body: Record<string, unknown>): Response {
  const persona = requirePersona(body.persona);
  const candidate = requireCandidate(body.candidate);
  const position = requirePositionInfo(body.position_info);

  let companyName = "弊社";
  if (body.company_info) {
    try {
      companyName = requireCompanyInfo(body.company_info).name;
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
    }
  }

  const emails = sanitizeEmails(
    generateEmailsByRules(persona, candidate, position, companyName),
  );
  return json({
    emails,
    _meta: { engine: "rules", warnings: [], note: DEMO_NOTE } satisfies EngineMeta,
  });
}

/** デモではキーを預からないので、常に「未設定・保存不可」を返す。 */
function handleSettings(): Response {
  return json({
    configured: false,
    source: "none",
    masked: null,
    editable: false,
  });
}

/* ---------- fetch の差し替え ---------- */

const ROUTES: Record<string, (body: Record<string, unknown>) => Response> = {
  "/api/extract": handleExtract,
  "/api/personas": handlePersonas,
  "/api/match": handleMatch,
  "/api/emails": handleEmails,
};

export function installApiShim(): void {
  const original = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const path = url.startsWith("http") ? new URL(url).pathname : url.split("?")[0];

    if (!path.startsWith("/api/")) return original(input, init);

    try {
      if (path === "/api/settings") return handleSettings();

      const handler = ROUTES[path];
      if (!handler) {
        return json({ error: { type: "not_found", message: `${path} は存在しません。` } }, 404);
      }

      const raw = typeof init?.body === "string" ? init.body : "{}";
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        throw new ValidationError("リクエストボディが JSON として解釈できません。");
      }
      return handler(parsed);
    } catch (error) {
      return failure(error);
    }
  };
}
