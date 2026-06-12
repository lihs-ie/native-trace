import { type ResultAsync, errAsync, okAsync } from "neverthrow";
import { z } from "zod";
import { type DomainError, validationFailed } from "../../domain/shared";
import { createSectionIdentifier } from "../../domain/section";
import { createAssessmentResultIdentifier } from "../../domain/assessment-result";
import { type SectionRepository } from "../port/section-repository";
import { type RecordingAttemptRepository } from "../port/recording-attempt-repository";
import { type AnalysisRunRepository } from "../port/analysis-run-repository";
import { type AnalysisJobRepository } from "../port/analysis-job-repository";
import { type AssessmentResultRepository } from "../port/assessment-result-repository";
import { type FindingDismissalRepository } from "../port/finding-dismissal-repository";
import { type EntropyProvider } from "../port/entropy-provider";
import { type Clock } from "../port/clock";

// ---- Input ----

const dismissFindingSchema = z.object({
  section: z.string().min(1, "セクションIDは空にできません"),
  finding: z.string().min(1, "finding IDは空にできません"),
  reason: z.string().nullable().optional(),
});

export type DismissFindingInput = z.infer<typeof dismissFindingSchema>;

// ---- Output ----

export type DismissFindingOutput = Readonly<{
  dismissalIdentifier: string;
  assessmentResult: string;
  findingIdentifier: string;
  dismissedAt: number;
}>;

// ---- Dependencies ----

export type DismissFindingDependencies = Readonly<{
  sectionRepository: SectionRepository;
  recordingAttemptRepository: RecordingAttemptRepository;
  analysisRunRepository: AnalysisRunRepository;
  analysisJobRepository: AnalysisJobRepository;
  assessmentResultRepository: AssessmentResultRepository;
  findingDismissalRepository: FindingDismissalRepository;
  entropyProvider: EntropyProvider;
  clock: Clock;
}>;

// ---- Implementation ----

/**
 * 指定セクションの最新解析結果内の finding を却下として記録する。
 * 既に却下済みの場合は成功として扱う（冪等）。
 */
export const createDismissFinding =
  (dependencies: DismissFindingDependencies) =>
  (input: DismissFindingInput): ResultAsync<DismissFindingOutput, DomainError> => {
    const parsed = dismissFindingSchema.safeParse(input);
    if (!parsed.success) {
      return errAsync(
        validationFailed("input", parsed.error.errors.map((e) => e.message).join(", ")),
      );
    }

    const sectionIdentifier = createSectionIdentifier(parsed.data.section);
    if (!sectionIdentifier) {
      return errAsync(validationFailed("section", "不正なセクションIDです"));
    }

    const findingIdentifier = parsed.data.finding;
    const reason = parsed.data.reason ?? null;

    return dependencies.sectionRepository
      .find(sectionIdentifier)
      .andThen(() =>
        dependencies.recordingAttemptRepository.search({
          type: "attemptsInSection",
          section: sectionIdentifier,
          pagination: { type: "offset", offset: 0 as never, limit: 1 as never },
          sort: "createdAt_desc",
        }),
      )
      .andThen((recordingPage) => {
        const latestReady = recordingPage.items.find((a) => a.type === "ready");
        if (!latestReady) {
          return errAsync(
            validationFailed("section", "解析済みの録音試行が見つかりません"),
          );
        }
        return dependencies.analysisRunRepository.search({
          type: "runsByRecordingAttempt",
          recordingAttempt: latestReady.identifier,
          pagination: { type: "offset", offset: 0 as never, limit: 1 as never },
          sort: "createdAt_desc",
        });
      })
      .andThen((runPage) => {
        const latestRun = runPage.items[0] ?? null;
        if (!latestRun) {
          return errAsync(validationFailed("section", "解析実行が見つかりません"));
        }
        return dependencies.analysisJobRepository.search({
          type: "jobsByAnalysisRun",
          analysisRun: latestRun.identifier,
        });
      })
      .andThen((jobPage) => {
        const succeededJobs = jobPage.items.filter((j) => j.type === "succeeded");
        if (succeededJobs.length === 0) {
          return errAsync(validationFailed("section", "成功済み解析ジョブが見つかりません"));
        }
        return dependencies.assessmentResultRepository.search({
          type: "resultsByJobs",
          jobs: succeededJobs.map((j) => j.identifier),
        });
      })
      .andThen((resultPage) => {
        // finding が含まれる assessment_result を特定する
        const matchingResult = resultPage.items.find((r) =>
          r.findings.some((f) => String(f.identifier) === findingIdentifier),
        );
        if (!matchingResult) {
          return errAsync(
            validationFailed("finding", "指定された finding が見つかりません"),
          );
        }

        const assessmentResultIdentifier = createAssessmentResultIdentifier(
          String(matchingResult.identifier),
        );
        if (!assessmentResultIdentifier) {
          return errAsync(validationFailed("finding", "不正な assessment_result IDです"));
        }

        // 既に active 却下があれば冪等に成功を返す
        return dependencies.findingDismissalRepository
          .findActiveDismissedIdentifiers(assessmentResultIdentifier)
          .andThen((activeDismissed) => {
            const now = dependencies.clock.now();
            const dismissedAtMs = now.getTime();

            if (activeDismissed.has(findingIdentifier)) {
              // 冪等: 既存の却下をそのまま返す
              return okAsync({
                dismissalIdentifier: "",
                assessmentResult: String(assessmentResultIdentifier),
                findingIdentifier,
                dismissedAt: dismissedAtMs,
              } satisfies DismissFindingOutput);
            }

            const dismissalIdentifier = dependencies.entropyProvider.generateUlid();

            return dependencies.findingDismissalRepository
              .record({
                identifier: dismissalIdentifier,
                assessmentResult: assessmentResultIdentifier,
                findingIdentifier,
                dismissedAt: dismissedAtMs,
                reason,
              })
              .map(() => ({
                dismissalIdentifier,
                assessmentResult: String(assessmentResultIdentifier),
                findingIdentifier,
                dismissedAt: dismissedAtMs,
              }));
          });
      });
  };
