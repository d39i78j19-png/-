/**
 * ブラウザ完結デモ（単一 HTML）をビルドする。
 *
 * 本番の UI コード（src/app/page.tsx と src/components/*）をそのまま束ね、
 * API 呼び出しだけ src/demo/apiShim.ts のルールベース実装に差し替える。
 * CSS は `next build` が出力した Tailwind コンパイル済みのものを取り込むので、
 * 実行前に `npm run build` を済ませておくこと。
 *
 * 出力: dist-web/index.html（外部リソース参照なしの1ファイル）
 */

import { build } from "esbuild";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "dist-web");

/** next build が出した CSS を集める（Tailwind の @import が解決済みのもの）。 */
async function collectCss() {
  const chunkDir = join(root, ".next", "static", "chunks");
  let files;
  try {
    files = await readdir(chunkDir);
  } catch {
    throw new Error(
      ".next/static/chunks が見つかりません。先に `npm run build` を実行してください。",
    );
  }
  const cssFiles = files.filter((f) => f.endsWith(".css"));
  if (cssFiles.length === 0) {
    throw new Error("コンパイル済み CSS が見つかりません。`npm run build` を実行してください。");
  }
  const parts = await Promise.all(
    cssFiles.map((f) => readFile(join(chunkDir, f), "utf-8")),
  );
  return parts.join("\n");
}

const result = await build({
  entryPoints: [join(root, "src", "demo", "main.tsx")],
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2020"],
  jsx: "automatic",
  platform: "browser",
  // 日本語リテラルを \u エスケープして出す。配信側の charset 設定に依存しなくなる
  charset: "ascii",
  define: { "process.env.NODE_ENV": '"production"' },
  tsconfig: join(root, "tsconfig.json"),
  write: false,
});

const js = result.outputFiles[0].text;
const css = await collectCss();

// Artifact 側で <!doctype>/<head>/<body> が付くため、ここでは中身だけを書く
const html = `<meta charset="utf-8" />
<title>新卒採用ペルソナ設計スタジオ</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
${css}
</style>
<div id="root"></div>
<script>
${js}
</script>
`;

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "index.html"), html, "utf-8");

const kb = (n) => `${Math.round(n / 1024)}KB`;
console.log(
  `dist-web/index.html を書き出しました（JS ${kb(js.length)} / CSS ${kb(css.length)}）`,
);
