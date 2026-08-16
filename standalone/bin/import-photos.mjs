#!/usr/bin/env node
/**
 * 手持ちの顔写真をプールに取り込む。
 *
 * 「都度APIで生成する」のではなく「先に写真を入れておき、ペルソナ側をそれに
 * 合わせて割り当てる」経路のための取り込み口。APIキーも課金も待ち時間も要らず、
 * 採用する顔を人の目で選び切れるので、プロトタイプや配布物ではこちらが実用的。
 *
 *   # 個別ファイルを取り込む
 *   node standalone/bin/import-photos.mjs ~/faces/*.jpg
 *
 *   # 性別・年齢・タグを付けて取り込む（割り当ての精度が上がる）
 *   node standalone/bin/import-photos.mjs --gender female --age 22 --tag gentle ~/faces/f*.jpg
 *
 *   # 取り込み済みの一覧を見る
 *   node standalone/bin/import-photos.mjs --list
 *
 *   # ファイル名から manifest を作り直す
 *   node standalone/bin/import-photos.mjs --rebuild
 *
 * 1枚の連結画像（コンタクトシート）を分割して取り込みたい場合は、
 * サーバーを起動して http://localhost:8787/photos.html を使ってください。
 * ブラウザの canvas で切り出すので、追加のパッケージが要りません。
 *
 * オプション:
 *   --gender male|female   指定しない場合はファイル名から推測（male/female/男/女）
 *   --orientation growth|stability   志向（成長志向 / 安定志向）
 *   --size large|venture|small       志望企業規模（大手 / ベンチャー / 中小）
 *   --age N                既定 22
 *   --tag <t>              複数指定可。表情（serious/evaluating/bright/hesitant/
 *                          gentle/tired/calm）や recruit/casual/student/office など
 *   --out <dir>            既定 standalone/public/personas/pool
 *   --list                 取り込み済みの一覧を表示して終了
 *   --rebuild              既存ファイルから manifest.json を作り直す
 *   --clear                プールを空にする（確認あり）
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = path.join(HERE, "..", "public", "personas", "pool");

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const optAll = (n) => {
  const out = [];
  argv.forEach((a, i) => { if (a === `--${n}` && argv[i + 1]) out.push(argv[i + 1]); });
  return out;
};

const outDir = path.resolve(opt("out", DEFAULT_OUT));
const manifestPath = path.join(outDir, "manifest.json");
const IMAGE_RE = /\.(jpe?g|png|webp)$/i;

/* --gender などのフラグ値そのものが入力ファイル扱いにならないよう除外する */
const FLAG_VALUES = new Set([
  opt("gender", ""), opt("age", ""), opt("out", ""),
  opt("orientation", ""), opt("size", ""), ...optAll("tag"),
]);
const inputs = argv.filter(
  (a) => !a.startsWith("--") && !FLAG_VALUES.has(a) && IMAGE_RE.test(a),
);

function readManifest() {
  if (!fs.existsSync(manifestPath)) return { version: 1, photos: [] };
  try {
    const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return { version: 1, photos: Array.isArray(m.photos) ? m.photos : [] };
  } catch (e) {
    console.warn(`manifest.json を読めませんでした（${e.message}）。作り直します。`);
    return { version: 1, photos: [] };
  }
}

function writeManifest(m) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + "\n", "utf8");
}

function guessGender(name) {
  const n = name.toLowerCase();
  if (/female|woman|women|girl|女|_f[-_.]|^f[-_]/.test(n)) return "female";
  if (/male|man|men|boy|男|_m[-_.]|^m[-_]/.test(n)) return "male";
  return "unknown";
}

function listPool() {
  if (!fs.existsSync(outDir)) return [];
  const files = fs.readdirSync(outDir).filter((f) => IMAGE_RE.test(f)).sort();
  const byFile = new Map(readManifest().photos.map((p) => [p.file, p]));
  return files.map((f) => ({ file: f, ...(byFile.get(f) || { gender: guessGender(f), age: 22, tags: [] }) }));
}

function printList() {
  const rows = listPool();
  if (!rows.length) {
    console.log("プールは空です。");
    console.log(`  取り込む: node standalone/bin/import-photos.mjs <画像ファイル…>`);
    return;
  }
  const w = Math.max(...rows.map((r) => r.file.length));
  console.log(`プール: ${outDir}\n`);
  for (const r of rows) {
    console.log(
      `  ${r.file.padEnd(w)}  ${String(r.gender).padEnd(7)}  ${String(r.age).padStart(2)}歳  ` +
        `${[r.orientation, r.companySize].filter(Boolean).join("/").padEnd(18)}  ${(r.tags || []).join(",")}`,
    );
  }
  const f = rows.filter((r) => r.gender === "female").length;
  const m = rows.filter((r) => r.gender === "male").length;
  console.log(`\n  計 ${rows.length}枚（男性 ${m} / 女性 ${f} / 未設定 ${rows.length - m - f}）`);
  if (rows.length - m - f) {
    console.log("  未設定の写真は割り当て精度が落ちます。--gender を付けて取り込み直すか、");
    console.log(`  ${path.relative(process.cwd(), manifestPath)} を直接編集してください。`);
  }
}

function main() {
  if (flag("list")) return printList();

  if (flag("clear")) {
    if (!flag("yes")) {
      console.error("プール内の画像と manifest.json を削除します。実行するには --yes を付けてください。");
      process.exit(1);
    }
    if (fs.existsSync(outDir)) {
      for (const f of fs.readdirSync(outDir)) {
        if (IMAGE_RE.test(f) || f === "manifest.json") fs.unlinkSync(path.join(outDir, f));
      }
    }
    console.log("プールを空にしました。");
    return;
  }

  if (flag("rebuild")) {
    const photos = listPool().map((r) => ({
      file: r.file, gender: r.gender, age: r.age || 22,
      orientation: r.orientation || "", companySize: r.companySize || "",
      tags: r.tags || [], note: r.note || "",
    }));
    writeManifest({ version: 1, photos });
    console.log(`manifest.json を ${photos.length}件で作り直しました。`);
    return printList();
  }

  if (!inputs.length) {
    console.error("取り込む画像ファイルを指定してください（.jpg / .png / .webp）。");
    console.error("  例: node standalone/bin/import-photos.mjs ~/faces/*.jpg");
    console.error("  1枚の連結画像を分割したい場合は http://localhost:8787/photos.html を使ってください。");
    process.exit(1);
  }

  const forcedGender = opt("gender", "");
  const age = Number(opt("age", 22)) || 22;
  const tags = optAll("tag");
  const orientation = ["growth", "stability"].includes(opt("orientation", "")) ? opt("orientation", "") : "";
  const companySize = ["large", "venture", "small"].includes(opt("size", "")) ? opt("size", "") : "";

  fs.mkdirSync(outDir, { recursive: true });
  const manifest = readManifest();
  const existing = new Set(manifest.photos.map((p) => p.file));
  let added = 0;

  for (const input of inputs) {
    const src = path.resolve(input);
    if (!fs.existsSync(src)) { console.warn(`skip  ${input}（見つかりません）`); continue; }

    const gender = forcedGender || guessGender(path.basename(src));
    const ext = path.extname(src).toLowerCase().replace(".jpeg", ".jpg");

    // 連番はプール内で衝突しないところまで進める。
    // ファイル名にセグメントを入れておくと manifest が無くても分類が分かる。
    const prefix = [orientation, companySize, gender].filter(Boolean).join("-");
    let seq = 1;
    let name;
    do {
      name = `${prefix}-${String(seq).padStart(2, "0")}${ext}`;
      seq++;
    } while (fs.existsSync(path.join(outDir, name)) || existing.has(name));

    fs.copyFileSync(src, path.join(outDir, name));
    manifest.photos.push({ file: name, gender, age, orientation, companySize, tags, note: path.basename(src) });
    existing.add(name);
    added++;
    const seg = [orientation, companySize].filter(Boolean).join("/");
    console.log(`add   ${path.basename(src)} → ${name}（${gender} / ${age}歳${seg ? " / " + seg : ""}${tags.length ? " / " + tags.join(",") : ""}）`);
  }

  writeManifest(manifest);
  console.log(`\n${added}枚を取り込みました → ${path.relative(process.cwd(), outDir)}`);
  console.log("サーバーを起動すると、プールの写真が自動で使われます（APIキー不要）。");
  if (!forcedGender && manifest.photos.some((p) => p.gender === "unknown")) {
    console.log("\n性別を推測できなかった写真があります。--gender を付けて取り込み直すか、");
    console.log("http://localhost:8787/photos.html で画面から設定してください。");
  }
}

main();
