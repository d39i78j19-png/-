import { NextResponse } from "next/server";
import { generateJson, hasApiKey } from "@/lib/anthropic";
import { errorResponse, isStrict, readJsonBody } from "@/lib/apiHelpers";
import {
  extractCompanyByRules,
  fillGaps,
  listMissing,
} from "@/lib/extractEngine";
import { COMPANY_EXTRACT_SCHEMA } from "@/lib/jsonSchemas";
import { EXTRACT_SYSTEM_PROMPT, extractUserMessage } from "@/lib/prompts";
import type { CompanyInfo, EngineMeta } from "@/lib/schema";
import {
  requireSourceText,
  sanitizeExtractedCompany,
  SOURCE_TEXT_MAX,
} from "@/lib/validate";

export const runtime = "nodejs";
export const maxDuration = 120;

interface ExtractResponse {
  company_info: CompanyInfo;
  missing_fields: string[];
}

/**
 * POST /api/extract
 * body: { source_text, engine?: "auto" | "rules" }
 *
 * 採用サイト / マイナビの掲載文を company_info に変換する。
 * Claude が使える場合は Claude の読み取りを優先し、埋まらなかった項目だけ
 * ルールベース抽出器で補完する（社名・卒業年度は正規表現のほうが安定するため）。
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await readJsonBody(request)) as Record<string, unknown>;
    const source = requireSourceText(body.source_text);
    const forceRules = body.engine === "rules";

    const meta: EngineMeta = { engine: "rules", warnings: [] };
    if (source.truncated) {
      meta.warnings?.push(
        `掲載文が長いため先頭 ${SOURCE_TEXT_MAX.toLocaleString("ja-JP")} 文字だけを読み取りました。`,
      );
    }

    // ルールベースの結果は常に作る（Claude の欠損を埋める土台にする）
    const rules = extractCompanyByRules(source.text);
    let company = rules.company_info;

    if (!forceRules && hasApiKey()) {
      try {
        const result = await generateJson<ExtractResponse>({
          system: EXTRACT_SYSTEM_PROMPT,
          user: extractUserMessage(source.text),
          schema: COMPANY_EXTRACT_SCHEMA,
          schemaName: "company_extract",
          effort: "medium",
        });
        company = fillGaps(
          sanitizeExtractedCompany(result.data.company_info),
          rules.company_info,
        );
        meta.engine = "claude";
        meta.model = result.model;
      } catch (error) {
        meta.engine = "rules";
        meta.warnings?.push(
          `Claude 呼び出しに失敗したためルールベースで読み取りました: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    } else if (!hasApiKey()) {
      meta.note =
        "ANTHROPIC_API_KEY が未設定のため、ルールベースで読み取っています。項目の取りこぼしは手で補ってください。";
    }

    // 欠損項目は missing_fields として別に返すので warnings には積まない
    const missing = listMissing(company);

    const payload: ExtractResponse = {
      company_info: company,
      missing_fields: missing,
    };
    if (isStrict(request)) return NextResponse.json(payload);
    return NextResponse.json({ ...payload, _meta: meta });
  } catch (error) {
    return errorResponse(error);
  }
}
