/**
 * Gemini 画像生成 API（Nano Banana）クライアント。
 *
 * 現在の推奨は Interactions API。`generateContent` も動くが、公式は新規開発に
 * Interactions を勧めている。SDK を挟まず素の fetch で叩いているのは、この
 * サーバーを依存パッケージ 0 で `node standalone/server.js` だけで動かすため。
 *
 * 押さえておくべき仕様（2026-08 時点）:
 *   - 1リクエストにつき画像は1枚。N人分は N回呼ぶ（number_of_images は無い）
 *   - アスペクト比・解像度は `response_format` に渡す。`image_config` は旧API用
 *   - 安全フィルタで画像が返らないことがある。必ず存在チェックする
 *   - 画像モデルに無料枠は無い（課金アカウントが必要）
 *
 * モデルIDと提供終了日は変動が激しいので、実装を触るときは
 * https://ai.google.dev/gemini-api/docs/models を確認すること。
 */

"use strict";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";

/** 1枚あたりの概算単価（USD・標準ティア）。dry-run のコスト表示に使う。 */
const PRICE_PER_IMAGE = {
  "gemini-3-pro-image": { "1K": 0.134, "2K": 0.134, "4K": 0.24 },
  "gemini-3.1-flash-image": { "512": 0.067, "1K": 0.067, "2K": 0.101, "4K": 0.151 },
  "gemini-3.1-flash-lite-image": { "1K": 0.0336 },
};

const DEFAULT_MODEL = "gemini-3-pro-image";

function estimateCost(model, size, count) {
  const table = PRICE_PER_IMAGE[model] || PRICE_PER_IMAGE[DEFAULT_MODEL];
  const unit = table[size] || Object.values(table)[0];
  return unit * count;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * レスポンスから画像ブロックを取り出す。
 * `output_image` は SDK 側の便宜プロパティなので、素の JSON では
 * steps[] → content[] を自分で走査する必要がある。
 */
function extractImage(json) {
  if (json && json.output_image && json.output_image.data) return json.output_image;
  let found = null;
  for (const step of json?.steps || []) {
    for (const c of step?.content || []) {
      if (c && c.type === "image" && c.data) found = c; // 最後の1件を採用
    }
  }
  return found;
}

/**
 * 画像を1枚生成する。
 *
 * @param {object} o
 * @param {string} o.prompt
 * @param {string} o.apiKey
 * @param {string} [o.model="gemini-3-pro-image"]
 * @param {string} [o.size="2K"]      512 / 1K / 2K / 4K
 * @param {string} [o.aspect="1:1"]   丸型アバターに切るなら 1:1 で作る
 * @param {{data:string, mimeType:string}} [o.reference] 同一人物を保つためのアンカー画像
 * @param {number} [o.retries=2]
 * @param {number} [o.timeoutMs=120000]
 * @returns {Promise<{data:string, mimeType:string, model:string}>} data は base64
 */
async function generateImage(o) {
  const model = o.model || DEFAULT_MODEL;
  const size = o.size || "2K";
  const aspect = o.aspect || "1:1";
  const retries = o.retries ?? 2;

  if (!o.apiKey) throw new Error("GEMINI_API_KEY が設定されていません");
  if (!o.prompt) throw new Error("プロンプトが空です");

  const input = [{ type: "text", text: o.prompt }];
  if (o.reference && o.reference.data) {
    input.push({
      type: "image",
      data: o.reference.data,
      mime_type: o.reference.mimeType || "image/png",
    });
  }

  const body = JSON.stringify({
    model,
    input,
    response_format: { type: "image", aspect_ratio: aspect, image_size: size },
  });

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), o.timeoutMs || 120000);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": o.apiKey },
        body,
        signal: ctl.signal,
      });

      if (!res.ok) {
        const text = (await res.text()).slice(0, 400);
        // 429/5xx は待って再試行する価値がある。4xx はプロンプトかキーの問題なので即座に諦める。
        const retriable = res.status === 429 || res.status >= 500;
        const err = new Error(`Gemini HTTP ${res.status}: ${text}`);
        if (!retriable || attempt === retries) throw err;
        lastError = err;
        await sleep(2000 * 2 ** attempt);
        continue;
      }

      const json = await res.json();
      const img = extractImage(json);
      if (!img || !img.data) {
        // 安全フィルタで落ちた場合はここに来る。作り直しても同じ結果になるので再試行しない。
        throw new Error(
          "画像が返りませんでした（安全フィルタの可能性）。プロンプトの表現を和らげてください",
        );
      }
      return { data: img.data, mimeType: img.mime_type || "image/png", model };
    } catch (e) {
      clearTimeout(timer);
      if (e.name === "AbortError") {
        lastError = new Error("Gemini API がタイムアウトしました");
        if (attempt === retries) throw lastError;
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("画像生成に失敗しました");
}

module.exports = { generateImage, estimateCost, DEFAULT_MODEL, PRICE_PER_IMAGE };
