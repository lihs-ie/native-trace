import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import importPlugin from "eslint-plugin-import";

// オニオンアーキテクチャの依存方向（適応度関数）。
// 内側の層 (target) が外側の層 (from) を import したら違反。
// docs/03-detailed-design/detailed-design.md / infrastructure.md §2 を正とする。
const onionLayerZones = [
  // Domain は何にも依存しない
  { target: "./src/domain", from: "./src/usecase" },
  { target: "./src/domain", from: "./src/infrastructure" },
  { target: "./src/domain", from: "./src/acl" },
  { target: "./src/domain", from: "./src/app" },
  { target: "./src/domain", from: "./src/components" },
  // UseCase は Domain のみに依存（Port は UseCase 配下で定義）
  { target: "./src/usecase", from: "./src/infrastructure" },
  { target: "./src/usecase", from: "./src/acl" },
  { target: "./src/usecase", from: "./src/app" },
  { target: "./src/usecase", from: "./src/components" },
  // ACL / Infrastructure は互いに依存しない・Interface 層にも依存しない
  { target: "./src/acl", from: "./src/infrastructure" },
  { target: "./src/acl", from: "./src/app" },
  { target: "./src/infrastructure", from: "./src/acl" },
  { target: "./src/infrastructure", from: "./src/app" },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    plugins: { "architecture-import": importPlugin },
    rules: {
      "architecture-import/no-restricted-paths": ["error", { zones: onionLayerZones }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
