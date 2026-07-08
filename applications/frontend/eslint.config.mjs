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

  // W54: UseCase は UI DTO モジュール (lib) を import しない
  // （lib/api-types は AcousticEvidenceDraft の type-only re-export で usecase を参照する — 逆方向は可）。
  // components は ACL を import しない（ワイヤ型は lib/api-types 経由で参照する）。
  { target: "./src/usecase", from: "./src/lib" },
  { target: "./src/components", from: "./src/acl" },

  // Training Context (TC) 境界 — ADR-007: TC domain が PPC 内部型を import しない。
  // PPC (Pronunciation Practice Context) = domain/{assessment-result,section,section-series,
  // material,recording-attempt,analysis-run,analysis-job,audio-file}
  // TC domain は PPC の識別子型 (AssessmentResultIdentifier / SectionIdentifier) のみを
  // import し、PPC 集約の内部型 (AssessmentResult 等の集約本体) を import しない。
  // これは ESLint no-restricted-paths で集約ファイルを制限する形で表現する。
  // domain/training が domain/assessment-result.ts の集約本体を import しないことを検査:
  // (識別子型は import 可——同じファイルに識別子と集約が共存するため完全排除は不可。
  //  識別子のみ使用はコードレビューと ast-grep で補完する)

  // TC usecase が TC infrastructure を import しない（onion 順守）
  { target: "./src/domain/training", from: "./src/infrastructure" },
  { target: "./src/domain/training", from: "./src/usecase" },
  { target: "./src/domain/training", from: "./src/acl" },
  { target: "./src/domain/training", from: "./src/app" },
  { target: "./src/domain/training", from: "./src/components" },
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
      // `_` プレフィックスは「意図的に未使用」を示す慣習。型のためだけに残す引数や
      // catch 句を許容する（Port 実装の fake シグネチャ等で使う）。
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  // テストファイルはオニオン層間制約を免除する。
  // テストは src/test/, *.test.ts(x) に限定されており、本番コードではない。
  // 統合テストが acl 実装を直接 inject するケース (e.g. createRuleBasedImprovementMessageGenerator)
  // を許容する必要があるため、アーキテクチャ import 制約から除外する。
  {
    files: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/test/**/*.ts"],
    rules: {
      "architecture-import/no-restricted-paths": "off",
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
    "design-reference/**",
  ]),
]);

export default eslintConfig;
