import { type ResultAsync, errAsync, okAsync } from "neverthrow";
import { type DomainError, validationFailed } from "../../domain/shared";
import { type SectionIdentifier } from "../../domain/section";
import {
  type AssessmentResultIdentifier,
  createAssessmentResultIdentifier,
} from "../../domain/assessment-result";
import { type SectionRepository } from "../port/section-repository";
import { type RecordingAttemptRepository } from "../port/recording-attempt-repository";
import { type AnalysisRunRepository } from "../port/analysis-run-repository";
import { type AnalysisJobRepository } from "../port/analysis-job-repository";
import { type AssessmentResultRepository } from "../port/assessment-result-repository";
import { singleItemPage } from "./pagination";

// ---- Dependencies ----

export type FindingResolutionDependencies = Readonly<{
  sectionRepository: SectionRepository;
  recordingAttemptRepository: RecordingAttemptRepository;
  analysisRunRepository: AnalysisRunRepository;
  analysisJobRepository: AnalysisJobRepository;
  assessmentResultRepository: AssessmentResultRepository;
}>;

/**
 * dismiss-finding / restore-finding 共通の解決チェーン。
 * section→最新 ready attempt→最新 run→succeeded jobs→results→対象 finding の順に解決し、
 * finding を含む assessment_result の識別子を返す。
 */
export const resolveAssessmentResultForFinding = (
  dependencies: FindingResolutionDependencies,
  sectionIdentifier: SectionIdentifier,
  findingIdentifier: string,
): ResultAsync<AssessmentResultIdentifier, DomainError> =>
  dependencies.sectionRepository
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
      // finding が含まれる assessment_result を特定する
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

      return okAsync(assessmentResultIdentifier);
    });
