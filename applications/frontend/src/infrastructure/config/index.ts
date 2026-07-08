import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * DEFAULT_ANALYZER_ENDPOINT — Python analyzer の既定ベース URL。
 * 値の正は compose.yaml の analyzer サービス定義（port 8788）。
 * env ANALYZER_URL が指定されていればそちらが優先される。
 */
const DEFAULT_ANALYZER_ENDPOINT = "http://localhost:8788";

const configSchema = z.object({
  dbPath: z.string().min(1),
  audioStorageRoot: z.string().min(1),
  workerApiEndpoint: z.string().url(),
  /** infrastructure.md §11.1: Python analyzer (Kokoro TTS / analyze endpoint) のベース URL。 */
  analyzerApiEndpoint: z.string().url(),
  openaiApiKey: z.string().min(1),
  /**
   * acl.md §7.2: 音声入力と Structured Outputs に対応するモデル。
   * デフォルト: gpt-4o-audio-preview（2024 年時点で音声入力 + 構造化出力対応のモデル）。
   * 実行環境に合わせて OPENAI_ASSESSMENT_MODEL 環境変数で上書き可能。
   */
  openaiAssessmentModel: z.string().min(1).default("gpt-4o-audio-preview"),
  nodeEnv: z.enum(["development", "production", "test"]).default("development"),
  /** infrastructure.md §11.1: Runner tick 間隔 (ms)。デフォルト 2000ms。 */
  analysisJobPollIntervalMilliseconds: z.coerce.number().int().positive().default(2000),
  /** infrastructure.md §11.1: DB lease 期限 (ms)。worker 解析が数十秒〜分かかるためデフォルト 300000ms (ADR-001/004, #4)。 */
  analysisJobLeaseDurationMilliseconds: z.coerce.number().int().positive().default(300000),
  /** infrastructure.md §11.1: 最大 retry 回数。デフォルト 3 回。 */
  analysisJobMaxAttempts: z.coerce.number().int().positive().default(3),
  /**
   * infrastructure.md §11.1: OSS Worker 呼び出し timeout (ms)。
   * analyze は ~20s+ かかるため worker 側 (ANALYZER_TIMEOUT_SECONDS=120s) より長い 150s を既定にする。
   * env OSS_WORKER_TIMEOUT_MS で上書き可能。
   */
  ossWorkerTimeoutMilliseconds: z.coerce.number().int().positive().default(150000),

  // Training Context — OQ-1: sentinel LearnerIdentifier (fixed singleton for local MVP)
  // DD-293: Training Context の全テーブルの learner 列はこの単一値を常に取る
  /**
   * diagnosticSentinelLearnerIdentifier — ローカル MVP 固定学習者 ULID (OQ-1 解決)
   * ドメインに literal を埋め込まず config/定数モジュールに隔離する（DD-293）。
   */
  diagnosticSentinelLearnerIdentifier: z.string().min(1).default("01JWZLEARNER0000000000001"),

  // ADR-010: 優先度重み w1/w2/w3 と EWMA 係数 α は config 由来（DD-293）
  /** diagnosticFocusWeightW1 — FLランク重み（三項式第1項）。デフォルト 0.5 */
  diagnosticFocusWeightW1: z.coerce.number().min(0).max(10).default(0.5),
  /** diagnosticFocusWeightW2 — 出現頻度重み（三項式第2項）。デフォルト 0.3 */
  diagnosticFocusWeightW2: z.coerce.number().min(0).max(10).default(0.3),
  /** diagnosticFocusWeightW3 — (1−習熟度)重み（三項式第3項）。デフォルト 0.2 */
  diagnosticFocusWeightW3: z.coerce.number().min(0).max(10).default(0.2),
  /**
   * diagnosticGopRangeFloor — GOP 正規化下限（この値以下が mastery 0 に対応）。
   * Haskell worker の gopFloor = -20.0 に対応 (DD-293 config 隔離)。
   */
  diagnosticGopRangeFloor: z.coerce.number().max(-1).default(-20),
  /**
   * diagnosticGopRangeCeiling — GOP 正規化上限（この値以上が mastery 1 に対応）。
   * Haskell worker の gopCeiling = -2.0 に対応 (DD-293 config 隔離)。
   */
  diagnosticGopRangeCeiling: z.coerce.number().max(-0.01).default(-2),

  // ADR-011: SpacingScheduler 確定値 (REQ-127 由来固定値。ドメインに literal 埋め込み禁止)
  /** spacingIntervalHours — 次回提示までの間隔（24h）。REQ-127 由来。 */
  spacingIntervalHours: z.coerce.number().int().positive().default(24),
  /** masteryGateThreshold — 60% 正答率ゲート（0以上1以下）。REQ-127 由来。 */
  masteryGateThreshold: z.coerce.number().min(0).max(1).default(0.6),
  /** sessionCutoffMinutesMax — 1セッション最大分数（30分）。REQ-127 由来。 */
  sessionCutoffMinutesMax: z.coerce.number().int().positive().default(30),
  /** sessionCutoffMinutesMin — 1セッション最小分数（20分）。REQ-127 由来。 */
  sessionCutoffMinutesMin: z.coerce.number().int().positive().default(20),
  /** gateRetryIntervalHours — gate 状態での短間隔再提示時間（6h）。ADR-011 由来。 */
  gateRetryIntervalHours: z.coerce.number().int().positive().default(6),

  // REQ-123: 産出ドリル採点閾値 (DD-293 config 隔離)
  /**
   * drillGopSuccessThreshold — 産出ドリル GOP 成功閾値（負値スケール）。
   * worker の GOP は floor=-20, ceiling=-2 のスケール。
   * デフォルト: -8.0（中程度の発音で成功とみなす保守的閾値）。
   */
  drillGopSuccessThreshold: z.coerce.number().max(-1).default(-8),
  /**
   * drillMaxSeverityForSuccess — 産出ドリルの成功とみなす最大 severity。
   * "suggestion" | "minor" の産出問題は成功、"major" | "critical" は失敗。
   * デフォルト: "minor"。
   */
  drillMaxSeverityForSuccess: z.enum(["suggestion", "minor"]).default("minor"),

  // ADR-021: LLM coaching narrative (D6 config fields)
  /**
   * llmCoachingProvider — narrative 生成プロバイダ。
   * "rule-based"（既定）: 決定論ルールベース生成器を使う（挙動不変）。
   * "claude-code": claude -p subscription 経由で Claude を呼ぶ。
   * "ollama": ローカル Ollama を呼ぶ。
   */
  llmCoachingProvider: z.enum(["claude-code", "ollama", "rule-based"]).default("rule-based"),
  /** ollamaEndpoint — Ollama API ベース URL。デフォルト "http://localhost:11434"。 */
  ollamaEndpoint: z.string().url().default("http://localhost:11434"),
  /** ollamaModel — Ollama で使うモデル名。デフォルト "llama3.1:8b"。 */
  ollamaModel: z.string().min(1).default("llama3.1:8b"),
  /** claudeCodeExecutablePath — claude CLI の実行パス。デフォルト "claude"（PATH 解決）。 */
  claudeCodeExecutablePath: z.string().min(1).default("claude"),
  /** claudeCodeModel — claude -p に渡すモデル名。デフォルト "sonnet"。 */
  claudeCodeModel: z.string().min(1).default("sonnet"),
  /**
   * llmNarrativeTimeoutMilliseconds — LLM 呼び出し timeout (ms)。
   * 既定 60000ms（ADR-023。実測 ~40s/call に対応）。
   * env LLM_NARRATIVE_TIMEOUT_MS でオーバーライド可能（変更不可の不変条件は M-TMO-4 参照）。
   */
  llmNarrativeTimeoutMilliseconds: z.coerce.number().int().positive().default(60000),
  /** llmNarrativePromptVersion — system/user prompt のバージョン文字列。デフォルト "v1"。 */
  llmNarrativePromptVersion: z.string().min(1).default("v1"),
  /**
   * llmNarrativeMaxConcurrency — pre-loop batch 並列度上限。デフォルト 3。
   * run-assessment-job がこの値を使い Promise.all チャンクサイズを制御する。
   */
  llmNarrativeMaxConcurrency: z.coerce.number().int().positive().default(3),
  /**
   * llmNarrativeMaxFindings — LLM 生成対象 finding 数上限。既定 8。
   * severity 降順 → functionalLoad（max > high > mid > low）降順の上位 N 件を LLM 対象に選択する。
   * 上限外 finding は rule-based パスへ落ちる。
   *
   * 不変条件（ADR-023 D2 運用注記）:
   *   ceil(llmNarrativeMaxFindings / llmNarrativeMaxConcurrency) × llmNarrativeTimeoutMilliseconds
   *   < analysisJobLeaseDurationMilliseconds
   * 既定値では: ceil(8/3) × 60000 = 180000 < 300000 ✓
   * env override で不変条件を破らないよう注意（破れた場合の保証はない）。
   */
  llmNarrativeMaxFindings: z.coerce.number().int().positive().default(8),
});

export type AppConfig = z.infer<typeof configSchema>;

const analyzerConfigSchema = z.object({
  analyzerApiEndpoint: z.string().url(),
});

export type AnalyzerConfig = z.infer<typeof analyzerConfigSchema>;

/**
 * createAnalyzerConfig — TTS プロキシ route 専用の軽量 config。
 * openaiApiKey 等の他フィールドに依存せず analyzer endpoint だけを解決する。
 * process.env は infrastructure/config 以外で参照禁止 (ast-grep ルール)。
 */
export const createAnalyzerConfig = (): AnalyzerConfig => {
  const result = analyzerConfigSchema.safeParse({
    analyzerApiEndpoint: process.env.ANALYZER_URL ?? DEFAULT_ANALYZER_ENDPOINT,
  });
  if (!result.success) {
    throw new Error(`analyzer 設定が不正です: ${result.error.message}`);
  }
  return result.data;
};

/**
 * isNodejsRuntime — Next.js runtime 判定。
 * infrastructure.md §6.1: Edge runtime では DB adaptor を起動しない。
 * process.env は infrastructure/config 以外で参照禁止 (ast-grep ルール)。
 */
export const isNodejsRuntime = (): boolean => process.env.NEXT_RUNTIME === "nodejs";

export const createConfig = (): AppConfig => {
  const result = configSchema.safeParse({
    dbPath: process.env.DB_PATH ?? "./data/native-trace.db",
    audioStorageRoot: process.env.AUDIO_STORAGE_ROOT ?? "./data/audio",
    workerApiEndpoint: process.env.WORKER_API_ENDPOINT ?? "http://localhost:8787",
    analyzerApiEndpoint: process.env.ANALYZER_URL ?? DEFAULT_ANALYZER_ENDPOINT,
    openaiApiKey: process.env.OPENAI_API_KEY ?? "",
    openaiAssessmentModel: process.env.OPENAI_ASSESSMENT_MODEL ?? "gpt-4o-audio-preview",
    nodeEnv: process.env.NODE_ENV ?? "development",
    analysisJobPollIntervalMilliseconds: process.env.ANALYSIS_JOB_POLL_INTERVAL_MS,
    analysisJobLeaseDurationMilliseconds: process.env.ANALYSIS_JOB_LEASE_DURATION_MS,
    analysisJobMaxAttempts: process.env.ANALYSIS_JOB_MAX_ATTEMPTS,
    ossWorkerTimeoutMilliseconds: process.env.OSS_WORKER_TIMEOUT_MS,
    diagnosticSentinelLearnerIdentifier: process.env.DIAGNOSTIC_SENTINEL_LEARNER_IDENTIFIER,
    diagnosticFocusWeightW1: process.env.DIAGNOSTIC_FOCUS_WEIGHT_W1,
    diagnosticFocusWeightW2: process.env.DIAGNOSTIC_FOCUS_WEIGHT_W2,
    diagnosticFocusWeightW3: process.env.DIAGNOSTIC_FOCUS_WEIGHT_W3,
    diagnosticGopRangeFloor: process.env.DIAGNOSTIC_GOP_RANGE_FLOOR,
    diagnosticGopRangeCeiling: process.env.DIAGNOSTIC_GOP_RANGE_CEILING,
    spacingIntervalHours: process.env.SPACING_INTERVAL_HOURS,
    masteryGateThreshold: process.env.MASTERY_GATE_THRESHOLD,
    sessionCutoffMinutesMax: process.env.SESSION_CUTOFF_MINUTES_MAX,
    sessionCutoffMinutesMin: process.env.SESSION_CUTOFF_MINUTES_MIN,
    gateRetryIntervalHours: process.env.GATE_RETRY_INTERVAL_HOURS,
    drillGopSuccessThreshold: process.env.DRILL_GOP_SUCCESS_THRESHOLD,
    drillMaxSeverityForSuccess: process.env.DRILL_MAX_SEVERITY_FOR_SUCCESS,
    llmCoachingProvider: process.env.LLM_COACHING_PROVIDER,
    ollamaEndpoint: process.env.OLLAMA_ENDPOINT,
    ollamaModel: process.env.OLLAMA_MODEL,
    claudeCodeExecutablePath: process.env.CLAUDE_CODE_PATH,
    claudeCodeModel: process.env.CLAUDE_CODE_MODEL,
    llmNarrativeTimeoutMilliseconds: process.env.LLM_NARRATIVE_TIMEOUT_MS,
    llmNarrativePromptVersion: process.env.LLM_NARRATIVE_PROMPT_VERSION,
    llmNarrativeMaxConcurrency: process.env.LLM_NARRATIVE_MAX_CONCURRENCY,
    llmNarrativeMaxFindings: process.env.LLM_NARRATIVE_MAX_FINDINGS,
  });

  if (!result.success) {
    throw new Error(`設定が不正です: ${result.error.message}`);
  }
  return result.data;
};

/**
 * buildClaudeCodeChildEnv — builds the child process environment for claude -p.
 *
 * Returns a copy of process.env with ANTHROPIC_API_KEY removed.
 * Rationale: claude subscription auth uses keychain/OAuth; passing ANTHROPIC_API_KEY
 * redirects to the metered API route (M-LLM-6 Non-goal, ADR-021 D3).
 *
 * process.env is ONLY read here, inside infrastructure/config (ast-grep rule enforces this).
 * The ACL layer (claude-code-narrative-invoker.ts) receives this as the `childEnv` dep.
 */
export const buildClaudeCodeChildEnv = (): NodeJS.ProcessEnv => {
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  delete childEnv["ANTHROPIC_API_KEY"];
  return childEnv;
};

/**
 * isClaudeCodeAvailable — synchronous check that the claude executable is resolvable.
 *
 * Used by registry.ts for M-LLM-7 downgrade logic.
 * Returns false when:
 *   - The path is absolute and the file does not exist or is not executable.
 *   - The path is a bare name (e.g. "claude") and cannot be found on PATH.
 *
 * Rationale for PRIMARY gate being executable-not-resolvable:
 *   In Docker environments without claude installed, the executable will simply not be
 *   on the PATH — no special container signal is needed. This covers Docker-without-claude
 *   as a special case of "claude not resolvable".
 *
 * process.env.PATH is read here (config layer), not in the ACL.
 */
export const isClaudeCodeAvailable = (claudeExecutablePath: string): boolean => {
  try {
    if (path.isAbsolute(claudeExecutablePath)) {
      fs.accessSync(claudeExecutablePath, fs.constants.X_OK);
      return true;
    }

    // Bare name: resolve against PATH entries
    const pathEnv = process.env.PATH ?? "";
    const pathDirectories = pathEnv.split(path.delimiter).filter(Boolean);
    for (const directory of pathDirectories) {
      const candidate = path.join(directory, claudeExecutablePath);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return true;
      } catch {
        // Not found in this directory; try next
      }
    }
    return false;
  } catch {
    return false;
  }
};
