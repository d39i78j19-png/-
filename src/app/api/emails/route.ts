import { NextResponse } from "next/server";
import { generateJson, hasApiKey } from "@/lib/anthropic";
import { errorResponse, isStrict, readJsonBody } from "@/lib/apiHelpers";
import { generateEmailsByRules } from "@/lib/emailEngine";
import { EMAIL_OUTPUT_SCHEMA } from "@/lib/jsonSchemas";
import { EMAIL_SYSTEM_PROMPT, emailUserMessage } from "@/lib/prompts";
import type { EngineMeta, ScoutEmailOutput } from "@/lib/schema";
import {
  requireCandidate,
  requireCompanyInfo,
  requirePersona,
  requirePositionInfo,
  sanitizeEmails,
  ValidationError,
} from "@/lib/validate";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/emails
 * body: { persona, candidate, position_info, company_info?, engine?: "auto" | "rules" }
 *
 * 返り値は仕様どおり { emails: [...] }。トーン違いで3通返す。
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await readJsonBody(request)) as Record<string, unknown>;
    const persona = requirePersona(body.persona);
    const candidate = requireCandidate(body.candidate);
    const position = requirePositionInfo(body.position_info);

    let company;
    if (body.company_info) {
      try {
        company = requireCompanyInfo(body.company_info);
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        company = undefined;
      }
    }

    const forceRules = body.engine === "rules";
    const meta: EngineMeta = { engine: "rules", warnings: [] };
    let raw: unknown;

    if (!forceRules && hasApiKey()) {
      try {
        const result = await generateJson<ScoutEmailOutput>({
          system: EMAIL_SYSTEM_PROMPT,
          user: emailUserMessage({
            persona,
            candidate,
            position_info: position,
            company_info: company,
          }),
          schema: EMAIL_OUTPUT_SCHEMA,
          schemaName: "scout_emails",
        });
        raw = result.data.emails;
        meta.engine = "claude";
        meta.model = result.model;
      } catch (error) {
        raw = generateEmailsByRules(
          persona,
          candidate,
          position,
          company?.name ?? "弊社",
        );
        meta.warnings?.push(
          `Claude 呼び出しに失敗したためテンプレートで生成しました: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    } else {
      raw = generateEmailsByRules(
        persona,
        candidate,
        position,
        company?.name ?? "弊社",
      );
      if (!hasApiKey()) {
        meta.note =
          "ANTHROPIC_API_KEY が未設定のため、テンプレートエンジンで生成しています。";
      }
    }

    const emails = sanitizeEmails(raw);
    if (emails.length === 0) {
      meta.warnings?.push("生成結果が空だったためテンプレートで補完しました。");
    }

    const payload: ScoutEmailOutput = {
      emails:
        emails.length > 0
          ? emails
          : sanitizeEmails(
              generateEmailsByRules(
                persona,
                candidate,
                position,
                company?.name ?? "弊社",
              ),
            ),
    };
    if (isStrict(request)) return NextResponse.json(payload);
    return NextResponse.json({ ...payload, _meta: meta });
  } catch (error) {
    return errorResponse(error);
  }
}
