/**
 * API キーの保存と読み出し。
 *
 * 優先順位:
 *   1. 環境変数 ANTHROPIC_API_KEY（Web で動かす / CI / サーバー運用の場合）
 *   2. アプリのユーザーデータディレクトリに保存したキー（デスクトップアプリの設定画面）
 *
 * 2 の保存先は Electron メインプロセスが PERSONA_STUDIO_DATA_DIR で渡してくる。
 * この環境変数が無い＝ブラウザ運用なので、設定画面からの保存は無効になる。
 *
 * セキュリティ上の注意:
 * キーは実行ユーザーのホーム配下に、パーミッション 0600（本人のみ読み書き可）の
 * ファイルとして平文保存される。共用 PC で使う場合や、キーを他人に見られたくない
 * 場合は環境変数での運用にすること。UI にも同じ注意書きを出している。
 */

import fs from "node:fs";
import path from "node:path";

const FILE_NAME = "anthropic-key.json";

export type KeySource = "env" | "stored" | "none";

function dataDir(): string | null {
  const dir = process.env.PERSONA_STUDIO_DATA_DIR;
  return dir && dir.trim().length > 0 ? dir : null;
}

/** 設定画面からキーを保存できる環境か（＝デスクトップアプリとして動いているか）。 */
export function canStoreKey(): boolean {
  return dataDir() !== null;
}

function keyFilePath(): string | null {
  const dir = dataDir();
  return dir ? path.join(dir, FILE_NAME) : null;
}

function readStoredKey(): string | null {
  const file = keyFilePath();
  if (!file) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
      api_key?: unknown;
    };
    const key = typeof parsed.api_key === "string" ? parsed.api_key.trim() : "";
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

export function writeStoredKey(apiKey: string): void {
  const file = keyFilePath();
  if (!file) {
    throw new Error(
      "このモードではキーを保存できません。環境変数 ANTHROPIC_API_KEY を使ってください。",
    );
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ api_key: apiKey.trim() }, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  // 既存ファイルを上書きした場合に備えて明示的に権限を締め直す
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Windows など chmod が意味を持たない環境では無視してよい
  }
}

export function clearStoredKey(): void {
  const file = keyFilePath();
  if (!file) return;
  try {
    fs.unlinkSync(file);
  } catch {
    // 元から無い場合は何もしない
  }
}

/** 実際に Claude 呼び出しへ使うキー。 */
export function getApiKey(): string | null {
  const fromEnv = process.env.ANTHROPIC_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  return readStoredKey();
}

export function getKeySource(): KeySource {
  if (process.env.ANTHROPIC_API_KEY?.trim()) return "env";
  if (readStoredKey()) return "stored";
  return "none";
}

/** 画面表示用のマスク済み文字列（先頭と末尾だけ残す）。 */
export function maskKey(apiKey: string): string {
  if (apiKey.length <= 12) return "****";
  return `${apiKey.slice(0, 8)}…${apiKey.slice(-4)}`;
}
