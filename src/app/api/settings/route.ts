import { NextResponse } from "next/server";
import { errorResponse, readJsonBody } from "@/lib/apiHelpers";
import {
  canStoreKey,
  clearStoredKey,
  getApiKey,
  getKeySource,
  maskKey,
  writeStoredKey,
} from "@/lib/keyStore";
import { ValidationError } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SettingsState {
  configured: boolean;
  source: "env" | "stored" | "none";
  masked: string | null;
  /** 設定画面から保存できるか（デスクトップアプリなら true） */
  editable: boolean;
}

function currentState(): SettingsState {
  const key = getApiKey();
  const source = getKeySource();
  return {
    configured: Boolean(key),
    source,
    masked: key ? maskKey(key) : null,
    // 環境変数が設定されている場合はそちらが優先されるので編集させない
    editable: canStoreKey() && source !== "env",
  };
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(currentState());
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await readJsonBody(request)) as { api_key?: unknown };
    const apiKey = typeof body.api_key === "string" ? body.api_key.trim() : "";

    if (!apiKey) {
      throw new ValidationError("api_key を入力してください。");
    }
    if (!apiKey.startsWith("sk-ant-")) {
      throw new ValidationError(
        "Anthropic の API キーは sk-ant- で始まります。値を確認してください。",
      );
    }
    if (!canStoreKey()) {
      throw new ValidationError(
        "ブラウザ版ではキーを保存できません。環境変数 ANTHROPIC_API_KEY を設定してください。",
      );
    }

    writeStoredKey(apiKey);
    return NextResponse.json(currentState());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(): Promise<NextResponse> {
  try {
    clearStoredKey();
    return NextResponse.json(currentState());
  } catch (error) {
    return errorResponse(error);
  }
}
