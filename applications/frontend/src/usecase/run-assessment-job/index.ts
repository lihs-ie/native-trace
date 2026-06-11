import { type ResultAsync, errAsync, okAsync, fromPromise } from "neverthrow";
import { z } from "zod";
import {
  type DomainError,
  type NonEmptyList,
  validationFailed,
  createNonEmptyList,
} from "../../domain/shared";
import {
  startAnalysisJob,
  completeAnalysisJob,
  failAnalysisJob,
  retryAnalysisJob,
  cancelAnalysisJob,
  type AnalysisJobIdentifier,
  type RunningAnalysisJob,
  type AnalysisJobSucceeded,
  type AnalysisJobFailed,
  type AnalysisJobCanceled,
  type AnalysisJobQueued,
} from "../../domain/analysis-job";
import { deriveAnalysisRunStatus } from "../../domain/analysis-run";
import {
  createAssessmentResultIdentifier,
  createAssessmentFindingIdentifier,
  createScore0To100,
  createConfidence0To1,
  createTokenizerVersion,
  createAssessmentResult,
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
import { type AssessmentResultDraft } from "../assessment-result-draft";

// ---- Constants ----

const ASSESSMENT_SCHEMA_VERSION = "1";

// ---- Input ----

const runAssessmentJobSchema = z.object({
  leaseOwner: z.string().min(1, "leaseOwnerは空にできません"),
  leaseDurationSeconds: z.number().int().positive().default(60),
  maxAttempts: z.number().int().positive().default(3),
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
    draft.metadata.workerVersion ??
    draft.metadata.model ??
    draft.metadata.assessmentSchemaVersion,
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
): ResultAsync<RunAssessmentJobOutput, DomainError> => {
  const retryResult = retryAnalysisJob(job, failureKind, now);

  if (retryResult.isOk()) {
    const { analysisJob: retriedJob, events: retryEvents } = retryResult.value;
    return dependencies.analysisJobRepository
      .persist(retriedJob)
      .andThen(() =>
        dependencies.analysisJobRepository
          .search({ type: "jobsByAnalysisRun", analysisRun: job.analysisRun })
          .andThen((jobPage) => {
            const allJobs = jobPage.items.map((j) =>
              j.identifier === retriedJob.identifier ? retriedJob : j,
            );
            const nonEmpty = createNonEmptyList(allJobs);
            const newStatus = nonEmpty ? deriveAnalysisRunStatus(nonEmpty) : "queued";
            return dependencies.analysisRunRepository.updateStatus(job.analysisRun, newStatus);
          }),
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
      dependencies.analysisJobRepository
        .search({ type: "jobsByAnalysisRun", analysisRun: job.analysisRun })
        .andThen((jobPage) => {
          const allJobs = jobPage.items.map((j) =>
            j.identifier === failedJob.identifier ? failedJob : j,
          );
          const nonEmpty = createNonEmptyList(allJobs);
          const newStatus = nonEmpty ? deriveAnalysisRunStatus(nonEmpty) : "failed";
          return dependencies.analysisRunRepository.updateStatus(job.analysisRun, newStatus);
        }),
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
    }));
};

// ---- Implementation ----

export const createRunAssessmentJob =
  (dependencies: RunAssessmentJobDependencies) =>
  (input: RunAssessmentJobInput): ResultAsync<RunAssessmentJobOutput, DomainError> => {
    const parsed = runAssessmentJobSchema.safeParse(input);
    if (!parsed.success) {
      return errAsync(
        validationFailed("input", parsed.error.errors.map((e) => e.message).join(", ")),
      );
    }

    const { leaseOwner, leaseDurationSeconds } = parsed.data;
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
              }));
            }

            // running 状態へ遷移
            const { analysisJob: runningJob } = startAnalysisJob(leasedJob, now);

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

                                      // findings に identifier を付与 + confidence 検証
                                      const findingsWithId: AssessmentFinding[] = [];
                                      for (const findingDraft of draft.findings) {
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

                                        // Draft の textRange/audioRange を Domain 型へ変換
                                        findingsWithId.push({
                                          identifier: findingIdentifier,
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
                                          messageJa: findingDraft.messageJa,
                                          messageEn: findingDraft.messageEn,
                                          scoreImpact: findingDraft.scoreImpact,
                                          confidence: confidenceResult.value,
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
                                        });

                                      return okAsync([assessmentResult, resultEvents] as const);
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
                                                dependencies.analysisJobRepository
                                                  .search({
                                                    type: "jobsByAnalysisRun",
                                                    analysisRun: runningJob.analysisRun,
                                                  })
                                                  .andThen((jobPage) => {
                                                    const allJobs = jobPage.items.map((j) =>
                                                      j.identifier === succeededJob.identifier
                                                        ? succeededJob
                                                        : j,
                                                    );
                                                    const nonEmpty = createNonEmptyList(allJobs);
                                                    const newStatus = nonEmpty
                                                      ? deriveAnalysisRunStatus(nonEmpty)
                                                      : "succeeded";
                                                    return dependencies.analysisRunRepository.updateStatus(
                                                      runningJob.analysisRun,
                                                      newStatus,
                                                    );
                                                  }),
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

                                      return handleJobFailure(
                                        dependencies,
                                        runningJob,
                                        engineOrSchemaError.type,
                                        extractReason(engineOrSchemaError),
                                        failureKind,
                                        now,
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
