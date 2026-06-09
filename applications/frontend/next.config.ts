import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // monorepo root (suppresses stray-lockfile root inference)
    root: path.join(__dirname, "..", ".."),
  },
};

export default nextConfig;
