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
 * 画像は Gemini（Nano Banana）と OpenAI のどちらでも作れる。あるキーから自動で
 * 選ぶので、片方しか持っていなくてもそのまま動く。
 *
 * 環境変数:
 *   GEMINI_API_KEY      画像生成（既定の経路）
 *   OPENAI_API_KEY      画像生成（GEMINI_API_KEY が無いとき自動で使う）
 *   ANTHROPIC_API_KEY   ペルソナ本文と各種AI診断。未設定ならルールベース
 *   PORTRAIT_PROVIDER   auto（既定）/ gemini / openai
 *   PORTRAIT_MODEL      Gemini 側のモデル。既定 gemini-3-pro-image
 *   PORTRAIT_SIZE       Gemini 側の解像度。既定 2K（512 / 1K / 2K / 4K）
 *   OPENAI_IMAGE_MODEL  OpenAI 側のモデル。既定 gpt-image-1
 *   OPENAI_IMAGE_QUALITY  low / medium / high（既定 high）
 *   PORTRAIT_WARDROBE   auto（既定・リクルートスーツ）/ casual（私服）
 *   PORTRAIT_SCENE      student（既定）/ office
 *   PORT                既定 8787
 *
 * どちらのキーも無い場合は事前生成プール、それも無ければプレースホルダを返す。
 * 画面が壊れることはない。
 */

"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const { buildPortraitPrompt, expressionFor, ageBand } = require("./lib/portrait-prompt");
const segments = require("./lib/segments");
const imageProvider = require("./lib/image-provider");
const store = require("./lib/photo-store");
const text = require("./lib/persona-text");

const PORT = Number(process.env.PORT) || 8787;
const WARDROBE = process.env.PORTRAIT_WARDROBE || "auto";
const SCENE = process.env.PORTRAIT_SCENE || "student";

/* 起動時に1度だけ解決する。途中でキーが増えることはない。 */
const PROVIDER = imageProvider.resolveProvider();
const canGenerate = () => PROVIDER.name !== "none";

/* キャッシュキーにはモデルと解像度も混ぜる。同じ文章でもプロバイダが違えば別の絵になる。 */
const cacheKeyFor = (prompt) =>
  store.cacheKey(prompt, `${PROVIDER.name}:${PROVIDER.model}`, PROVIDER.size + PROVIDER.quality);

/* ===================== 画像の解決 =====================
   PHOTO_SOURCE で経路を選ぶ。

     pool（プールに写真があれば既定）… 事前に入れた写真から属性で選ぶ。
       APIキー・課金・待ち時間ゼロ。採用する顔を人の目で選び切れるので、
       プロトタイプや配布物ではこれがいちばん実用的。
     api                            … 都度 Gemini / OpenAI で生成する。
     auto                           … プールがあれば pool、無ければ api。

   どの経路でも最後はプレースホルダに落ちる。壊れた画像アイコンは出さない。 */

const PHOTO_SOURCE = (process.env.PHOTO_SOURCE || "auto").toLowerCase();

/**
 * 実際にどの経路で顔写真が出るかを返す。健康チェックの表示と実際の挙動が
 * ズレないよう、退避も含めてここ1か所で決める。
 */
function photoSource() {
  const hasPool = store.loadPool().length > 0;
  if (PHOTO_SOURCE === "pool") return hasPool ? "pool" : canGenerate() ? "api" : "none";
  if (PHOTO_SOURCE === "api") return canGenerate() ? "api" : hasPool ? "pool" : "none";
  return hasPool ? "pool" : canGenerate() ? "api" : "none"; // auto
}

/**
 * @param {Set<string>} [used]    同じセット内で同じ写真を配らないための使用済み集合
 * @param {object} [context]      { conditions, company } セグメント判定に使う
 */
async function resolvePortrait(persona, index, used, context = {}) {
  const built = buildPortraitPrompt(persona, index, {
    wardrobe: WARDROBE,
    scene: SCENE,
    industry: persona._industry,
  });

  // プール経路。セグメント（志向 × 志望企業規模）を主軸に、合う写真を選ぶ。
  if (photoSource() === "pool") {
    const segment = segments.segmentOf(persona, context);
    const pooled = store.assignFromPool(persona, index, used || new Set(), {
      orientation: segment.orientation,
      companySize: segment.companySize,
      expression: expressionFor(persona).key,
      wardrobe: WARDROBE === "casual" ? "casual" : "recruit",
      scene: SCENE,
      ageBand: ageBand(persona.age),
    });
    if (pooled) {
      const e = pooled.entry;
      const segmentMatched = e.orientation === segment.orientation && e.companySize === segment.companySize;
      return {
        url: pooled.url, prompt: built.prompt, variable: built.variable,
        provider: "pool", model: "", mock: false,
        matched: e,
        segment,
        segmentMatched,
        note: pooled.reused
          ? "プールの枚数が足りず、同じ写真を再利用しました"
          : !segmentMatched && (e.orientation || e.companySize)
            ? `「${segment.label}」の写真が足りず、近いものを割り当てました`
            : undefined,
      };
    }
  }

  const key = cacheKeyFor(built.prompt);
  const cached = store.findCached(key);
  if (cached) {
    return { url: cached.url, prompt: built.prompt, variable: built.variable,
             provider: `${PROVIDER.name}(cache)`, model: PROVIDER.model, mock: false, cached: true };
  }

  if (canGenerate()) {
    // 丸型アバターに切る前提なので 1:1。他比率から丸く切ると頭頂と顎が欠ける。
    const img = await imageProvider.generate({ prompt: built.prompt, aspect: "1:1" }, PROVIDER);
    const saved = store.saveCached(key, img.data, img.mimeType);
    return { url: saved.url, prompt: built.prompt, variable: built.variable,
             provider: PROVIDER.name, model: PROVIDER.model, mock: false, cached: false };
  }

  // API経路を選んだがキーが無い場合、プールがあればそちらに退避する
  const pooled = store.assignFromPool(persona, index, used || new Set());
  if (pooled) {
    return { url: pooled.url, prompt: built.prompt, variable: built.variable,
             provider: "pool", model: "", mock: true, note: NO_KEY_NOTE_POOL };
  }

  return {
    dataUrl: store.placeholder(persona.name, persona.gender),
    prompt: built.prompt, variable: built.variable,
    provider: "placeholder", model: "", mock: true, note: NO_KEY_NOTE,
  };
}

const NO_KEY_NOTE =
  "画像生成用のAPIキー（GEMINI_API_KEY または OPENAI_API_KEY）が未設定です。プレースホルダを表示しています";
const NO_KEY_NOTE_POOL =
  "画像生成用のAPIキーが未設定のため、事前生成プールの写真を割り当てました";

/* ===================== ルーティング ===================== */

const routes = {
  "POST /api/persona/prompt": async (body) => {
    const persona = body.persona || {};
    const built = buildPortraitPrompt(persona, Number(body.index) || 0, {
      wardrobe: WARDROBE, scene: SCENE, industry: body.industry,
    });
    return { prompt: built.prompt, variable: built.variable, fixed: built.fixed,
             provider: PROVIDER.name, model: PROVIDER.model, size: PROVIDER.size };
  },

  "POST /api/persona/image": async (body) => {
    const persona = body.persona || {};
    if (!persona.name) persona.name = "ペルソナ";
    const index = Number(body.index) || 0;

    // 画面側で組み立てたプロンプトが渡ってきた場合はそれを尊重する。
    // ただしプール経路のときは生成しないので、そちらを先に見る。
    if (body.prompt && photoSource() !== "pool") {
      const key = cacheKeyFor(body.prompt);
      const cached = store.findCached(key);
      if (cached) {
        return { url: cached.url, prompt: body.prompt, provider: `${PROVIDER.name}(cache)`, mock: false, cached: true };
      }
      if (canGenerate()) {
        const img = await imageProvider.generate({ prompt: body.prompt, aspect: "1:1" }, PROVIDER);
        const saved = store.saveCached(key, img.data, img.mimeType);
        return { url: saved.url, prompt: body.prompt, provider: PROVIDER.name, model: PROVIDER.model, mock: false };
      }
      const pooled = store.assignFromPool(persona, index);
      if (pooled) {
        return { url: pooled.url, prompt: body.prompt, provider: "pool", mock: true, note: NO_KEY_NOTE_POOL };
      }
      return { dataUrl: store.placeholder(persona.name, persona.gender), prompt: body.prompt,
               provider: "placeholder", mock: true, note: NO_KEY_NOTE };
    }

    /* 1人だけの差し替えでも、画面が既に配っている写真は避けたい。
       exclude に表示中の他ペルソナのファイル名を渡してもらう。 */
    const used = new Set(Array.isArray(body.exclude) ? body.exclude : []);
    return resolvePortrait(persona, index, used, {
      conditions: body.conditions,
      company: body.company,
    });
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
    // used はセット内で同じ顔を2人に配らないための共有集合。
    const results = [];
    const used = new Set();
    for (let i = 0; i < personas.length; i++) {
      const persona = { ...personas[i], _industry: company.industry };
      let image;
      try {
        image = await resolvePortrait(persona, i, used, { conditions, company });
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
      imageProvider: results.some((r) => r.image.provider === "pool")
        ? `事前生成プール（${store.loadPool().length}枚）`
        : canGenerate() ? PROVIDER.label : "placeholder",
      mock: !text.hasTextKey() || results.some((r) => r.image.provider === "placeholder"),
      sourcePages,
    };
  },

  /* ---- プールの管理（photos.html から使う） ---- */

  "POST /api/pool/list": async () => ({
    photos: store.loadPool(),
    source: photoSource(),
    canGenerate: canGenerate(),
    segments: segments.SEGMENTS,
    coverage: poolCoverage(),
  }),

  /**
   * 画像をプールに取り込む。連結画像（コンタクトシート）の切り出しは
   * ブラウザの canvas 側で済ませ、ここには1枚ずつの data URL が届く。
   * ファイル名はサーバー側で採番する。クライアントの申告は信用しない。
   */
  "POST /api/pool/import": async (body) => {
    const items = Array.isArray(body.photos) ? body.photos : [];
    if (!items.length) throw Object.assign(new Error("取り込む画像がありません"), { status: 400 });
    if (items.length > 64) throw Object.assign(new Error("一度に取り込めるのは64枚までです"), { status: 400 });

    store.ensureDirs();
    const pool = store.loadPool();
    const taken = new Set(pool.map((p) => p.file));
    const photos = pool.map((p) => ({
      file: p.file, gender: p.gender, age: p.age,
      orientation: p.orientation, companySize: p.companySize, tags: p.tags, note: p.note,
    }));
    const added = [];

    for (const item of items) {
      const m = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(item.dataUrl || ""));
      if (!m) throw Object.assign(new Error("画像は data URL（jpeg/png/webp）で渡してください"), { status: 400 });

      const buf = Buffer.from(m[2], "base64");
      if (buf.length > 6 * 1024 * 1024) {
        throw Object.assign(new Error("1枚あたり6MBまでです"), { status: 400 });
      }
      const ext = m[1] === "png" ? "png" : m[1] === "webp" ? "webp" : "jpg";
      const gender = ["male", "female"].includes(item.gender) ? item.gender : "unknown";
      const orientation = segments.ORIENTATIONS.some((o) => o.key === item.orientation) ? item.orientation : "";
      const companySize = segments.COMPANY_SIZES.some((s) => s.key === item.companySize) ? item.companySize : "";

      /* ファイル名にセグメントを入れておくと、manifest.json を無くしても
         どの分類の写真か人の目で分かる。 */
      const prefix = [orientation, companySize, gender].filter(Boolean).join("-");
      let seq = 1;
      let name;
      do {
        name = `${prefix}-${String(seq).padStart(2, "0")}.${ext}`;
        seq++;
      } while (taken.has(name) || fs.existsSync(path.join(store.POOL_DIR, name)));

      fs.writeFileSync(path.join(store.POOL_DIR, name), buf);
      taken.add(name);
      const entry = {
        file: name,
        gender,
        age: Number(item.age) || 22,
        orientation,
        companySize,
        tags: Array.isArray(item.tags) ? item.tags.filter((t) => typeof t === "string").slice(0, 8) : [],
        note: typeof item.note === "string" ? item.note.slice(0, 120) : "",
      };
      photos.push(entry);
      added.push(entry);
    }

    store.writeManifest(photos);
    return { added: added.length, photos, source: photoSource() };
  },

  /** 写真1枚のタグ・性別・年齢を更新する。 */
  "POST /api/pool/update": async (body) => {
    const photos = store.loadPool().map((p) => ({
      file: p.file, gender: p.gender, age: p.age,
      orientation: p.orientation, companySize: p.companySize, tags: p.tags, note: p.note,
    }));
    const target = photos.find((p) => p.file === body.file);
    if (!target) throw Object.assign(new Error("その写真はプールにありません"), { status: 404 });

    if (["male", "female", "unknown"].includes(body.gender)) target.gender = body.gender;
    if (Number(body.age)) target.age = Number(body.age);
    if (Array.isArray(body.tags)) target.tags = body.tags.filter((t) => typeof t === "string").slice(0, 8);
    store.writeManifest(photos);
    return { photos };
  },

  /** 写真をプールから削除する。うまく写っていない顔を落とすため。 */
  "POST /api/pool/remove": async (body) => {
    // ファイル名はプールに実在するものだけを受け付ける（パス指定は通さない）
    const pool = store.loadPool();
    if (!pool.some((p) => p.file === body.file)) {
      throw Object.assign(new Error("その写真はプールにありません"), { status: 404 });
    }
    fs.rmSync(path.join(store.POOL_DIR, body.file), { force: true });
    const photos = pool
      .filter((p) => p.file !== body.file)
      .map((p) => ({
        file: p.file, gender: p.gender, age: p.age,
        orientation: p.orientation, companySize: p.companySize, tags: p.tags, note: p.note,
      }));
    store.writeManifest(photos);
    return { photos, source: photoSource() };
  },

  "POST /api/analyze/requirements": (body) => text.analyzeRequirements(body),
  "POST /api/analyze/scout": (body) => text.analyzeScout(body),
  "POST /api/analyze/company": (body) => text.analyzeCompany(body),
};

/**
 * セグメントごとの充足状況。どの分類の写真が足りないかを画面に出すため。
 * 男女それぞれ最低1枚、5人のペルソナを出すなら3枚以上あると使い回しが起きにくい。
 */
function poolCoverage() {
  const pool = store.loadPool();
  return segments.SEGMENTS.map((seg) => {
    const hit = pool.filter((p) => p.orientation === seg.orientation && p.companySize === seg.companySize);
    return {
      ...seg,
      male: hit.filter((p) => p.gender === "male").length,
      female: hit.filter((p) => p.gender === "female").length,
      total: hit.length,
    };
  });
}

function healthPayload() {
  const poolCount = store.loadPool().length;
  const source = photoSource();
  const usingPool = source === "pool" && poolCount > 0;

  return {
    // 画面側の変数名が hasOpenAI なので合わせている。実体は「テキストAIが使えるか」。
    hasOpenAI: text.hasTextKey(),
    // 実写の顔写真が今この瞬間に出せるか。プール経路でも true。画面のバッジはこれを見る。
    canGeneratePhotos: usingPool || canGenerate(),
    // 旧名。画面の古い版が参照していたので互換のために残す。
    hasGemini: usingPool || canGenerate(),
    photoSource: usingPool ? "pool" : canGenerate() ? "api" : "none",
    imageProvider: usingPool ? "pool" : canGenerate() ? PROVIDER.name : "mock",
    imageModel: usingPool
      ? `事前生成プール ${poolCount}枚`
      : canGenerate() ? PROVIDER.model : "プレースホルダ",
    textModel: text.hasTextKey() ? text.TEXT_MODEL : "ルールベース",
    mock: !usingPool && !canGenerate(),
    portraitSize: usingPool ? "" : canGenerate() ? PROVIDER.size : "",
    portraitQuality: usingPool ? "" : PROVIDER.quality,
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
  if (h.photoSource === "pool") {
    console.log(`  顔写真 : 事前生成プール ${h.poolCount}枚（APIキー不要・課金なし・即時）`);
    console.log(`           ペルソナの性別・年齢・表情に合う写真を選んで割り当てます`);
  } else if (h.photoSource === "api") {
    console.log(`  顔写真 : ${PROVIDER.name}（${PROVIDER.label} / 1:1）— 都度生成`);
  } else {
    console.log(`  顔写真 : プレースホルダ`);
  }
  console.log(`  本文   : ${h.textModel}`);

  if (h.photoSource === "none") {
    console.log(`\n  実写の顔写真を出す方法は2通りあります。`);
    console.log(`\n  【A】写真を先に用意する（推奨・APIキー不要）`);
    console.log(`    http://localhost:${PORT}/photos.html を開いて写真を読み込む`);
    console.log(`    または  node standalone/bin/import-photos.mjs <画像ファイル…>`);
    console.log(`\n  【B】都度APIで生成する`);
    console.log(`    export GEMINI_API_KEY="..."    # 人物ポートレートの写実性が安定して高い`);
    console.log(`    export OPENAI_API_KEY="..."    # gpt-image-1 で生成`);
  }
  console.log("");
});
