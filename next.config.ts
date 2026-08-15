import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Electron から子プロセスとして起動できる自己完結サーバーを出力する。
  // .next/standalone/server.js だけで動くので、配布物に node_modules 全体を
  // 同梱せずに済む。
  output: "standalone",
};

export default nextConfig;
