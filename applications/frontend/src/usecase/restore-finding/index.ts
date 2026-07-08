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
import { type Clock } from "../port/clock";
import { singleItemPage } from "../shared/pagination";
import { parseInput } from "../shared/validation";

// ---- Input ----

const restoreFindingSchema = z.object({
  section: z.string().min(1, "セクションIDは空にできません"),
  finding: z.string().min(1, "finding IDは空にできません"),
});

export type RestoreFindingInput = z.infer<typeof restoreFindingSchema>;

// ---- Output ----

export type RestoreFindingOutput = Readonly<{
  assessmentResult: string;
  findingIdentifier: string;
  undoneAt: number;
}>;

// ---- Dependencies ----

export type RestoreFindingDependencies = Readonly<{
  sectionRepository: SectionRepository;
  recordingAttemptRepository: RecordingAttemptRepository;
  analysisRunRepository: AnalysisRunRepository;
  analysisJobRepository: AnalysisJobRepository;
  assessmentResultRepository: AssessmentResultRepository;
  findingDismissalRepository: FindingDismissalRepository;
  clock: Clock;
}>;

// ---- Implementation ----

/**
 * finding の却下を取り消す（undone_at を現在時刻で埋める）。
 * 却下レコードが存在しない場合も成功として扱う（冪等）。
 */
export const createRestoreFinding =
  (dependencies: RestoreFindingDependencies) =>
  (input: RestoreFindingInput): ResultAsync<RestoreFindingOutput, DomainError> => {
    const parsedInput = parseInput(restoreFindingSchema, input);
    if (parsedInput.isErr()) {
      return errAsync(parsedInput.error);
    }
    const parsed = parsedInput.value;

    const sectionIdentifier = createSectionIdentifier(parsed.section);
    if (!sectionIdentifier) {
      return errAsync(validationFailed("section", "不正なセクションIDです"));
    }

    const findingIdentifier = parsed.finding;

    return dependencies.sectionRepository
      .find(sectionIdentifier)
      .andThen(() =>
        dependencies.recordingAttemptRepository.search({
          type: "attemptsInSection",
          section: sectionIdentifier,
          pagination: singleItemPage(),
          sort: "createdAt_desc",
        }),
      )
      .andThen((recordingPage) => {
        const latestReady = recordingPage.items.find((a) => a.type === "ready");
        if (!latestReady) {
          return errAsync(validationFailed("section", "解析済みの録音試行が見つかりません"));
        }
        return dependencies.analysisRunRepository.search({
          type: "runsByRecordingAttempt",
          recordingAttempt: latestReady.identifier,
          pagination: singleItemPage(),
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
        const matchingResult = resultPage.items.find((r) =>
          r.findings.some((f) => String(f.identifier) === findingIdentifier),
        );
        if (!matchingResult) {
          return errAsync(validationFailed("finding", "指定された finding が見つかりません"));
        }

        const assessmentResultIdentifier = createAssessmentResultIdentifier(
          String(matchingResult.identifier),
        );
        if (!assessmentResultIdentifier) {
          return errAsync(validationFailed("finding", "不正な assessment_result IDです"));
        }

        const now = dependencies.clock.now();
        const undoneAtMs = now.getTime();

        return dependencies.findingDismissalRepository
          .restore(assessmentResultIdentifier, findingIdentifier, undoneAtMs)
          .andThen(() =>
            okAsync({
              assessmentResult: String(assessmentResultIdentifier),
              findingIdentifier,
              undoneAt: undoneAtMs,
            } satisfies RestoreFindingOutput),
          );
      });
  };
