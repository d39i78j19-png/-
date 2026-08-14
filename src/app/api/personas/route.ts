import { NextResponse } from "next/server";
import { generateJson, hasApiKey } from "@/lib/anthropic";
import { errorResponse, isStrict, readJsonBody } from "@/lib/apiHelpers";
import { PERSONA_OUTPUT_SCHEMA } from "@/lib/jsonSchemas";
import { generatePersonasByRules } from "@/lib/personaEngine";
import { PERSONA_SYSTEM_PROMPT, personaUserMessage } from "@/lib/prompts";
import type { EngineMeta, PersonaGenerationOutput } from "@/lib/schema";
import {
  requireCompanyInfo,
  requirePersonaCount,
  sanitizePersonas,
} from "@/lib/validate";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/personas
 * body: { company_info, persona_count?, engine?: "auto" | "rules" }
 *
 * 返り値は仕様どおり { personas: [...] }。
 * `?strict=1` を付けない場合は UI 用に `_meta` を添える。
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await readJsonBody(request)) as Record<string, unknown>;
    const company = requireCompanyInfo(body.company_info);
    const count = requirePersonaCount(body.persona_count);
    const forceRules = body.engine === "rules";

    const meta: EngineMeta = { engine: "rules", warnings: [] };
    let raw: unknown[];

    if (!forceRules && hasApiKey()) {
      try {
        const result = await generateJson<PersonaGenerationOutput>({
          system: PERSONA_SYSTEM_PROMPT,
          user: personaUserMessage({
            company_info: company,
            persona_count: count,
          }),
          schema: PERSONA_OUTPUT_SCHEMA,
          schemaName: "persona_generation",
          effort: "high",
        });
        raw = Array.isArray(result.data.personas) ? result.data.personas : [];
        meta.engine = "claude";
        meta.model = result.model;
      } catch (error) {
        // Claude 側で失敗してもフォームの操作は止めない。理由を残してルールベースに落とす。
        raw = generatePersonasByRules(company, count);
        meta.engine = "rules";
        meta.warnings?.push(
          `Claude 呼び出しに失敗したためルールベースで生成しました: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    } else {
      raw = generatePersonasByRules(company, count);
      if (!hasApiKey()) {
        meta.note =
          "ANTHROPIC_API_KEY が未設定のため、ルールベースエンジンで生成しています。";
      }
    }

    const { personas, warnings } = sanitizePersonas(raw, count, company);
    meta.warnings = [...(meta.warnings ?? []), ...warnings];

    const payload: PersonaGenerationOutput = { personas };
    if (isStrict(request)) return NextResponse.json(payload);
    return NextResponse.json({ ...payload, _meta: meta });
  } catch (error) {
    return errorResponse(error);
  }
}
