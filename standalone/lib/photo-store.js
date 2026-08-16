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

/**
 * 事前生成プールから1枚割り当てる。
 * ファイル名の規約: `<gender>-NN.jpg`（例 male-01.jpg / female-03.jpg）。
 * 性別が合うものを優先し、無ければ全体から拾う。index で回して重複を避ける。
 */
function fromPool(gender, index) {
  if (!fs.existsSync(POOL_DIR)) return null;
  const all = fs
    .readdirSync(POOL_DIR)
    .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
    .sort();
  if (!all.length) return null;

  const want = gender === "female" ? "female" : "male";
  const matched = all.filter((f) => f.toLowerCase().startsWith(want));
  const list = matched.length ? matched : all;
  const name = list[index % list.length];
  return { file: path.join(POOL_DIR, name), url: `/personas/pool/${name}` };
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
  fromPool,
  placeholder,
  contentTypeFor,
  PUBLIC_DIR,
  PHOTO_DIR,
  CACHE_DIR,
  POOL_DIR,
};
