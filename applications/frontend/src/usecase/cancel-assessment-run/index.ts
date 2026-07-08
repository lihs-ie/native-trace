import { type ResultAsync, errAsync } from "neverthrow";
import { z } from "zod";
import {
  type DomainError,
  type NonEmptyList,
  validationFailed,
  createNonEmptyList,
} from "../../domain/shared";
import { createAnalysisRunIdentifier } from "../../domain/analysis-run";
import {
  cancelAnalysisJob,
  type CanceledAnalysisJob,
  type AnalysisJobCanceled,
} from "../../domain/analysis-job";
import { type AnalysisRunRepository } from "../port/analysis-run-repository";
import { type AnalysisJobRepository } from "../port/analysis-job-repository";
import { type TransactionManager } from "../port/transaction-manager";
import { type Clock } from "../port/clock";
import { type Logger } from "../port/logger";
import { parseInput } from "../shared/validation";
import { traverseSequentially } from "../shared/traverse";
import { finalizeAnalysisRunStatus } from "../shared/analysis-run-status";

// ---- Input ----

const cancelAssessmentRunSchema = z.object({
  analysisRun: z.string().min(1, "解析実行IDは空にできません"),
});

export type CancelAssessmentRunInput = z.infer<typeof cancelAssessmentRunSchema>;

// ---- Output ----

export type CancelAssessmentRunOutput = Readonly<{
  analysisRun: Readonly<{
    identifier: string;
    status: string;
  }>;
  canceledJobs: ReadonlyArray<
    Readonly<{
      identifier: string;
      engine: string;
      canceledAt: string;
    }>
  >;
  events: NonEmptyList<AnalysisJobCanceled>;
}>;

// ---- Dependencies ----

export type CancelAssessmentRunDependencies = Readonly<{
  analysisRunRepository: AnalysisRunRepository;
  analysisJobRepository: AnalysisJobRepository;
  transactionManager: TransactionManager;
  clock: Clock;
  logger: Logger;
}>;

// ---- Implementation ----

const persistCanceledJobs = (
  repository: AnalysisJobRepository,
  jobs: CanceledAnalysisJob[],
): ResultAsync<void, DomainError> =>
  traverseSequentially(jobs, (job) => repository.persist(job)).map(() => undefined);

export const createCancelAssessmentRun =
  (dependencies: CancelAssessmentRunDependencies) =>
  (input: CancelAssessmentRunInput): ResultAsync<CancelAssessmentRunOutput, DomainError> => {
    const parsedInput = parseInput(cancelAssessmentRunSchema, input);
    if (parsedInput.isErr()) {
      return errAsync(parsedInput.error);
    }
    const parsed = parsedInput.value;

    const analysisRunIdentifier = createAnalysisRunIdentifier(parsed.analysisRun);
    if (!analysisRunIdentifier) {
      return errAsync(validationFailed("analysisRun", "不正な解析実行IDです"));
    }

    return dependencies.transactionManager.execute(() =>
      dependencies.analysisRunRepository.find(analysisRunIdentifier).andThen(() =>
        dependencies.analysisJobRepository
          .search({
            type: "jobsByAnalysisRun",
            analysisRun: analysisRunIdentifier,
          })
          .andThen((jobPage) => {
            const now = dependencies.clock.now();
            const allJobs = [...jobPage.items];

            // 未完了 Job のみ cancelAnalysisJob
            const canceledEntries: { job: CanceledAnalysisJob; event: AnalysisJobCanceled }[] = [];
            for (const job of allJobs) {
              if (job.type === "queued" || job.type === "leased" || job.type === "running") {
                const { analysisJob: canceledJob, events } = cancelAnalysisJob(job, now);
                canceledEntries.push({ job: canceledJob, event: events[0] });
              }
            }

            if (canceledEntries.length === 0) {
              return errAsync(
                validationFailed("analysisRun", "キャンセルできる未完了ジョブがありません"),
              );
            }

            const canceledJobs = canceledEntries.map((e) => e.job);

            return persistCanceledJobs(dependencies.analysisJobRepository, canceledJobs).andThen(
              () => {
                // 全 Job を更新後の状態で再収集して deriveAnalysisRunStatus を再計算
                const updatedJobs = allJobs.map((job) => {
                  const canceledEntry = canceledEntries.find(
                    (c) => c.job.identifier === job.identifier,
                  );
                  return canceledEntry ? canceledEntry.job : job;
                });

                return finalizeAnalysisRunStatus(
                  dependencies.analysisRunRepository,
                  analysisRunIdentifier,
                  updatedJobs,
                  "canceled",
                ).map((newStatus) => {
                  dependencies.logger.info("cancelAssessmentRun: canceled", {
                    analysisRunIdentifier: analysisRunIdentifier as string,
                    canceledCount: canceledEntries.length,
                    newStatus,
                  });

                  const events = canceledEntries.map((r) => r.event);
                  const nonEmptyEvents = createNonEmptyList(events)!;

                  return {
                    analysisRun: {
                      identifier: analysisRunIdentifier as string,
                      status: newStatus,
                    },
                    canceledJobs: canceledEntries.map((r) => ({
                      identifier: r.job.identifier as string,
                      engine: r.job.engine,
                      canceledAt: r.job.canceledAt.toISOString(),
                    })),
                    events: nonEmptyEvents,
                  } satisfies CancelAssessmentRunOutput;
                });
              },
            );
          }),
      ),
    );
  };
