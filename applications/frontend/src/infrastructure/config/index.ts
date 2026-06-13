import { z } from "zod";

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
  /** infrastructure.md §11.1: OSS Worker 呼び出し timeout (ms)。デフォルト 30000ms。 */
  ossWorkerTimeoutMilliseconds: z.coerce.number().int().positive().default(30000),
  /** infrastructure.md §11.1: ローカル音声保存上限 bytes。デフォルト 100MiB。 */
  localAudioMaxBytes: z.coerce.number().int().positive().default(104857600),
  /** infrastructure.md §11.1: OpenAI raw response 保存上限 bytes。デフォルト 1MiB。 */
  openaiRawResponseMaxBytes: z.coerce.number().int().positive().default(1048576),

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
  /** diagnosticFocusAlpha — EWMA 平滑化係数（0〜1）。デフォルト 0.3 */
  diagnosticFocusAlpha: z.coerce.number().min(0).max(1).default(0.3),
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
    analyzerApiEndpoint: process.env.ANALYZER_URL ?? "http://localhost:8788",
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
    analyzerApiEndpoint: process.env.ANALYZER_URL ?? "http://localhost:8788",
    openaiApiKey: process.env.OPENAI_API_KEY ?? "",
    openaiAssessmentModel: process.env.OPENAI_ASSESSMENT_MODEL ?? "gpt-4o-audio-preview",
    nodeEnv: process.env.NODE_ENV ?? "development",
    analysisJobPollIntervalMilliseconds: process.env.ANALYSIS_JOB_POLL_INTERVAL_MS,
    analysisJobLeaseDurationMilliseconds: process.env.ANALYSIS_JOB_LEASE_DURATION_MS,
    analysisJobMaxAttempts: process.env.ANALYSIS_JOB_MAX_ATTEMPTS,
    ossWorkerTimeoutMilliseconds: process.env.OSS_WORKER_TIMEOUT_MS,
    localAudioMaxBytes: process.env.LOCAL_AUDIO_MAX_BYTES,
    openaiRawResponseMaxBytes: process.env.OPENAI_RAW_RESPONSE_MAX_BYTES,
    diagnosticSentinelLearnerIdentifier: process.env.DIAGNOSTIC_SENTINEL_LEARNER_IDENTIFIER,
    diagnosticFocusWeightW1: process.env.DIAGNOSTIC_FOCUS_WEIGHT_W1,
    diagnosticFocusWeightW2: process.env.DIAGNOSTIC_FOCUS_WEIGHT_W2,
    diagnosticFocusWeightW3: process.env.DIAGNOSTIC_FOCUS_WEIGHT_W3,
    diagnosticFocusAlpha: process.env.DIAGNOSTIC_FOCUS_ALPHA,
    diagnosticGopRangeFloor: process.env.DIAGNOSTIC_GOP_RANGE_FLOOR,
    diagnosticGopRangeCeiling: process.env.DIAGNOSTIC_GOP_RANGE_CEILING,
    spacingIntervalHours: process.env.SPACING_INTERVAL_HOURS,
    masteryGateThreshold: process.env.MASTERY_GATE_THRESHOLD,
    sessionCutoffMinutesMax: process.env.SESSION_CUTOFF_MINUTES_MAX,
    sessionCutoffMinutesMin: process.env.SESSION_CUTOFF_MINUTES_MIN,
    gateRetryIntervalHours: process.env.GATE_RETRY_INTERVAL_HOURS,
  });

  if (!result.success) {
    throw new Error(`設定が不正です: ${result.error.message}`);
  }
  return result.data;
};
