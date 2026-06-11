import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // monorepo root (suppresses stray-lockfile root inference)
    root: path.join(__dirname, "..", ".."),
  },
  // better-sqlite3 は native addon。Turbopack/webpack でバンドルせず
  // 実行時に node_modules から require する外部パッケージとして扱う
  // （これが無いと dev で "Module not found: better-sqlite3" になる）。
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
