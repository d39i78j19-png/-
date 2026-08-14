import { NextResponse } from "next/server";
import { RefusalError } from "./anthropic";
import { ValidationError } from "./validate";

/**
 * `?strict=1` が付いた場合は JSON 契約のキーだけを返す。
 * 既定では UI 用のメタ情報（_meta / _trace）を付けて返す。
 */
export function isStrict(request: Request): boolean {
  const value = new URL(request.url).searchParams.get("strict");
  return value === "1" || value === "true";
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ValidationError) {
    return NextResponse.json(
      { error: { type: "validation_error", message: error.message } },
      { status: 400 },
    );
  }
  if (error instanceof RefusalError) {
    return NextResponse.json(
      {
        error: {
          type: "refusal",
          category: error.category,
          message: error.message,
        },
      },
      { status: 422 },
    );
  }
  const message =
    error instanceof Error ? error.message : "予期しないエラーが発生しました。";
  return NextResponse.json(
    { error: { type: "server_error", message } },
    { status: 500 },
  );
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ValidationError("リクエストボディが JSON として解釈できません。");
  }
}
