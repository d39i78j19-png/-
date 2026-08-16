#!/usr/bin/env node
/**
 * ペルソナ顔写真生成サーバー（standalone プロトタイプ用）
 *
 *   ブラウザ → このサーバー → Gemini 画像生成API → 画像 → ブラウザ
 *
 * 画面（public/index.html）は最初からこのサーバーを前提に書かれていたが、
 * サーバー本体が存在しなかったため fetch が必ず失敗し、顔写真は永遠に
 * SVGイラストのままだった。ここがその欠けていた部分。
 *
 * APIキーはサーバーの環境変数からのみ読み、ブラウザには一切渡さない。
 * 依存パッケージは 0。`node standalone/server.js` だけで起動する。
 *
 * 環境変数:
 *   GEMINI_API_KEY      画像生成に必須。未設定ならプール画像／プレースホルダを返す
 *   ANTHROPIC_API_KEY   ペルソナ本文と各種AI診断。未設定ならルールベース
 *   PORTRAIT_MODEL      既定 gemini-3-pro-image
 *   PORTRAIT_SIZE       既定 2K（512 / 1K / 2K / 4K）
 *   PORTRAIT_WARDROBE   auto（既定・リクルートスーツ）/ casual（私服）
 *   PORTRAIT_SCENE      student（既定）/ office
 *   PORT                既定 8787
 */

"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const { buildPortraitPrompt } = require("./lib/portrait-prompt");
const { generateImage, DEFAULT_MODEL } = require("./lib/gemini-image");
const store = require("./lib/photo-store");
const text = require("./lib/persona-text");

const PORT = Number(process.env.PORT) || 8787;
const MODEL = process.env.PORTRAIT_MODEL || DEFAULT_MODEL;
const SIZE = process.env.PORTRAIT_SIZE || "2K";
const WARDROBE = process.env.PORTRAIT_WARDROBE || "auto";
const SCENE = process.env.PORTRAIT_SCENE || "student";

const hasGemini = () => Boolean(process.env.GEMINI_API_KEY);

/* ===================== 画像の解決 =====================
   キャッシュ → API生成 → 事前生成プール → プレースホルダ の順に落とす。
   どの段でも必ず「表示できる何か」を返す。壊れた画像アイコンは出さない。 */

async function resolvePortrait(persona, index) {
  const built = buildPortraitPrompt(persona, index, {
    wardrobe: WARDROBE,
    scene: SCENE,
    industry: persona._industry,
  });

  const key = store.cacheKey(built.prompt, MODEL, SIZE);
  const cached = store.findCached(key);
  if (cached) {
    return { url: cached.url, prompt: built.prompt, variable: built.variable,
             provider: "gemini(cache)", model: MODEL, mock: false, cached: true };
  }

  if (hasGemini()) {
    const img = await generateImage({
      prompt: built.prompt,
      apiKey: process.env.GEMINI_API_KEY,
      model: MODEL,
      size: SIZE,
      aspect: "1:1", // 丸型アバターに切る前提。他比率から丸く切ると頭頂と顎が欠ける
    });
    const saved = store.saveCached(key, img.data, img.mimeType);
    return { url: saved.url, prompt: built.prompt, variable: built.variable,
             provider: "gemini", model: MODEL, mock: false, cached: false };
  }

  const pooled = store.fromPool(persona.gender, index);
  if (pooled) {
    return { url: pooled.url, prompt: built.prompt, variable: built.variable,
             provider: "pool", model: "", mock: true,
             note: "GEMINI_API_KEY 未設定のため、事前生成プールの写真を割り当てました" };
  }

  return {
    dataUrl: store.placeholder(persona.name, persona.gender),
    prompt: built.prompt, variable: built.variable,
    provider: "placeholder", model: "", mock: true,
    note: "GEMINI_API_KEY 未設定。プレースホルダを表示しています",
  };
}

/* ===================== ルーティング ===================== */

const routes = {
  "POST /api/persona/prompt": async (body) => {
    const persona = body.persona || {};
    const built = buildPortraitPrompt(persona, Number(body.index) || 0, {
      wardrobe: WARDROBE, scene: SCENE, industry: body.industry,
    });
    return { prompt: built.prompt, variable: built.variable, fixed: built.fixed, model: MODEL, size: SIZE };
  },

  "POST /api/persona/image": async (body) => {
    const persona = body.persona || {};
    if (!persona.name) persona.name = "ペルソナ";
    const index = Number(body.index) || 0;

    // 画面側で組み立てたプロンプトが渡ってきた場合はそれを尊重する。
    if (body.prompt) {
      const key = store.cacheKey(body.prompt, MODEL, SIZE);
      const cached = store.findCached(key);
      if (cached) return { url: cached.url, prompt: body.prompt, provider: "gemini(cache)", mock: false, cached: true };

      if (hasGemini()) {
        const img = await generateImage({
          prompt: body.prompt, apiKey: process.env.GEMINI_API_KEY,
          model: MODEL, size: SIZE, aspect: "1:1",
        });
        const saved = store.saveCached(key, img.data, img.mimeType);
        return { url: saved.url, prompt: body.prompt, provider: "gemini", model: MODEL, mock: false };
      }
      const pooled = store.fromPool(persona.gender, index);
      if (pooled) {
        return { url: pooled.url, prompt: body.prompt, provider: "pool", mock: true,
                 note: "GEMINI_API_KEY 未設定のため、事前生成プールの写真を割り当てました" };
      }
      return { dataUrl: store.placeholder(persona.name, persona.gender), prompt: body.prompt,
               provider: "placeholder", mock: true, note: "GEMINI_API_KEY 未設定" };
    }

    return resolvePortrait(persona, index);
  },

  "POST /api/pipeline": async (body) => {
    const count = Math.min(Math.max(Number(body.count) || 3, 1), 8);
    const company = body.company || {};
    const conditions = body.conditions || {};

    // 採用ページが渡っていれば先に読む。失敗しても本体は止めない。
    let sourceText = (body.text || "").trim();
    const sourcePages = [];
    if (!sourceText && body.url) {
      try {
        const info = await text.analyzeCompany({ url: body.url, choices: {} });
        sourceText = JSON.stringify(info);
        sourcePages.push(body.url);
      } catch (e) {
        console.warn("[pipeline] 企業ページの取得に失敗:", e.message);
      }
    }

    let personas;
    let usedModel;
    if (text.hasTextKey()) {
      try {
        personas = await text.personasByAI({ company, conditions, count, sourceText });
        usedModel = text.TEXT_MODEL;
      } catch (e) {
        console.warn("[pipeline] AI生成に失敗、ルールベースに退避:", e.message);
      }
    }
    if (!personas || !personas.length) {
      personas = text.personasByRules({ company, conditions, count });
      usedModel = "ルールベース";
    }

    // 画像は1リクエスト1枚。人数分を順に呼ぶ。1人失敗しても他は返す。
    const results = [];
    for (let i = 0; i < personas.length; i++) {
      const persona = { ...personas[i], _industry: company.industry };
      let image;
      try {
        image = await resolvePortrait(persona, i);
      } catch (e) {
        console.warn(`[pipeline] ${persona.name} の画像生成に失敗:`, e.message);
        image = {
          dataUrl: store.placeholder(persona.name, persona.gender),
          provider: "placeholder", mock: true, note: `画像生成に失敗しました：${e.message}`,
        };
      }
      delete persona._industry;
      results.push({ persona, image, prompt: { prompt: image.prompt, variable: image.variable } });
    }

    return {
      results,
      model: usedModel,
      imageProvider: hasGemini() ? MODEL : results.some((r) => r.image.provider === "pool") ? "pool" : "placeholder",
      mock: !text.hasTextKey() || !hasGemini(),
      sourcePages,
    };
  },

  "POST /api/analyze/requirements": (body) => text.analyzeRequirements(body),
  "POST /api/analyze/scout": (body) => text.analyzeScout(body),
  "POST /api/analyze/company": (body) => text.analyzeCompany(body),
};

function healthPayload() {
  const poolCount = fs.existsSync(store.POOL_DIR)
    ? fs.readdirSync(store.POOL_DIR).filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f)).length
    : 0;
  return {
    // 画面側の変数名が hasOpenAI なので合わせている。実体は「テキストAIが使えるか」。
    hasOpenAI: text.hasTextKey(),
    hasGemini: hasGemini(),
    imageProvider: hasGemini() ? "gemini" : poolCount ? "pool" : "mock",
    imageModel: hasGemini() ? MODEL : poolCount ? `事前生成プール ${poolCount}枚` : "プレースホルダ",
    textModel: text.hasTextKey() ? text.TEXT_MODEL : "ルールベース",
    mock: !hasGemini(),
    portraitSize: SIZE,
    wardrobe: WARDROBE,
    scene: SCENE,
    poolCount,
  };
}

/* ===================== HTTP ===================== */

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 8 * 1024 * 1024) { reject(new Error("リクエストが大きすぎます")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        const e = new Error("リクエストの JSON を解釈できませんでした");
        e.status = 400;
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  const buf = Buffer.from(JSON.stringify(payload), "utf8");
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": buf.length,
    "cache-control": "no-store",
  });
  res.end(buf);
}

/** 画面をファイルから直接開いた場合（file://）にも叩けるようにしておく。 */
function cors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
}

function serveStatic(req, res, urlPath) {
  const rel = urlPath === "/" ? "/index.html" : urlPath;
  const file = path.join(store.PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(store.PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return;
  }
  const type = file.endsWith(".html")
    ? "text/html; charset=utf-8"
    : store.contentTypeFor(file);
  // 生成画像はハッシュ名なので長期キャッシュしてよい。HTML はしない。
  const cache = file.includes(path.sep + "cache" + path.sep)
    ? "public, max-age=31536000, immutable"
    : "no-cache";
  res.writeHead(200, { "content-type": type, "cache-control": cache });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const urlPath = new URL(req.url, "http://localhost").pathname;

  if (req.method === "GET" && urlPath === "/api/health") return sendJson(res, 200, healthPayload());

  const handler = routes[`${req.method} ${urlPath}`];
  if (handler) {
    try {
      const body = await readBody(req);
      const out = await handler(body);
      return sendJson(res, 200, out);
    } catch (e) {
      console.error(`[${urlPath}]`, e);
      return sendJson(res, e.status || 500, { error: e.message || "サーバー内部エラー" });
    }
  }

  if (req.method === "GET") return serveStatic(req, res, urlPath);

  sendJson(res, 404, { error: "そのエンドポイントはありません" });
});

store.ensureDirs();
server.listen(PORT, () => {
  const h = healthPayload();
  console.log(`\n  ペルソナ顔写真生成サーバー  http://localhost:${PORT}\n`);
  console.log(`  画像 : ${h.imageProvider}（${h.imageModel}）${h.hasGemini ? ` / ${SIZE} / 1:1` : ""}`);
  console.log(`  本文 : ${h.textModel}`);
  if (!h.hasGemini) {
    console.log(`\n  GEMINI_API_KEY が未設定です。実写の顔写真を出すには:`);
    console.log(`    export GEMINI_API_KEY="..." && node standalone/server.js`);
    console.log(`  事前にプールを焼いておく場合:`);
    console.log(`    node standalone/bin/generate-pool.mjs --dry-run`);
  }
  console.log("");
});
