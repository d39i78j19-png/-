/**
 * `next build` が出力する .next/standalone を「単体で起動できる状態」に仕上げる。
 *
 * Next.js は standalone に server.js と最小限の node_modules しか置かず、
 * 静的アセット（.next/static）と public/ は自分でコピーする前提になっている。
 * これを忘れると起動はするが CSS と画像が 404 になるので、ビルド手順に組み込む。
 */

import { cp, access, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");

async function main() {
  if (!existsSync(standalone)) {
    console.error(
      "[prepare-standalone] .next/standalone がありません。先に `npm run build` を実行してください。",
    );
    process.exit(1);
  }

  // 静的アセット: .next/static -> .next/standalone/.next/static
  const staticSrc = path.join(root, ".next", "static");
  const staticDest = path.join(standalone, ".next", "static");
  await mkdir(path.dirname(staticDest), { recursive: true });
  await cp(staticSrc, staticDest, { recursive: true });
  console.log("[prepare-standalone] copied .next/static");

  // public/ は存在する場合のみ
  const publicSrc = path.join(root, "public");
  try {
    await access(publicSrc);
    await cp(publicSrc, path.join(standalone, "public"), { recursive: true });
    console.log("[prepare-standalone] copied public/");
  } catch {
    console.log("[prepare-standalone] public/ なし（スキップ）");
  }

  console.log("[prepare-standalone] done:", standalone);
}

main().catch((error) => {
  console.error("[prepare-standalone] failed:", error);
  process.exit(1);
});
