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
  });

  if (!result.success) {
    throw new Error(`設定が不正です: ${result.error.message}`);
  }
  return result.data;
};
