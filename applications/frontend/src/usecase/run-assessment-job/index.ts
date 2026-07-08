import { type ResultAsync, errAsync, okAsync, fromPromise } from "neverthrow";
import { z } from "zod";
import { type DomainError, type NonEmptyList, createNonEmptyList } from "../../domain/shared";
import {
  startAnalysisJob,
  completeAnalysisJob,
  failAnalysisJob,
  retryAnalysisJob,
  cancelAnalysisJob,
  DEFAULT_ANALYSIS_JOB_MAX_ATTEMPTS,
  type AnalysisJobIdentifier,
  type RunningAnalysisJob,
  type AnalysisJobSucceeded,
  type AnalysisJobFailed,
  type AnalysisJobCanceled,
  type AnalysisJobQueued,
} from "../../domain/analysis-job";
import { recomputeAnalysisRunStatus } from "../shared/analysis-run-status";
import {
  createAssessmentResultIdentifier,
  createAssessmentFindingIdentifier,
  createScore0To100,
  createConfidence0To1,
  createTokenizerVersion,
  createAssessmentResult,
  isValidFindingPhenomenon,
  type FindingPhenomenon,
  type AssessmentResult,
  type AssessmentResultCreated,
  type AssessmentFinding,
  type AssessmentSegment,
  type ScoreSet,
  type AssessmentEngineMetadata,
  type AnalysisEngineSnapshot,
} from "../../domain/assessment-result";
import { type AnalysisJobRepository } from "../port/analysis-job-repository";
import { type AnalysisRunRepository } from "../port/analysis-run-repository";
import { type RecordingAttemptRepository } from "../port/recording-attempt-repository";
import { type AudioFileRepository } from "../port/audio-file-repository";
import { type AudioStorage } from "../port/audio-storage";
import { type SectionRepository } from "../port/section-repository";
import { type AssessmentResultRepository } from "../port/assessment-result-repository";
import { type PronunciationAssessmentEngineRegistry } from "../port/pronunciation-assessment-engine-registry";
import { type TransactionManager } from "../port/transaction-manager";
import { type EntropyProvider } from "../port/entropy-provider";
import { type Clock } from "../port/clock";
import { type Logger } from "../port/logger";
import { TOKENIZER_VERSION } from "../shared/tokenizer";
import {
  type AssessmentResultDraft,
  type DiagnosticPerPhonemeGopDraft,
} from "../assessment-result-draft";
import {
  type ImprovementMessageGenerator,
  type FeedbackLayersOutput,
} from "../port/improvement-message-generator";
import { parseInput } from "../shared/validation";

// ---- Constants ----

const ASSESSMENT_SCHEMA_VERSION = "1";

/**
 * DEFAULT_LLM_NARRATIVE_MAX_CONCURRENCY / DEFAULT_LLM_NARRATIVE_MAX_FINDINGS
 * — dependencies.llmNarrativeMaxConcurrency / llmNarrativeMaxFindings が
 * 省略された場合のデフォルト値。
 * infrastructure/config/index.ts の llmNarrativeMaxConcurrency / llmNarrativeMaxFindings の
 * デフォルト値（zod .default(3) / .default(8)）と手動同期すること。
 */
const DEFAULT_LLM_NARRATIVE_MAX_CONCURRENCY = 3;
const DEFAULT_LLM_NARRATIVE_MAX_FINDINGS = 8;

// ---- Input ----

const runAssessmentJobSchema = z.object({
  leaseOwner: z.string().min(1, "leaseOwnerは空にできません"),
  leaseDurationSeconds: z.number().int().positive().default(60),
  maxAttempts: z.number().int().positive().default(DEFAULT_ANALYSIS_JOB_MAX_ATTEMPTS),
});

// z.input: default 適用前の境界入力型。leaseDurationSeconds / maxAttempts は任意。
export type RunAssessmentJobInput = z.input<typeof runAssessmentJobSchema>;

// ---- Output ----

export type RunAssessmentJobOutput = Readonly<{
  job: Readonly<{
    identifier: string;
    engine: string;
    state: string;
  }> | null;
  result: Readonly<{
    identifier: string;
    analysisJob: string;
  }> | null;
  retryScheduled: boolean;
  events: ReadonlyArray<
    | AnalysisJobSucceeded
    | AnalysisJobFailed
    | AnalysisJobCanceled
    | AnalysisJobQueued
    | AssessmentResultCreated
  >;
  /**
   * M-CRL-16 (ADR-022 D17): diagnosticPerPhonemeGop — in-memory pass-through のみ（永続化なし）。
   * normal / low_quality の両経路で populate。route がこれを使って retryGop を導出する。
   * 非 retry caller（main assessment フロー）はこのフィールドを無視してよい（additive/optional）。
   */
  diagnosticPerPhonemeGop: ReadonlyArray<DiagnosticPerPhonemeGopDraft>;
}>;

// ---- Dependencies ----

export type RunAssessmentJobDependencies = Readonly<{
  analysisJobRepository: AnalysisJobRepository;
  analysisRunRepository: AnalysisRunRepository;
  recordingAttemptRepository: RecordingAttemptRepository;
  audioFileRepository: AudioFileRepository;
  audioStorage: AudioStorage;
  sectionRepository: SectionRepository;
  assessmentResultRepository: AssessmentResultRepository;
  engineRegistry: PronunciationAssessmentEngineRegistry;
  transactionManager: TransactionManager;
  entropyProvider: EntropyProvider;
  clock: Clock;
  logger: Logger;
  improvementMessageGenerator: ImprovementMessageGenerator;
  /**
   * M-LLM-4 (ADR-021): pre-loop batch 並列度上限。
   * 省略時は 3（= config.llmNarrativeMaxConcurrency のデフォルト）。
   * registry は現在 config 値を渡さないため optional にし、
   * dispatch 4 (registry 分岐) で渡されるまでデフォルトで動作する。
   * M-LLM-16: createRunAssessmentJob の呼び出し側（registry.ts）は無改修のままコンパイルできる。
   */
  llmNarrativeMaxConcurrency?: number;
  /**
   * ADR-023 D2 (M-TMO-5): LLM 生成対象 finding 数上限。
   * 省略時は 8（= config.llmNarrativeMaxFindings のデフォルト）。
   * severity 降順 → functionalLoad（max > high > mid > low）降順の上位 N 件を LLM 対象に選択。
   * 上限外 finding は rule-based パスへ落ちる。
   */
  llmNarrativeMaxFindings?: number;
  /**
   * ADR-023 D3 (M-TMO-8): LLM provider 文字列。バッチサマリログの provider フィールドに使う。
   * registry から config.llmCoachingProvider を渡す。省略時は "unknown"。
   */
  llmCoachingProvider?: string;
}>;

// ---- Helpers ----

const extractReason = (error: DomainError): string | null => {
  if (
    error.type === "persistenceFailed" ||
    error.type === "transactionFailed" ||
    error.type === "audioStorageFailed" ||
    error.type === "assessmentSchemaInvalid"
  ) {
    return error.reason;
  }
  if (error.type === "assessmentEngineFailed") {
    return error.reason;
  }
  return null;
};

const isJobCanceled = (
  analysisJobRepository: AnalysisJobRepository,
  jobIdentifier: AnalysisJobIdentifier,
): ResultAsync<boolean, DomainError> =>
  analysisJobRepository.find(jobIdentifier).map((job) => job.type === "canceled");

const bufferFromStream = (stream: NodeJS.ReadableStream): ResultAsync<Buffer, DomainError> =>
  fromPromise(
    new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer | string) =>
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
      );
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", (err: Error) => reject(err));
    }),
    (err): DomainError => ({
      type: "audioStorageFailed",
      reason: String(err),
    }),
  );

/**
 * AssessmentResultDraft の AssessmentEngineMetadataDraft を Domain の AssessmentEngineMetadata へ変換する。
 */
const mapMetadata = (draft: AssessmentResultDraft): AssessmentEngineMetadata => ({
  engineName: draft.engine.type,
  engineVersion:
    draft.metadata.workerVersion ?? draft.metadata.model ?? draft.metadata.assessmentSchemaVersion,
  modelName: draft.metadata.model,
  promptVersion: draft.metadata.promptVersion,
  schemaVersion: String(draft.metadata.assessmentSchemaVersion),
});

/**
 * AssessmentResultDraft の engine から Domain の AnalysisEngineSnapshot へ変換する。
 */
const mapEngineSnapshot = (draft: AssessmentResultDraft): AnalysisEngineSnapshot => {
  const engine = draft.engine;
  if (engine.type === "cloud") {
    return {
      type: "cloud",
      identifier: String(engine.identifier),
      displayName: String(engine.displayName),
      modelName: engine.modelName ?? null,
    };
  }
  return {
    type: "oss_worker",
    identifier: String(engine.identifier),
    displayName: String(engine.displayName),
    modelName: engine.modelName ?? null,
  };
};

const handleJobFailure = (
  dependencies: RunAssessmentJobDependencies,
  job: RunningAnalysisJob,
  errorCode: string | null,
  errorMessage: string | null,
  failureKind: "retryable" | "nonRetryable",
  now: Date,
  diagnosticPerPhonemeGop: ReadonlyArray<DiagnosticPerPhonemeGopDraft> = [],
): ResultAsync<RunAssessmentJobOutput, DomainError> => {
  const retryResult = retryAnalysisJob(job, failureKind, now);

  if (retryResult.isOk()) {
    const { analysisJob: retriedJob, events: retryEvents } = retryResult.value;
    return dependencies.analysisJobRepository
      .persist(retriedJob)
      .andThen(() =>
        recomputeAnalysisRunStatus(
          dependencies.analysisJobRepository,
          dependencies.analysisRunRepository,
          retriedJob,
          "queued",
        ),
      )
      .map(() => ({
        job: {
          identifier: retriedJob.identifier as string,
          engine: retriedJob.engine,
          state: retriedJob.type,
        },
        result: null,
        retryScheduled: true,
        events: [...retryEvents] as RunAssessmentJobOutput["events"],
        diagnosticPerPhonemeGop,
      }));
  }

  // 再試行不能または上限超過 → failed
  const { analysisJob: failedJob, events: failEvents } = failAnalysisJob(
    job,
    errorCode,
    errorMessage,
    now,
  );
  return dependencies.analysisJobRepository
    .persist(failedJob)
    .andThen(() =>
      recomputeAnalysisRunStatus(
        dependencies.analysisJobRepository,
        dependencies.analysisRunRepository,
        failedJob,
        "failed",
      ),
    )
    .map(() => ({
      job: {
        identifier: failedJob.identifier as string,
        engine: failedJob.engine,
        state: failedJob.type,
      },
      result: null,
      retryScheduled: false,
      events: [...failEvents] as RunAssessmentJobOutput["events"],
      diagnosticPerPhonemeGop,
    }));
};

// ---- Implementation ----

export const createRunAssessmentJob =
  (dependencies: RunAssessmentJobDependencies) =>
  (input: RunAssessmentJobInput): ResultAsync<RunAssessmentJobOutput, DomainError> => {
    const parsedInput = parseInput(runAssessmentJobSchema, input);
    if (parsedInput.isErr()) {
      return errAsync(parsedInput.error);
    }
    const parsed = parsedInput.value;

    const { leaseOwner, leaseDurationSeconds } = parsed;
    const now = dependencies.clock.now();
    const leaseDurationMs = leaseDurationSeconds * 1000;

    // 1. DB lease でジョブを 1 件取得
    return dependencies.analysisJobRepository
      .acquireLease(leaseOwner, leaseDurationMs, now)
      .andThen((leasedJob) => {
        if (!leasedJob) {
          return okAsync({
            job: null,
            result: null,
            retryScheduled: false,
            events: [],
            diagnosticPerPhonemeGop: [],
          } satisfies RunAssessmentJobOutput);
        }

        dependencies.logger.info("runAssessmentJob: lease acquired", {
          jobIdentifier: leasedJob.identifier as string,
          engine: leasedJob.engine,
        });

        // 2. lease 直後にキャンセル状態確認
        return isJobCanceled(dependencies.analysisJobRepository, leasedJob.identifier).andThen(
          (isCanceledAfterLease) => {
            if (isCanceledAfterLease) {
              const { analysisJob: canceledJob, events: cancelEvents } = cancelAnalysisJob(
                leasedJob,
                now,
              );
              return dependencies.analysisJobRepository.persist(canceledJob).map(() => ({
                job: {
                  identifier: canceledJob.identifier as string,
                  engine: canceledJob.engine,
                  state: canceledJob.type,
                },
                result: null,
                retryScheduled: false,
                events: [...cancelEvents] as RunAssessmentJobOutput["events"],
                diagnosticPerPhonemeGop: [],
              }));
            }

            // running 状態へ遷移
            const { analysisJob: runningJob } = startAnalysisJob(leasedJob, now);

            // M-CRL-16: diagnosticPerPhonemeGop in-memory pass-through。
            // andThen((draft) => {...}) の内部で代入し、後段の .map() で読む。
            // let を使う理由: draft のスコープが .andThen コールバック内に閉じており、
            // fromPromise(...).andThen(...) で生成した ResultAsync チェーンの .map コールバックでは
            // 別の実行コンテキストになるため const capturedXxx では到達できない（運行時 ReferenceError）。
            let jobDiagnosticPerPhonemeGop: ReadonlyArray<DiagnosticPerPhonemeGopDraft> = [];

            // 3. RecordingAttempt / AudioFile / Section を取得
            return dependencies.analysisRunRepository
              .find(leasedJob.analysisRun)
              .andThen((analysisRun) =>
                dependencies.recordingAttemptRepository
                  .find(analysisRun.recordingAttempt)
                  .andThen((recordingAttempt) =>
                    dependencies.audioFileRepository
                      .findByRecordingAttempt(recordingAttempt.identifier)
                      .andThen((audioFile) =>
                        dependencies.sectionRepository
                          .find(recordingAttempt.section)
                          .andThen((section) =>
                            // 4. 保存済み音声を読む
                            dependencies.audioStorage
                              .stream(audioFile.storageKey)
                              .andThen((streamResult) => bufferFromStream(streamResult.stream))
                              .andThen((audioBuffer) =>
                                // エンジン呼び出し前にキャンセル再確認
                                isJobCanceled(
                                  dependencies.analysisJobRepository,
                                  runningJob.identifier,
                                ).andThen((isCanceledBeforeEngine) => {
                                  if (isCanceledBeforeEngine) {
                                    const { analysisJob: canceledJob, events: cancelEvents } =
                                      cancelAnalysisJob(runningJob, now);
                                    return dependencies.analysisJobRepository
                                      .persist(canceledJob)
                                      .map(() => ({
                                        job: {
                                          identifier: canceledJob.identifier as string,
                                          engine: canceledJob.engine,
                                          state: canceledJob.type,
                                        },
                                        result: null,
                                        retryScheduled: false,
                                        events: [
                                          ...cancelEvents,
                                        ] as RunAssessmentJobOutput["events"],
                                        diagnosticPerPhonemeGop: [],
                                      }));
                                  }

                                  // 5. エンジン解決
                                  const engineResult = dependencies.engineRegistry.find(
                                    runningJob.engine === "cloud"
                                      ? {
                                          type: "cloud" as const,
                                          identifier: runningJob.engineConfigJson as never,
                                          displayName: runningJob.engine as never,
                                          provider: "cloud",
                                          modelName: "",
                                          externalSendingRequired: true as const,
                                          enabled: true,
                                          configuration: {},
                                        }
                                      : {
                                          type: "oss_worker" as const,
                                          identifier: runningJob.engineConfigJson as never,
                                          displayName: runningJob.engine as never,
                                          workerVersion: "",
                                          modelName: "",
                                          rulesetVersion: "",
                                          enabled: true,
                                          configuration: {},
                                        },
                                  );

                                  if (engineResult.isErr()) {
                                    return handleJobFailure(
                                      dependencies,
                                      runningJob,
                                      "engineNotFound",
                                      engineResult.error.type,
                                      "nonRetryable",
                                      now,
                                    );
                                  }

                                  const engine = engineResult.value;
                                  const resolvedEngine =
                                    runningJob.engine === "cloud"
                                      ? ({
                                          type: "cloud" as const,
                                          identifier: runningJob.engineConfigJson as never,
                                          displayName: runningJob.engine as never,
                                          provider: "cloud",
                                          modelName: "",
                                          externalSendingRequired: true as const,
                                          enabled: true,
                                          configuration: {},
                                        } as const)
                                      : ({
                                          type: "oss_worker" as const,
                                          identifier: runningJob.engineConfigJson as never,
                                          displayName: runningJob.engine as never,
                                          workerVersion: "",
                                          modelName: "",
                                          rulesetVersion: "",
                                          enabled: true,
                                          configuration: {},
                                        } as const);

                                  // 6. エンジン呼び出し（拡張入力を渡す）
                                  return engine
                                    .assess({
                                      analysisJob: runningJob.identifier,
                                      analysisRun: analysisRun.identifier,
                                      recordingAttempt: recordingAttempt.identifier,
                                      section: recordingAttempt.section,
                                      engine: resolvedEngine,
                                      sectionBodyText: section.bodyText as string,
                                      audioBuffer,
                                      audioMimeType: audioFile.mimeType as string,
                                      audioByteLength: audioFile.sizeBytes,
                                      audioDurationMilliseconds: audioFile.durationMilliseconds,
                                      tokenizerVersion: TOKENIZER_VERSION,
                                      assessmentSchemaVersion: ASSESSMENT_SCHEMA_VERSION,
                                    })
                                    .andThen((draft) => {
                                      // M-CRL-16: diagnosticPerPhonemeGop を外側スコープの let 変数に書き出す。
                                      // jobDiagnosticPerPhonemeGop は runningJob スコープで宣言済み。
                                      // このコールバック内の draft はここでのみ参照可能なため、
                                      // 後段の .map(() => {...}) では jobDiagnosticPerPhonemeGop 経由で読む。
                                      jobDiagnosticPerPhonemeGop = draft.diagnosticPerPhonemeGop;

                                      // 7a. low_quality 早期返却: errAsync で orElse パスに乗せる
                                      if (draft.status === "low_quality") {
                                        dependencies.logger.info(
                                          "runAssessmentJob: low_quality audio detected, failing job without retry",
                                          { analysisJob: String(runningJob.identifier) },
                                        );
                                        return errAsync<
                                          readonly [
                                            AssessmentResult,
                                            NonEmptyList<AssessmentResultCreated>,
                                          ],
                                          DomainError
                                        >({
                                          type: "assessmentEngineFailed",
                                          engine: "oss_worker",
                                          reason: "low_quality_audio",
                                          failureKind: "nonRetryable",
                                        });
                                      }

                                      // 7. AssessmentResultDraft 共通検証 (use-case.md §7.5)
                                      const scoreKeys = [
                                        "overall",
                                        "accuracy",
                                        "nativeLikeness",
                                        "pronunciation",
                                        "connectedSpeech",
                                        "prosody",
                                      ] as const;

                                      for (const key of scoreKeys) {
                                        const scoreResult = createScore0To100(draft.scores[key]);
                                        if (scoreResult.isErr()) {
                                          return errAsync<
                                            readonly [
                                              AssessmentResult,
                                              NonEmptyList<AssessmentResultCreated>,
                                            ],
                                            DomainError
                                          >({
                                            type: "assessmentSchemaInvalid",
                                            reason: `scores.${key}: ${extractReason(scoreResult.error) ?? scoreResult.error.type}`,
                                          });
                                        }
                                      }

                                      if (draft.segments.length === 0) {
                                        return errAsync<
                                          readonly [
                                            AssessmentResult,
                                            NonEmptyList<AssessmentResultCreated>,
                                          ],
                                          DomainError
                                        >({
                                          type: "assessmentSchemaInvalid",
                                          reason: "segments は空にできません",
                                        });
                                      }

                                      if (
                                        !draft.summary.messageJa ||
                                        draft.summary.messageJa.trim().length === 0
                                      ) {
                                        return errAsync<
                                          readonly [
                                            AssessmentResult,
                                            NonEmptyList<AssessmentResultCreated>,
                                          ],
                                          DomainError
                                        >({
                                          type: "assessmentSchemaInvalid",
                                          reason: "summary.messageJa は必須です",
                                        });
                                      }

                                      if (draft.tokenizerVersion !== TOKENIZER_VERSION) {
                                        return errAsync<
                                          readonly [
                                            AssessmentResult,
                                            NonEmptyList<AssessmentResultCreated>,
                                          ],
                                          DomainError
                                        >({
                                          type: "assessmentSchemaInvalid",
                                          reason: `tokenizerVersion が一致しません: expected ${TOKENIZER_VERSION}, got ${draft.tokenizerVersion}`,
                                        });
                                      }

                                      const tokenizerVersion = createTokenizerVersion(
                                        draft.tokenizerVersion,
                                      );
                                      if (!tokenizerVersion) {
                                        return errAsync<
                                          readonly [
                                            AssessmentResult,
                                            NonEmptyList<AssessmentResultCreated>,
                                          ],
                                          DomainError
                                        >({
                                          type: "assessmentSchemaInvalid",
                                          reason: "tokenizerVersion が空です",
                                        });
                                      }

                                      // M-LLM-4 (ADR-021) + ADR-023 D2 (M-TMO-3): pre-loop batch 並列生成
                                      // generateFeedbackLayersAsync が定義されている場合（LLM プロバイダ）、
                                      // finding を severity 降順 → functionalLoad 降順でソートし、
                                      // 上位 llmNarrativeMaxFindings 件の「元配列 index」のみを LLM 対象に選択。
                                      // ADR-023 D2: LLM を最も重要な finding（severity 高 → functionalLoad 高）に集中投下する。
                                      // Map のキーは必ず元配列 index（sorted 後位置ではない）— ORPHAN RISK 1。
                                      // undefined（rule-based）の場合は空 Map を返しスキップする。
                                      return fromPromise(
                                        (async (): Promise<Map<number, FeedbackLayersOutput>> => {
                                          const precomputed = new Map<
                                            number,
                                            FeedbackLayersOutput
                                          >();
                                          const generateFeedbackLayersAsync =
                                            dependencies.improvementMessageGenerator
                                              .generateFeedbackLayersAsync;
                                          if (!generateFeedbackLayersAsync) {
                                            return precomputed;
                                          }
                                          const llmNarrativeMaxConcurrency =
                                            dependencies.llmNarrativeMaxConcurrency ??
                                            DEFAULT_LLM_NARRATIVE_MAX_CONCURRENCY;
                                          const llmNarrativeMaxFindings =
                                            dependencies.llmNarrativeMaxFindings ??
                                            DEFAULT_LLM_NARRATIVE_MAX_FINDINGS;

                                          // ADR-023 D2 (M-TMO-3): severity/functionalLoad rank maps
                                          // severity: critical=4 > major=3 > minor=2 > suggestion=1; unknown=0
                                          const severityRank: Record<string, number> = {
                                            critical: 4,
                                            major: 3,
                                            minor: 2,
                                            suggestion: 1,
                                          };
                                          // functionalLoad: max=4 > high=3 > mid=2 > low=1; null/unknown=0
                                          const functionalLoadRank: Record<string, number> = {
                                            max: 4,
                                            high: 3,
                                            mid: 2,
                                            low: 1,
                                          };

                                          // Build index-ranked list; stable sort preserves original order for ties
                                          const rankedIndices = draft.findings
                                            .map((findingDraft, originalIndex) => ({
                                              originalIndex,
                                              severityScore:
                                                severityRank[findingDraft.severity ?? ""] ?? 0,
                                              functionalLoadScore:
                                                functionalLoadRank[
                                                  findingDraft.functionalLoad ?? ""
                                                ] ?? 0,
                                            }))
                                            .sort((rankA, rankB) => {
                                              if (rankA.severityScore !== rankB.severityScore) {
                                                return rankB.severityScore - rankA.severityScore;
                                              }
                                              if (
                                                rankA.functionalLoadScore !==
                                                rankB.functionalLoadScore
                                              ) {
                                                return (
                                                  rankB.functionalLoadScore -
                                                  rankA.functionalLoadScore
                                                );
                                              }
                                              // stable tie-break: preserve original index order (asc)
                                              return rankA.originalIndex - rankB.originalIndex;
                                            });

                                          // Select top-N original indices
                                          const selectedOriginalIndices = new Set(
                                            rankedIndices
                                              .slice(0, llmNarrativeMaxFindings)
                                              .map((item) => item.originalIndex),
                                          );

                                          // Build batch inputs keyed by ORIGINAL index (ORPHAN RISK 1)
                                          const allInputs = draft.findings
                                            .map((findingDraft, index) => ({
                                              index,
                                              input: {
                                                phenomenon: isValidFindingPhenomenon(
                                                  findingDraft.phenomenon ?? "",
                                                )
                                                  ? (findingDraft.phenomenon as FindingPhenomenon)
                                                  : ("substitution" as const),
                                                expected: findingDraft.expected,
                                                detected: findingDraft.detected,
                                                wordPositionLabel:
                                                  findingDraft.wordPositionLabel ?? null,
                                                catalogId: findingDraft.catalogId ?? null,
                                                wordPair: findingDraft.wordPair ?? null,
                                                expectedPronunciation:
                                                  findingDraft.expectedPronunciation ?? null,
                                                insertedVowel: findingDraft.insertedVowel ?? null,
                                                insertionPositionMs:
                                                  findingDraft.insertionPositionMs ?? null,
                                                detectedTopCandidate:
                                                  findingDraft.detectedTopCandidate ?? null,
                                                nBest: findingDraft.nBest ?? null,
                                                // M-LLM-3 (ADR-021): gop / functionalLoad を配線
                                                gop: findingDraft.gop ?? null,
                                                functionalLoad: findingDraft.functionalLoad ?? null,
                                                // M-APD-15 (ADR-018): acousticEvidence を配線
                                                acousticEvidence:
                                                  findingDraft.acousticEvidence ?? null,
                                              },
                                            }))
                                            // Filter to only selected (top-N) original indices
                                            .filter(({ index }) =>
                                              selectedOriginalIndices.has(index),
                                            );

                                          // ADR-023 D3 (M-TMO-8): per-job fallback accumulator
                                          // (created per-job, not singleton — no cross-job accumulation)
                                          let llmFallbackCount = 0;
                                          const byReason: Record<string, number> = {};
                                          const requested = allInputs.length;

                                          for (
                                            let chunkStart = 0;
                                            chunkStart < allInputs.length;
                                            chunkStart += llmNarrativeMaxConcurrency
                                          ) {
                                            const chunk = allInputs.slice(
                                              chunkStart,
                                              chunkStart + llmNarrativeMaxConcurrency,
                                            );
                                            const chunkResults = await Promise.all(
                                              chunk.map(({ index, input }) =>
                                                generateFeedbackLayersAsync(
                                                  input,
                                                  (reason: string) => {
                                                    // onFallback fires when factory fell back to rule-based
                                                    llmFallbackCount++;
                                                    byReason[reason] = (byReason[reason] ?? 0) + 1;
                                                  },
                                                ).then((layers) => ({ index, layers })),
                                              ),
                                            );
                                            for (const { index, layers } of chunkResults) {
                                              // Map keyed by ORIGINAL finding index (ORPHAN RISK 1 guard)
                                              precomputed.set(index, layers);
                                            }
                                          }

                                          // ADR-023 D3 (M-TMO-8): emit batch summary (LLM path only)
                                          const llmSuccess = requested - llmFallbackCount;
                                          dependencies.logger.info("llm narrative batch", {
                                            provider: dependencies.llmCoachingProvider ?? "unknown",
                                            requested,
                                            llmSuccess,
                                            llmFallback: llmFallbackCount,
                                            byReason,
                                          });

                                          return precomputed;
                                        })(),
                                        (err): DomainError => ({
                                          type: "assessmentEngineFailed",
                                          engine: "oss_worker",
                                          reason: `LLM pre-loop batch failed: ${String(err)}`,
                                          failureKind: "retryable",
                                        }),
                                      ).andThen((precomputed) => {
                                        // findings に identifier を付与 + confidence 検証
                                        const findingsWithId: AssessmentFinding[] = [];
                                        for (
                                          let findingIndex = 0;
                                          findingIndex < draft.findings.length;
                                          findingIndex++
                                        ) {
                                          const findingDraft = draft.findings[findingIndex]!;
                                          const findingIdRaw =
                                            dependencies.entropyProvider.generateUlid();
                                          const findingIdentifier =
                                            createAssessmentFindingIdentifier(findingIdRaw);
                                          if (!findingIdentifier) {
                                            return errAsync<
                                              readonly [
                                                AssessmentResult,
                                                NonEmptyList<AssessmentResultCreated>,
                                              ],
                                              DomainError
                                            >({
                                              type: "assessmentSchemaInvalid",
                                              reason: "finding identifier 生成に失敗しました",
                                            });
                                          }

                                          const confidenceResult = createConfidence0To1(
                                            findingDraft.confidence,
                                          );
                                          if (confidenceResult.isErr()) {
                                            return errAsync<
                                              readonly [
                                                AssessmentResult,
                                                NonEmptyList<AssessmentResultCreated>,
                                              ],
                                              DomainError
                                            >({
                                              type: "assessmentSchemaInvalid",
                                              reason: `finding.confidence: ${extractReason(confidenceResult.error) ?? confidenceResult.error.type}`,
                                            });
                                          }

                                          // phenomenon を型ガードで確定（invalid なら substitution にフォールバック）
                                          const phenomenon: FindingPhenomenon =
                                            isValidFindingPhenomenon(findingDraft.phenomenon ?? "")
                                              ? (findingDraft.phenomenon as FindingPhenomenon)
                                              : "substitution";

                                          // M-LLM-3 (ADR-021): generate / generateFeedbackLayers 入力に
                                          // gop / functionalLoad を配線（両呼び出し点に必須）
                                          const generateInput = {
                                            phenomenon: phenomenon ?? "substitution",
                                            expected: findingDraft.expected,
                                            detected: findingDraft.detected,
                                            wordPositionLabel:
                                              findingDraft.wordPositionLabel ?? null,
                                            catalogId: findingDraft.catalogId ?? null,
                                            wordPair: findingDraft.wordPair ?? null,
                                            expectedPronunciation:
                                              findingDraft.expectedPronunciation ?? null,
                                            insertedVowel: findingDraft.insertedVowel ?? null,
                                            insertionPositionMs:
                                              findingDraft.insertionPositionMs ?? null,
                                            detectedTopCandidate:
                                              findingDraft.detectedTopCandidate ?? null,
                                            nBest: findingDraft.nBest ?? null,
                                            gop: findingDraft.gop ?? null,
                                            functionalLoad: findingDraft.functionalLoad ?? null,
                                            // M-APD-15 (ADR-018): acousticEvidence を配線
                                            acousticEvidence: findingDraft.acousticEvidence ?? null,
                                          };

                                          // M-LLM-4 (ADR-021): feedbackLayers 解決順序
                                          // findingDraft.feedbackLayers
                                          //   ?? precomputed.get(findingIndex)   ← LLM pre-loop result
                                          //   ?? generateFeedbackLayers(input)   ← rule-based sync fallback
                                          const precomputedLayers = precomputed.get(findingIndex);
                                          const feedbackLayers =
                                            findingDraft.feedbackLayers ??
                                            precomputedLayers ??
                                            dependencies.improvementMessageGenerator.generateFeedbackLayers(
                                              generateInput,
                                            );

                                          // messageJa: 既存値があればそのまま。
                                          // LLM pre-loop 経由（precomputedLayers あり）: feedbackLayers.whatJa を採用。
                                          // rule-based（precomputedLayers なし）: generate() を呼ぶ（現状維持）。
                                          const messageJa =
                                            findingDraft.messageJa &&
                                            findingDraft.messageJa.trim().length > 0
                                              ? findingDraft.messageJa
                                              : precomputedLayers !== undefined
                                                ? feedbackLayers.whatJa
                                                : dependencies.improvementMessageGenerator.generate(
                                                    generateInput,
                                                  );

                                          // Draft の textRange/audioRange を Domain 型へ変換
                                          findingsWithId.push({
                                            identifier: findingIdentifier,
                                            phenomenon,
                                            gop: findingDraft.gop,
                                            category: findingDraft.category,
                                            severity: findingDraft.severity,
                                            textRange: {
                                              startOffset: findingDraft.textRange.startChar,
                                              endOffset: findingDraft.textRange.endChar,
                                            },
                                            audioRange: findingDraft.audioRange
                                              ? {
                                                  startMilliseconds:
                                                    findingDraft.audioRange.startMs,
                                                  endMilliseconds: findingDraft.audioRange.endMs,
                                                }
                                              : null,
                                            expected: findingDraft.expected,
                                            detected: findingDraft.detected,
                                            messageJa,
                                            messageEn: findingDraft.messageEn,
                                            scoreImpact: findingDraft.scoreImpact,
                                            confidence: confidenceResult.value,
                                            detectedTopCandidate:
                                              findingDraft.detectedTopCandidate ?? null,
                                            nBest: findingDraft.nBest ?? null,
                                            matchesL1Pattern: findingDraft.matchesL1Pattern,
                                            functionalLoad: findingDraft.functionalLoad ?? null,
                                            catalogId: findingDraft.catalogId ?? null,
                                            wordPair: findingDraft.wordPair ?? null,
                                            expectedPronunciation:
                                              findingDraft.expectedPronunciation ?? null,
                                            insertedVowel: findingDraft.insertedVowel ?? null,
                                            insertionPositionMs:
                                              findingDraft.insertionPositionMs ?? null,
                                            feedbackLayers,
                                            dismissed: findingDraft.dismissed,
                                            wordPositionLabel:
                                              findingDraft.wordPositionLabel ?? null,
                                            // M-AAI-12 (ADR-019): ORPHAN-B 防止 — DB persist 前に drop しない
                                            articulatoryEstimate:
                                              findingDraft.articulatoryEstimate ?? null,
                                          });
                                        }

                                        const scores: ScoreSet = {
                                          overall: createScore0To100(
                                            draft.scores.overall,
                                          )._unsafeUnwrap(),
                                          accuracy: createScore0To100(
                                            draft.scores.accuracy,
                                          )._unsafeUnwrap(),
                                          nativeLikeness: createScore0To100(
                                            draft.scores.nativeLikeness,
                                          )._unsafeUnwrap(),
                                          pronunciation: createScore0To100(
                                            draft.scores.pronunciation,
                                          )._unsafeUnwrap(),
                                          connectedSpeech: createScore0To100(
                                            draft.scores.connectedSpeech,
                                          )._unsafeUnwrap(),
                                          prosody: createScore0To100(
                                            draft.scores.prosody,
                                          )._unsafeUnwrap(),
                                          intelligibility:
                                            draft.scores.intelligibility !== null
                                              ? createScore0To100(
                                                  draft.scores.intelligibility,
                                                )._unsafeUnwrap()
                                              : null,
                                          cefrOverall: draft.scores.cefrOverall,
                                          cefrSegmental: draft.scores.cefrSegmental,
                                          cefrProsodic: draft.scores.cefrProsodic,
                                        };

                                        // Draft の segments を Domain 型へ変換
                                        const segments = createNonEmptyList(
                                          draft.segments.map(
                                            (s): AssessmentSegment => ({
                                              textRange: {
                                                startOffset: s.textRange.startChar,
                                                endOffset: s.textRange.endChar,
                                              },
                                              audioRange: {
                                                startMilliseconds: s.audioRange.startMs,
                                                endMilliseconds: s.audioRange.endMs,
                                              },
                                              transcript: s.transcript,
                                              confidence: s.confidence,
                                            }),
                                          ),
                                        )!;

                                        // rawResponse は ACL が 1MB 上限処理済みの Envelope
                                        // UseCase は storageKey として { data: rawResponse } で包んで保存
                                        const rawData = { data: draft.rawResponse };

                                        const resultIdentifierRaw =
                                          dependencies.entropyProvider.generateUlid();
                                        const resultIdentifier =
                                          createAssessmentResultIdentifier(resultIdentifierRaw);
                                        if (!resultIdentifier) {
                                          return errAsync<
                                            readonly [
                                              AssessmentResult,
                                              NonEmptyList<AssessmentResultCreated>,
                                            ],
                                            DomainError
                                          >({
                                            type: "assessmentSchemaInvalid",
                                            reason: "result identifier 生成に失敗しました",
                                          });
                                        }

                                        const metadata = mapMetadata(draft);
                                        const engineSnapshot = mapEngineSnapshot(draft);

                                        const { assessmentResult, events: resultEvents } =
                                          createAssessmentResult({
                                            identifier: resultIdentifier,
                                            analysisJob: runningJob.identifier,
                                            scores,
                                            summary: {
                                              overallCommentJa: draft.summary.messageJa,
                                              overallCommentEn: draft.summary.messageEn,
                                            },
                                            findings: findingsWithId,
                                            segments,
                                            metadata,
                                            tokenizerVersion,
                                            raw: rawData,
                                            engineSnapshot,
                                            now,
                                            perPhonemeGop: draft.perPhonemeGop,
                                            focusSounds: draft.focusSounds,
                                            prosody: draft.prosody,
                                            engineSummaryMessageJa: draft.engineSummaryMessageJa,
                                          });

                                        return okAsync([assessmentResult, resultEvents] as const);
                                      });
                                    })
                                    .andThen(([assessmentResult, resultEvents]) => {
                                      // 保存直前にキャンセル再確認
                                      return isJobCanceled(
                                        dependencies.analysisJobRepository,
                                        runningJob.identifier,
                                      ).andThen((isCanceledBeforeSave) => {
                                        if (isCanceledBeforeSave) {
                                          const { analysisJob: canceledJob, events: cancelEvents } =
                                            cancelAnalysisJob(runningJob, now);
                                          return dependencies.analysisJobRepository
                                            .persist(canceledJob)
                                            .map(() => ({
                                              job: {
                                                identifier: canceledJob.identifier as string,
                                                engine: canceledJob.engine,
                                                state: canceledJob.type,
                                              },
                                              result: null,
                                              retryScheduled: false,
                                              events: [
                                                ...cancelEvents,
                                              ] as RunAssessmentJobOutput["events"],
                                              diagnosticPerPhonemeGop: [],
                                            }));
                                        }

                                        // 8. AssessmentResult 保存 + Job を succeeded に
                                        const { analysisJob: succeededJob, events: succeedEvents } =
                                          completeAnalysisJob(runningJob, now);

                                        return dependencies.transactionManager
                                          .execute(() =>
                                            dependencies.assessmentResultRepository
                                              .persist(assessmentResult)
                                              .andThen(() =>
                                                dependencies.analysisJobRepository.persist(
                                                  succeededJob,
                                                ),
                                              )
                                              .andThen(() =>
                                                recomputeAnalysisRunStatus(
                                                  dependencies.analysisJobRepository,
                                                  dependencies.analysisRunRepository,
                                                  succeededJob,
                                                  "succeeded",
                                                ),
                                              ),
                                          )
                                          .map(() => {
                                            dependencies.logger.info(
                                              "runAssessmentJob: succeeded",
                                              {
                                                jobIdentifier: succeededJob.identifier as string,
                                                resultIdentifier:
                                                  assessmentResult.identifier as string,
                                              },
                                            );

                                            const allEvents: RunAssessmentJobOutput["events"] = [
                                              ...succeedEvents,
                                              ...resultEvents,
                                            ];

                                            return {
                                              job: {
                                                identifier: succeededJob.identifier as string,
                                                engine: succeededJob.engine,
                                                state: succeededJob.type,
                                              },
                                              result: {
                                                identifier: assessmentResult.identifier as string,
                                                analysisJob: assessmentResult.analysisJob as string,
                                              },
                                              retryScheduled: false,
                                              events: allEvents,
                                              // M-CRL-16: diagnosticPerPhonemeGop は in-memory pass-through（永続化なし）
                                              // jobDiagnosticPerPhonemeGop は runningJob スコープで let 宣言済み。
                                              diagnosticPerPhonemeGop: jobDiagnosticPerPhonemeGop,
                                            } satisfies RunAssessmentJobOutput;
                                          });
                                      });
                                    })
                                    .orElse((engineOrSchemaError) => {
                                      dependencies.logger.error(
                                        "runAssessmentJob: engine or schema error",
                                        engineOrSchemaError,
                                      );

                                      const failureKind =
                                        engineOrSchemaError.type === "assessmentEngineFailed"
                                          ? engineOrSchemaError.failureKind
                                          : engineOrSchemaError.type === "assessmentSchemaInvalid"
                                            ? "nonRetryable"
                                            : "retryable";

                                      // low_quality_audio は専用 errorCode を使う
                                      const errorCode =
                                        engineOrSchemaError.type === "assessmentEngineFailed" &&
                                        engineOrSchemaError.reason === "low_quality_audio"
                                          ? "low_quality_audio"
                                          : engineOrSchemaError.type;

                                      return handleJobFailure(
                                        dependencies,
                                        runningJob,
                                        errorCode,
                                        extractReason(engineOrSchemaError),
                                        failureKind,
                                        now,
                                        jobDiagnosticPerPhonemeGop,
                                      );
                                    });
                                }),
                              )
                              .orElse((storageError) => {
                                dependencies.logger.error(
                                  "runAssessmentJob: audio storage error",
                                  storageError,
                                );
                                return handleJobFailure(
                                  dependencies,
                                  runningJob,
                                  "audioStorageFailed",
                                  extractReason(storageError),
                                  "retryable",
                                  now,
                                );
                              }),
                          ),
                      ),
                  ),
              );
          },
        );
      });
  };
