/**
 * 画像生成プロバイダの選択。
 *
 * Gemini（Nano Banana）と OpenAI のどちらでも顔写真を作れるようにし、
 * 環境変数にあるキーから自動で選ぶ。呼び出し側（server.js / generate-pool.mjs）は
 * どちらが使われているかを意識しない。
 *
 * 既定は Gemini。人物ポートレートの写実性はこちらの方が安定して高く、
 * 参照画像で同一人物を保つ機能も持っているため。OPENAI_API_KEY しか無ければ
 * 自動で OpenAI に切り替わる。PORTRAIT_PROVIDER で明示指定もできる。
 */

"use strict";

const gemini = require("./gemini-image");
const openai = require("./openai-image");

/**
 * 使用するプロバイダを決める。
 * @returns {{name:"gemini"|"openai"|"none", model:string, quality:string, size:string, label:string}}
 */
function resolveProvider(env = process.env) {
  const want = (env.PORTRAIT_PROVIDER || "auto").toLowerCase();
  const hasGemini = Boolean(env.GEMINI_API_KEY);
  const hasOpenAI = Boolean(env.OPENAI_API_KEY);

  let name;
  if (want === "gemini") name = hasGemini ? "gemini" : "none";
  else if (want === "openai") name = hasOpenAI ? "openai" : "none";
  else name = hasGemini ? "gemini" : hasOpenAI ? "openai" : "none"; // auto

  if (name === "gemini") {
    const model = env.PORTRAIT_MODEL || gemini.DEFAULT_MODEL;
    const size = env.PORTRAIT_SIZE || "2K";
    return { name, model, size, quality: "", label: `${model} / ${size}` };
  }
  if (name === "openai") {
    const model = env.OPENAI_IMAGE_MODEL || openai.DEFAULT_MODEL;
    const quality = env.OPENAI_IMAGE_QUALITY || (model.startsWith("gpt-image") ? "high" : "hd");
    const size = (openai.SIZE_FOR[model] || openai.SIZE_FOR[openai.DEFAULT_MODEL])["1:1"];
    return { name, model, size, quality, label: `${model} / ${quality} / ${size}` };
  }
  return { name: "none", model: "", size: "", quality: "", label: "" };
}

/**
 * 選ばれたプロバイダで1枚生成する。
 * @param {{prompt:string, aspect?:string, reference?:object}} req
 * @param {object} [provider] resolveProvider() の戻り。省略時はその場で解決する
 */
async function generate(req, provider = resolveProvider()) {
  if (provider.name === "gemini") {
    return gemini.generateImage({
      prompt: req.prompt,
      apiKey: process.env.GEMINI_API_KEY,
      model: provider.model,
      size: provider.size,
      aspect: req.aspect || "1:1",
      reference: req.reference,
    });
  }
  if (provider.name === "openai") {
    if (req.reference) {
      // 参照画像で同一人物を保つ経路は images/edits 側で、仕様が別物になる。
      // ここで黙って無視すると「顔が変わらないはず」が崩れるので明示的に止める。
      throw new Error(
        "OpenAI 経路は参照画像（--anchor）に未対応です。同一人物の複数カットが必要な場合は " +
          "GEMINI_API_KEY を設定して Gemini 経路をお使いください",
      );
    }
    return openai.generateImage({
      prompt: req.prompt,
      apiKey: process.env.OPENAI_API_KEY,
      model: provider.model,
      quality: provider.quality,
      aspect: req.aspect || "1:1",
      moderation: process.env.OPENAI_IMAGE_MODERATION,
    });
  }
  throw new Error("画像生成用のAPIキーが設定されていません（GEMINI_API_KEY または OPENAI_API_KEY）");
}

/** dry-run 用の概算費用。 */
function estimateCost(provider, count) {
  if (provider.name === "gemini") return gemini.estimateCost(provider.model, provider.size, count);
  if (provider.name === "openai") return openai.estimateCost(provider.model, provider.quality, count);
  return 0;
}

module.exports = { resolveProvider, generate, estimateCost };
