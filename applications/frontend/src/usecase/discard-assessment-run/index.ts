import { type ResultAsync, errAsync } from "neverthrow";
import { z } from "zod";
import { type DomainError, validationFailed } from "../../domain/shared";
import { createAnalysisRunIdentifier } from "../../domain/analysis-run";
import { type AnalysisRunRepository } from "../port/analysis-run-repository";
import { type AnalysisJobRepository } from "../port/analysis-job-repository";
import { type TransactionManager } from "../port/transaction-manager";
import { type Clock } from "../port/clock";
import { type Logger } from "../port/logger";
import { parseInput } from "../shared/validation";
import { traverseSequentially } from "../shared/traverse";

// ---- Input ----

const discardAssessmentRunSchema = z.object({
  analysisRun: z.string().min(1, "解析実行IDは空にできません"),
});

export type DiscardAssessmentRunInput = z.infer<typeof discardAssessmentRunSchema>;

// ---- Output ----

export type DiscardAssessmentRunOutput = Readonly<{
  analysisRun: Readonly<{
    identifier: string;
    discarded: true;
  }>;
}>;

// ---- Dependencies ----

export type DiscardAssessmentRunDependencies = Readonly<{
  analysisRunRepository: AnalysisRunRepository;
  analysisJobRepository: AnalysisJobRepository;
  transactionManager: TransactionManager;
  clock: Clock;
  logger: Logger;
}>;

// ---- Implementation ----

export const createDiscardAssessmentRun =
  (dependencies: DiscardAssessmentRunDependencies) =>
  (input: DiscardAssessmentRunInput): ResultAsync<DiscardAssessmentRunOutput, DomainError> => {
    const parsedInput = parseInput(discardAssessmentRunSchema, input);
    if (parsedInput.isErr()) {
      return errAsync(parsedInput.error);
    }
    const parsed = parsedInput.value;

    const analysisRunIdentifier = createAnalysisRunIdentifier(parsed.analysisRun);
    if (!analysisRunIdentifier) {
      return errAsync(validationFailed("analysisRun", "不正な解析実行IDです"));
    }

    return dependencies.transactionManager.execute(() =>
      dependencies.analysisRunRepository.find(analysisRunIdentifier).andThen((analysisRun) => {
        // AnalysisRun を論理削除 status = "canceled" で通常表示から外す
        // MVP では updateStatus で "canceled" にすることで非表示扱いとする
        return dependencies.analysisRunRepository
          .updateStatus(analysisRunIdentifier, "canceled")
          .andThen(() =>
            // 配下 Job を search して canceled に
            dependencies.analysisJobRepository
              .search({
                type: "jobsByAnalysisRun",
                analysisRun: analysisRunIdentifier,
              })
              .andThen((jobPage) => {
                // 未完了ジョブのみ cancel（state フィルタと job 構築は呼び出し側の責務）
                const jobsToCancel = jobPage.items.filter(
                  (job) => job.type === "queued" || job.type === "leased" || job.type === "running",
                );
                const canceledJobs = jobsToCancel.map((job) => ({
                  type: "canceled" as const,
                  identifier: job.identifier,
                  analysisRun: job.analysisRun,
                  engine: job.engine,
                  engineConfigJson: job.engineConfigJson,
                  canceledAt: dependencies.clock.now(),
                  queuedAt: job.queuedAt,
                  createdAt: job.createdAt,
                }));

                return traverseSequentially(canceledJobs, (canceledJob) =>
                  dependencies.analysisJobRepository.persist(canceledJob),
                ).map(() => undefined);
              }),
          )
          .map(() => {
            dependencies.logger.info("discardAssessmentRun: discarded", {
              analysisRunIdentifier: analysisRun.identifier as string,
            });

            return {
              analysisRun: {
                identifier: analysisRun.identifier as string,
                discarded: true,
              },
            } satisfies DiscardAssessmentRunOutput;
          });
      }),
    );
  };
