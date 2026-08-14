import Anthropic from "@anthropic-ai/sdk";

/**
 * Claude 呼び出しの薄いラッパ。
 * Structured Outputs で JSON を受け取り、拒否（refusal）も明示的に扱う。
 */

export const MODEL = "claude-opus-5";

/** API キーが無ければ全ルートはルールベースエンジンにフォールバックする。 */
export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let cached: Anthropic | null = null;
function client(): Anthropic {
  if (!cached) cached = new Anthropic();
  return cached;
}

/** Claude の安全性分類器がリクエストを断った場合に投げる。 */
export class RefusalError extends Error {
  readonly category: string | null;
  constructor(category: string | null, explanation?: string | null) {
    super(
      explanation ??
        "Claude がこのリクエストへの応答を見送りました（safety refusal）。",
    );
    this.name = "RefusalError";
    this.category = category;
  }
}

export interface GenerateJsonOptions {
  system: string;
  user: string;
  schema: unknown;
  schemaName: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

export interface GenerateJsonResult<T> {
  data: T;
  model: string;
  usage: { input: number; output: number };
}

/**
 * Structured Outputs で JSON を1件取得する。
 *
 * - fallbacks: "default" を既定で有効化している。Claude Opus 5 の分類器が
 *   リクエストを断った場合、同じ呼び出しの中で Anthropic 推奨の代替モデルが
 *   再実行するため、正当な採用業務の誤検知でユーザーの手が止まりにくい。
 * - max_tokens は 16000（非ストリーミングで HTTP タイムアウトに触らない範囲）。
 */
export async function generateJson<T>(
  options: GenerateJsonOptions,
): Promise<GenerateJsonResult<T>> {
  // fallbacks / output_config は SDK の型定義が追いついていないため一度だけキャストする
  type CreateParams = Parameters<Anthropic["beta"]["messages"]["create"]>[0];
  const params = {
    model: MODEL,
    max_tokens: options.maxTokens ?? 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: options.system,
    output_config: {
      ...(options.effort ? { effort: options.effort } : {}),
      format: {
        type: "json_schema",
        name: options.schemaName,
        schema: options.schema,
      },
    },
    messages: [{ role: "user", content: options.user }],
  } as unknown as CreateParams;

  // 非ストリーミング呼び出しなので BetaMessage が返る
  const response = (await client().beta.messages.create(
    params,
  )) as Anthropic.Beta.Messages.BetaMessage;

  if (response.stop_reason === "refusal") {
    const details = (
      response as unknown as {
        stop_details?: { category?: string | null; explanation?: string | null } | null;
      }
    ).stop_details;
    throw new RefusalError(details?.category ?? null, details?.explanation ?? null);
  }

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude の応答にテキストブロックがありませんでした。");
  }

  let parsed: T;
  try {
    parsed = JSON.parse(textBlock.text) as T;
  } catch {
    throw new Error("Claude の応答を JSON として解釈できませんでした。");
  }

  return {
    data: parsed,
    model: response.model,
    usage: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
    },
  };
}
