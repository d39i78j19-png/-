/**
 * OpenAI 画像生成 API クライアント。
 *
 * Gemini（Nano Banana）の代わりに OPENAI_API_KEY で顔写真を作るための経路。
 * 呼び出し側の形は lib/gemini-image.js と揃えてあるので、
 * lib/image-provider.js がどちらかを選ぶだけで差し替わる。
 *
 * 押さえておくべき仕様:
 *   - gpt-image-* は常に base64（data[0].b64_json）で返る。`response_format` を
 *     付けると 400 になるので送ってはいけない。dall-e-3 は逆に付ける必要がある
 *   - 正方形は 1024x1024 が上限。丸型アバターに切る前提なのでこれで足りる
 *   - 人物の写実生成は moderation で弾かれることがある。既定は auto のままにし、
 *     業務上必要な場合だけ OPENAI_IMAGE_MODERATION=low で緩める
 *
 * モデルIDと料金は変動するため、実装を触るときは
 * https://platform.openai.com/docs/guides/image-generation と
 * https://openai.com/api/pricing/ を確認すること。
 */

"use strict";

const ENDPOINT = "https://api.openai.com/v1/images/generations";

const DEFAULT_MODEL = "gpt-image-1";

/** 1枚あたりの概算単価（USD）。dry-run の目安表示用。正確な額は料金ページで確認すること。 */
const PRICE_PER_IMAGE = {
  "gpt-image-1": { low: 0.011, medium: 0.042, high: 0.167 },
  "dall-e-3": { standard: 0.04, hd: 0.08 },
};

/** アスペクト比 → OpenAI が受け付けるサイズ文字列。 */
const SIZE_FOR = {
  "gpt-image-1": { "1:1": "1024x1024", "2:3": "1024x1536", "3:2": "1536x1024" },
  "dall-e-3": { "1:1": "1024x1024", "2:3": "1024x1792", "3:2": "1792x1024" },
};

const isGptImage = (model) => model.startsWith("gpt-image");

function estimateCost(model, quality, count) {
  const table = PRICE_PER_IMAGE[model] || PRICE_PER_IMAGE[DEFAULT_MODEL];
  const unit = table[quality] || Object.values(table).at(-1);
  return unit * count;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 画像を1枚生成する。
 *
 * @param {object} o
 * @param {string} o.prompt
 * @param {string} o.apiKey
 * @param {string} [o.model="gpt-image-1"]
 * @param {string} [o.aspect="1:1"]
 * @param {string} [o.quality="high"]  gpt-image-1: low/medium/high ／ dall-e-3: standard/hd
 * @param {string} [o.moderation]      gpt-image-1 のみ。"low" で人物の誤検知を緩める
 * @param {number} [o.retries=2]
 * @param {number} [o.timeoutMs=180000]
 * @returns {Promise<{data:string, mimeType:string, model:string}>} data は base64
 */
async function generateImage(o) {
  const model = o.model || DEFAULT_MODEL;
  const aspect = o.aspect || "1:1";
  const quality = o.quality || (isGptImage(model) ? "high" : "hd");
  const retries = o.retries ?? 2;

  if (!o.apiKey) throw new Error("OPENAI_API_KEY が設定されていません");
  if (!o.prompt) throw new Error("プロンプトが空です");

  const sizes = SIZE_FOR[model] || SIZE_FOR[DEFAULT_MODEL];
  const payload = {
    model,
    prompt: o.prompt,
    n: 1,
    size: sizes[aspect] || sizes["1:1"],
    quality,
  };

  if (isGptImage(model)) {
    // gpt-image-* は response_format を受け付けない（付けると 400）。常に b64 で返る。
    payload.output_format = "jpeg";
    if (o.moderation) payload.moderation = o.moderation;
  } else {
    payload.response_format = "b64_json";
  }

  const body = JSON.stringify(payload);
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), o.timeoutMs || 180000);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${o.apiKey}` },
        body,
        signal: ctl.signal,
      });

      if (!res.ok) {
        const raw = await res.text();
        let message = raw.slice(0, 400);
        try { message = JSON.parse(raw).error?.message || message; } catch { /* そのまま */ }

        // 人物の写実生成はモデレーションで落ちることがある。再試行しても同じなので即座に返す。
        if (/safety|moderation|content policy|rejected/i.test(message)) {
          throw new Error(
            `OpenAI のモデレーションで拒否されました：${message}\n` +
              "OPENAI_IMAGE_MODERATION=low を設定するか、プロンプトの表現を和らげてください",
          );
        }
        const retriable = res.status === 429 || res.status >= 500;
        const err = new Error(`OpenAI HTTP ${res.status}: ${message}`);
        if (!retriable || attempt === retries) throw err;
        lastError = err;
        await sleep(2000 * 2 ** attempt);
        continue;
      }

      const json = await res.json();
      const item = json?.data?.[0];
      if (!item || !item.b64_json) {
        throw new Error("画像が返りませんでした（レスポンスに b64_json がありません）");
      }
      // output_format=jpeg を指定していても、モデルによっては png が返ることがある。
      // 先頭バイトで実物を見て決める（PNG は \x89PNG）。
      const head = Buffer.from(item.b64_json.slice(0, 12), "base64");
      const mimeType = head[0] === 0x89 && head[1] === 0x50 ? "image/png" : "image/jpeg";
      return { data: item.b64_json, mimeType, model };
    } catch (e) {
      clearTimeout(timer);
      if (e.name === "AbortError") {
        lastError = new Error("OpenAI API がタイムアウトしました");
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

module.exports = { generateImage, estimateCost, DEFAULT_MODEL, PRICE_PER_IMAGE, SIZE_FOR };
