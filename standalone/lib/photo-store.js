/**
 * 生成した顔写真の保管。
 *
 * 画像生成は 1枚あたり $0.1 前後かかるうえ 10〜20秒待たされる。同じプロンプトで
 * 同じ絵を作り直すのは金と時間の無駄なので、プロンプトのハッシュをキーにして
 * ディスクに残し、2回目以降はそれを返す。デモを何度回しても課金は初回だけになる。
 *
 * さらに「プール」を持つ。事前に bin/generate-pool.mjs で焼いておいた写真群で、
 * APIキーが無い環境でも顔写真つきの画面を出せるようにするためのもの。
 * キーが無い → 壊れた画像アイコン、という状態を絶対に作らない。
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const PHOTO_DIR = path.join(PUBLIC_DIR, "personas");
const CACHE_DIR = path.join(PHOTO_DIR, "cache");
const POOL_DIR = path.join(PHOTO_DIR, "pool");

const EXT_OF = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MIME_OF = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

function ensureDirs() {
  for (const d of [PHOTO_DIR, CACHE_DIR, POOL_DIR]) fs.mkdirSync(d, { recursive: true });
}

/** モデルとサイズもキーに混ぜる。同じ文章でもモデルが違えば別の絵になるため。 */
function cacheKey(prompt, model, size) {
  return crypto
    .createHash("sha256")
    .update(`${model}|${size}|${prompt}`)
    .digest("hex")
    .slice(0, 20);
}

function findCached(key) {
  for (const ext of ["jpg", "png", "webp"]) {
    const file = path.join(CACHE_DIR, `${key}.${ext}`);
    if (fs.existsSync(file)) return { file, url: `/personas/cache/${key}.${ext}` };
  }
  return null;
}

function saveCached(key, base64, mimeType) {
  ensureDirs();
  const ext = EXT_OF[mimeType] || "png";
  const file = path.join(CACHE_DIR, `${key}.${ext}`);
  fs.writeFileSync(file, Buffer.from(base64, "base64"));
  return { file, url: `/personas/cache/${key}.${ext}` };
}

/* ===================== 事前生成プール =====================
   写真を先に用意しておき、ペルソナ側をそれに合わせて割り当てる経路。
   APIキーも課金も待ち時間も要らず、採用する顔を人の目で選び切れるので、
   プロトタイプや配布物ではこちらの方が実用的なことが多い。 */

const MANIFEST = path.join(POOL_DIR, "manifest.json");

/** プールの一覧。manifest.json があればそれを、無ければファイル名から推測する。 */
function loadPool() {
  if (!fs.existsSync(POOL_DIR)) return [];
  const files = fs
    .readdirSync(POOL_DIR)
    .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
    .sort();
  if (!files.length) return [];

  let manifest = null;
  if (fs.existsSync(MANIFEST)) {
    try {
      manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
    } catch (e) {
      console.warn("[pool] manifest.json を読めませんでした。ファイル名から推測します:", e.message);
    }
  }
  const byFile = new Map((manifest?.photos || []).map((p) => [p.file, p]));

  return files.map((file) => {
    const meta = byFile.get(file) || {};
    return {
      file,
      // manifest 未整備でも動くよう、ファイル名の接頭辞を保険にする
      gender: meta.gender || (/^female/i.test(file) ? "female" : "male"),
      age: Number(meta.age) || 22,
      // 志向 × 志望企業規模。用意された写真がこの軸で分類されているので割り当ての主軸になる。
      orientation: meta.orientation || "",
      companySize: meta.companySize || "",
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      note: meta.note || "",
    };
  });
}

function writeManifest(photos) {
  ensureDirs();
  fs.writeFileSync(MANIFEST, JSON.stringify({ version: 1, photos }, null, 2) + "\n", "utf8");
  return MANIFEST;
}

/**
 * ペルソナに一番合う写真を選ぶ。
 *
 * 単に順番に配ると、20歳の学生に40代の顔が付いたり、慎重な人物に満面の笑みが
 * 付いたりする。属性で採点して選び、同じセット内では使い回さない。
 *
 * @param {object} persona   gender / age と、表情・年齢帯のタグ
 * @param {number} index     決定的なばらしに使う
 * @param {Set<string>} used このセットで既に使ったファイル名
 */
function assignFromPool(persona, index, used = new Set(), hints = {}) {
  const pool = loadPool();
  if (!pool.length) return null;

  const wantGender = persona.gender === "female" ? "female" : "male";
  const wantAge = Number.parseInt(persona.age, 10) || 22;

  let best = null;
  let bestScore = -Infinity;

  for (const p of pool) {
    let score = 0;
    // 性別違いは事実上除外する。ただし候補が尽きたときの最後の砦としては残す。
    // "unknown"（取り込み時に判別できなかったもの）は軽い減点にとどめる。
    if (p.gender === "unknown") score -= 50;
    else if (p.gender !== wantGender) score -= 1000;

    /* セグメント（志向 × 志望企業規模）が割り当ての主軸。
       写真がこの分類で用意されているので、年齢や表情より強く効かせる。
       未分類の写真は「合わない」ではなく「情報がない」なので、
       不一致より軽い扱いにする。 */
    if (hints.orientation && p.orientation) {
      score += p.orientation === hints.orientation ? 120 : -90;
    }
    if (hints.companySize && p.companySize) {
      score += p.companySize === hints.companySize ? 120 : -90;
    }

    // 年齢は近いほど良い。1歳ごとに減点。
    score -= Math.abs(p.age - wantAge) * 3;
    // 表情・服装・背景のタグが合えば加点
    if (hints.expression && p.tags.includes(hints.expression)) score += 30;
    if (hints.wardrobe && p.tags.includes(hints.wardrobe)) score += 10;
    if (hints.scene && p.tags.includes(hints.scene)) score += 10;
    // セット内の使い回しは強く避ける（枚数が足りなければ結局使われる）
    if (used.has(p.file)) score -= 500;
    // 同点のときに全員が先頭の1枚に寄らないよう、決定的にずらす
    score += ((index * 7 + p.file.length) % 5) * 0.5;

    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  if (!best) return null;
  used.add(best.file);
  return {
    file: path.join(POOL_DIR, best.file),
    url: `/personas/pool/${best.file}`,
    entry: best,
    reused: bestScore <= -500,
  };
}

/** 旧シグネチャ。性別と通し番号だけで選ぶ簡易版。 */
function fromPool(gender, index) {
  return assignFromPool({ gender, age: 22 }, index);
}

/**
 * 未生成時のプレースホルダ。イニシャルを出すだけの SVG を data URL で返す。
 * <img> の壊れアイコンは出さない。
 */
function placeholder(name, gender) {
  const initial = String(name || "?").trim().slice(0, 1) || "?";
  const bg = gender === "female" ? "#efe6f2" : "#e3ebf5";
  const ink = gender === "female" ? "#8b6d97" : "#5b74a0";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">` +
    `<rect width="400" height="400" fill="${bg}"/>` +
    `<circle cx="200" cy="158" r="62" fill="${ink}" opacity=".28"/>` +
    `<path d="M76 400c0-72 56-118 124-118s124 46 124 118z" fill="${ink}" opacity=".28"/>` +
    `<text x="200" y="372" text-anchor="middle" font-family="sans-serif" font-size="30" ` +
    `fill="${ink}" opacity=".85">${escapeXml(initial)}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function contentTypeFor(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  return MIME_OF[ext] || "application/octet-stream";
}

module.exports = {
  ensureDirs,
  cacheKey,
  findCached,
  saveCached,
  loadPool,
  writeManifest,
  assignFromPool,
  fromPool,
  placeholder,
  contentTypeFor,
  MANIFEST,
  PUBLIC_DIR,
  PHOTO_DIR,
  CACHE_DIR,
  POOL_DIR,
};
