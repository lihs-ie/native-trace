import { type ResultAsync, errAsync, okAsync } from "neverthrow";
import { z } from "zod";
import { type DomainError, type NonEmptyList, validationFailed } from "../../domain/shared";
import { createRecordingAttemptIdentifier } from "../../domain/recording-attempt";
import {
  createAnalysisRunIdentifier,
  createAnalysisRun,
  type AnalysisMode,
  type AnalysisRunStarted,
} from "../../domain/analysis-run";
import {
  createAnalysisJobIdentifier,
  createAnalysisJob,
  type AnalysisJobQueued,
  type EngineType,
} from "../../domain/analysis-job";
import { type RecordingAttemptRepository } from "../port/recording-attempt-repository";
import { type AnalysisRunRepository } from "../port/analysis-run-repository";
import { type AnalysisJobRepository } from "../port/analysis-job-repository";
import { type TransactionManager } from "../port/transaction-manager";
import { type EntropyProvider } from "../port/entropy-provider";
import { type Clock } from "../port/clock";
import { type Logger } from "../port/logger";
import { parseInput } from "../shared/validation";

// ---- Input ----

const reassessPracticeAttemptSchema = z.object({
  recordingAttempt: z.string().min(1, "録音試行IDは空にできません"),
  analysisMode: z.enum(["cloud_only", "oss_worker_only", "comparison"]),
});

export type ReassessPracticeAttemptInput = z.infer<typeof reassessPracticeAttemptSchema>;

// ---- Output ----

export type ReassessPracticeAttemptOutput = Readonly<{
  analysisRun: Readonly<{
    identifier: string;
    mode: string;
    createdAt: string;
  }>;
  analysisJobs: ReadonlyArray<
    Readonly<{
      identifier: string;
      engine: string;
      state: "queued";
    }>
  >;
  events: NonEmptyList<AnalysisRunStarted | AnalysisJobQueued>;
}>;

// ---- Dependencies ----

export type ReassessPracticeAttemptDependencies = Readonly<{
  recordingAttemptRepository: RecordingAttemptRepository;
  analysisRunRepository: AnalysisRunRepository;
  analysisJobRepository: AnalysisJobRepository;
  transactionManager: TransactionManager;
  entropyProvider: EntropyProvider;
  clock: Clock;
  logger: Logger;
}>;

// ---- Implementation ----

export const createReassessPracticeAttempt =
  (dependencies: ReassessPracticeAttemptDependencies) =>
  (
    input: ReassessPracticeAttemptInput,
  ): ResultAsync<ReassessPracticeAttemptOutput, DomainError> => {
    const parsedInput = parseInput(reassessPracticeAttemptSchema, input);
    if (parsedInput.isErr()) {
      return errAsync(parsedInput.error);
    }
    const parsed = parsedInput.value;

    const recordingAttemptIdentifier = createRecordingAttemptIdentifier(parsed.recordingAttempt);
    if (!recordingAttemptIdentifier) {
      return errAsync(validationFailed("recordingAttempt", "不正な録音試行IDです"));
    }

    // Ready RecordingAttempt のみ対象
    return dependencies.recordingAttemptRepository
      .find(recordingAttemptIdentifier)
      .andThen((recordingAttempt) => {
        const now = dependencies.clock.now();
        const { analysisMode } = parsed;

        return dependencies.transactionManager.execute(() => {
          const analysisRunRawId = dependencies.entropyProvider.generateUlid();
          const analysisRunIdentifier = createAnalysisRunIdentifier(analysisRunRawId);
          if (!analysisRunIdentifier) {
            return errAsync(validationFailed("analysisRunIdentifier", "ULID 生成に失敗しました"));
          }

          const mode: AnalysisMode = analysisMode;
          const { analysisRun, events: runEvents } = createAnalysisRun({
            identifier: analysisRunIdentifier,
            recordingAttempt: recordingAttempt.identifier,
            mode,
            now,
          });

          const engines: EngineType[] =
            analysisMode === "cloud_only"
              ? ["cloud"]
              : analysisMode === "oss_worker_only"
                ? ["oss_worker"]
                : ["cloud", "oss_worker"];

          type JobCreateResult = {
            analysisJob: ReturnType<typeof createAnalysisJob>["analysisJob"];
            events: ReturnType<typeof createAnalysisJob>["events"];
          };

          const jobCreations: JobCreateResult[] = [];
          for (const engine of engines) {
            const jobRawId = dependencies.entropyProvider.generateUlid();
            const jobIdentifier = createAnalysisJobIdentifier(jobRawId);
            if (!jobIdentifier) {
              return errAsync(validationFailed("analysisJobIdentifier", "ULID 生成に失敗しました"));
            }
            jobCreations.push(
              createAnalysisJob({
                identifier: jobIdentifier,
                analysisRun: analysisRunIdentifier,
                engine,
                engineConfigJson: "{}",
                now,
              }),
            );
          }

          const persistJobs = (index: number): ResultAsync<void, DomainError> => {
            if (index >= jobCreations.length) return okAsync(undefined);
            return dependencies.analysisJobRepository
              .persist(jobCreations[index].analysisJob)
              .andThen(() => persistJobs(index + 1));
          };

          return dependencies.analysisRunRepository
            .persist(analysisRun)
            .andThen(() => persistJobs(0))
            .map(() => {
              dependencies.logger.info("reassessPracticeAttempt: created", {
                recordingAttemptIdentifier: recordingAttempt.identifier as string,
                analysisRunIdentifier: analysisRunIdentifier as string,
              });

              const allJobQueued = jobCreations.flatMap((r) => [...r.events]);
              const allEvents = [...runEvents, ...allJobQueued] as NonEmptyList<
                AnalysisRunStarted | AnalysisJobQueued
              >;

              return {
                analysisRun: {
                  identifier: analysisRun.identifier as string,
                  mode: analysisRun.mode,
                  createdAt: analysisRun.createdAt.toISOString(),
                },
                analysisJobs: jobCreations.map((r) => ({
                  identifier: r.analysisJob.identifier as string,
                  engine: r.analysisJob.engine,
                  state: "queued" as const,
                })),
                events: allEvents,
              } satisfies ReassessPracticeAttemptOutput;
            });
        });
      });
  };
