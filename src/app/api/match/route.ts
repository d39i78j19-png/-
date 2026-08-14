import { NextResponse } from "next/server";
import { generateJson, hasApiKey } from "@/lib/anthropic";
import { errorResponse, isStrict, readJsonBody } from "@/lib/apiHelpers";
import { EXTRAS_JUDGEMENT_SCHEMA } from "@/lib/jsonSchemas";
import { scoreCandidate } from "@/lib/matchEngine";
import { EXTRAS_SYSTEM_PROMPT, extrasUserMessage } from "@/lib/prompts";
import type { EngineMeta, MatchOutput } from "@/lib/schema";
import {
  requireCandidate,
  requireCompanyInfo,
  requirePersona,
  ValidationError,
} from "@/lib/validate";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ExtrasJudgement {
  extras_score: number;
  reason: string;
}

/**
 * POST /api/match
 * body: { persona, candidate, company_info?, use_ai_extras?: boolean }
 *
 * skills / culture / major / location は仕様の計算式をそのまま TypeScript で
 * 実行するため決定論的。extras だけは「活動の質・頻度を文脈から判断」する
 * 必要があるので、API キーがあれば Claude の判定で上書きする。
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await readJsonBody(request)) as Record<string, unknown>;
    const persona = requirePersona(body.persona);
    const candidate = requireCandidate(body.candidate);

    // company_info は任意。あれば culture / location の判定材料になる。
    let company;
    if (body.company_info) {
      try {
        company = requireCompanyInfo(body.company_info);
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        company = undefined;
      }
    }

    const meta: EngineMeta = { engine: "rules", warnings: [] };
    const useAiExtras = body.use_ai_extras !== false && hasApiKey();
    let extrasOverride: { score: number; reason: string } | undefined;

    if (useAiExtras) {
      try {
        const result = await generateJson<ExtrasJudgement>({
          system: EXTRAS_SYSTEM_PROMPT,
          user: extrasUserMessage({
            persona_label: persona.label,
            persona_description: persona.description,
            persona_expected_extracurriculars: [
              ...new Set(
                persona.example_profiles.flatMap(
                  (p) => p.extracurriculars ?? [],
                ),
              ),
            ],
            candidate_extracurriculars: candidate.extracurriculars ?? [],
            candidate_resume_text: candidate.resume_text ?? "",
          }),
          schema: EXTRAS_JUDGEMENT_SCHEMA,
          schemaName: "extras_judgement",
          maxTokens: 2000,
          effort: "low",
        });
        extrasOverride = {
          score: result.data.extras_score,
          reason: result.data.reason,
        };
        meta.engine = "claude";
        meta.model = result.model;
        meta.note =
          "skills / culture / major / location は決定論的なルール計算、extras のみ Claude の文脈判断です。";
      } catch (error) {
        meta.warnings?.push(
          `extras_score の文脈判断に失敗したためルール計算のみで算出しました: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    } else if (!hasApiKey()) {
      meta.note =
        "ANTHROPIC_API_KEY が未設定のため、5軸すべてルール計算で算出しています。";
    }

    const { match, trace } = scoreCandidate(persona, candidate, {
      company,
      extrasOverride,
    });

    const payload: MatchOutput = { match };
    if (isStrict(request)) return NextResponse.json(payload);
    return NextResponse.json({ ...payload, _trace: trace, _meta: meta });
  } catch (error) {
    return errorResponse(error);
  }
}
