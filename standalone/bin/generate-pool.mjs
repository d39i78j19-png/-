#!/usr/bin/env node
/**
 * 顔写真プールの一括生成。
 *
 * サーバーは要求されたときに1枚ずつ生成するが、デモや配布のたびに API を
 * 叩くのは待ち時間も費用も無駄になる。あらかじめここで焼いておくと、
 * GEMINI_API_KEY が無い環境でも顔写真つきの画面をそのまま見せられる。
 *
 *   # 課金前に必ずプロンプトを確認する（APIを叩かない）
 *   node standalone/bin/generate-pool.mjs --dry-run
 *
 *   # 1枚だけ試して作風を確かめる
 *   node standalone/bin/generate-pool.mjs --only male-01
 *
 *   # 12枚まとめて焼く
 *   node standalone/bin/generate-pool.mjs --count 12
 *
 *   # 自前のペルソナ定義から焼く
 *   node standalone/bin/generate-pool.mjs --personas ./my-personas.json
 *
 * オプション:
 *   --dry-run          プロンプトと概算費用だけ出す
 *   --count N          生成枚数（既定 12・男女半々）
 *   --only <id>        1件だけ生成
 *   --personas <file>  ペルソナ定義JSON（配列 or {personas:[...]}）
 *   --out <dir>        出力先（既定 standalone/public/personas/pool）
 *   --model <id>       既定 gemini-3-pro-image
 *   --size <s>         512 / 1K / 2K / 4K（既定 2K）
 *   --wardrobe <m>     auto（リクルートスーツ）/ casual（私服）
 *   --scene <s>        student / office
 *   --anchor <file>    同一人物の別カットを作るときの参照画像
 *   --force            既存ファイルがあっても作り直す
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import promptLib from "../lib/portrait-prompt.js";
import geminiLib from "../lib/gemini-image.js";

const { buildPortraitPrompt } = promptLib;
const { generateImage, estimateCost, DEFAULT_MODEL } = geminiLib;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = path.join(HERE, "..", "public", "personas", "pool");

/* ---------- 引数 ---------- */
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const dryRun = flag("dry-run");
const force = flag("force");
const count = Number(opt("count", 12));
const only = opt("only", "");
const outDir = path.resolve(opt("out", DEFAULT_OUT));
const model = opt("model", DEFAULT_MODEL);
const size = opt("size", "2K");
const wardrobe = opt("wardrobe", "auto");
const scene = opt("scene", "student");
const anchorFile = opt("anchor", "");
const personasFile = opt("personas", "");

/* ---------- プールの既定ペルソナ ----------
   プールは「誰でもない平均顔」を12枚並べるためのものではない。ここでも属性を
   散らしておかないと、UIに並べたとき同じ人が複数いるように見える。 */
const POOL_TRAITS = [
  { personality: "論理的に比較してから決めたい。データで納得したい", info_channels: ["逆求人型スカウトサイト"] },
  { personality: "面倒見が良く、チームで動くのが好き", info_channels: ["大学のキャリアセンター"] },
  { personality: "挑戦したい。海外やインターンに関心がある", info_channels: ["SNS（X）"] },
  { personality: "安定を重視。転勤や配属が不安", info_channels: ["就活ナビサイト"] },
  { personality: "研究に打ち込んできた。ゼミの論文が中心", info_channels: ["研究室の先輩"] },
  { personality: "体育会で続けてきた。泥臭くやり抜く", info_channels: ["合同説明会"] },
];

function defaultPersonas(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const gender = i % 2 === 0 ? "male" : "female";
    const seq = String(Math.floor(i / 2) + 1).padStart(2, "0");
    const trait = POOL_TRAITS[i % POOL_TRAITS.length];
    out.push({
      id: `${gender}-${seq}`,
      name: `${gender === "male" ? "男性" : "女性"}${seq}`,
      gender,
      age: 21 + (i % 3),
      personality: trait.personality,
      info_channels: trait.info_channels,
      values: [], orientation: [], job_axis: [], pain_points: [],
    });
  }
  return out;
}

function loadPersonas() {
  if (!personasFile) return defaultPersonas(count);
  const raw = JSON.parse(fs.readFileSync(path.resolve(personasFile), "utf8"));
  const list = Array.isArray(raw) ? raw : raw.personas || [];
  if (!list.length) throw new Error(`${personasFile} にペルソナがありません`);
  return list.map((p, i) => ({ ...p, id: p.id || `${p.gender === "female" ? "female" : "male"}-${String(i + 1).padStart(2, "0")}` }));
}

/* ---------- 実行 ---------- */

async function main() {
  let personas = loadPersonas();
  if (only) {
    personas = personas.filter((p) => p.id === only);
    if (!personas.length) throw new Error(`--only ${only} に一致するペルソナがありません`);
  }

  const anchor = anchorFile
    ? {
        data: fs.readFileSync(path.resolve(anchorFile)).toString("base64"),
        mimeType: anchorFile.endsWith(".png") ? "image/png" : "image/jpeg",
      }
    : null;

  const built = personas.map((p, i) => ({
    persona: p,
    ...buildPortraitPrompt(p, i, { wardrobe, scene, hasReference: Boolean(anchor) }),
  }));

  if (dryRun) {
    for (const b of built) {
      console.log(`\n─────────── ${b.persona.id}（${b.persona.gender} / ${b.persona.age}歳）`);
      console.log(`設計意図: ${b.variable.rationale}`);
      console.log(`表情: ${b.variable.expression} ／ 視線: ${b.variable.gaze}`);
      console.log(`\n${b.prompt}\n`);
    }
    const cost = estimateCost(model, size, built.length);
    console.log("═".repeat(70));
    console.log(`${built.length}枚 × ${model} / ${size} ＝ 概算 $${cost.toFixed(2)}`);
    console.log("画像モデルに無料枠はありません（課金アカウントが必要です）。");
    console.log("問題なければ --dry-run を外して実行してください。");
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY が設定されていません。");
    console.error('  export GEMINI_API_KEY="..." を実行してから再度お試しください。');
    console.error("  プロンプトだけ確認する場合は --dry-run を付けてください。");
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });
  let ok = 0;
  let skipped = 0;
  const failed = [];

  for (const b of built) {
    const dest = path.join(outDir, `${b.persona.id}.jpg`);
    if (!force && fs.existsSync(dest)) {
      console.log(`skip  ${b.persona.id}（既に存在。作り直すなら --force）`);
      skipped++;
      continue;
    }
    process.stdout.write(`gen   ${b.persona.id} … `);
    try {
      const img = await generateImage({
        prompt: b.prompt,
        apiKey: process.env.GEMINI_API_KEY,
        model, size, aspect: "1:1",
        reference: anchor,
      });
      const ext = img.mimeType === "image/png" ? "png" : "jpg";
      const file = path.join(outDir, `${b.persona.id}.${ext}`);
      fs.writeFileSync(file, Buffer.from(img.data, "base64"));
      console.log(`OK → ${path.relative(process.cwd(), file)}`);
      ok++;
    } catch (e) {
      console.log(`失敗: ${e.message}`);
      failed.push(b.persona.id);
    }
  }

  console.log("\n" + "═".repeat(70));
  console.log(`成功 ${ok} / スキップ ${skipped} / 失敗 ${failed.length}`);
  if (failed.length) console.log(`失敗した分だけ作り直す: --only ${failed[0]}`);
  if (ok) {
    console.log("\n生成した画像は必ず目視で確認してください。API が返した＝使える、ではありません。");
    console.log("よくあるズレと直し方は standalone/README.md を参照。");
  }
}

main().catch((e) => {
  console.error("\n" + e.message);
  process.exit(1);
});
