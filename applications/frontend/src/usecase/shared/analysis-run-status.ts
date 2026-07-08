import { type ResultAsync } from "neverthrow";
import { type DomainError, createNonEmptyList } from "../../domain/shared";
import {
  type AnalysisRunIdentifier,
  type AnalysisRunStatus,
  deriveAnalysisRunStatus,
} from "../../domain/analysis-run";
import { type AnalysisJob } from "../../domain/analysis-job";
import { type AnalysisJobRepository } from "../port/analysis-job-repository";
import { type AnalysisRunRepository } from "../port/analysis-run-repository";

/**
 * Job 一覧から AnalysisRun の状態を再導出して永続化する（共通の末尾処理）。
 * 空リスト時の fallback は呼び出し側ごとに異なるため引数でそのまま受け取る（値の統一はしない）。
 * 呼び出し側がログ出力や出力 DTO 組み立てに使えるよう、確定した新 status を解決値として返す。
 */
export const finalizeAnalysisRunStatus = (
  analysisRunRepository: AnalysisRunRepository,
  analysisRun: AnalysisRunIdentifier,
  jobs: ReadonlyArray<AnalysisJob>,
  emptyFallback: AnalysisRunStatus,
): ResultAsync<AnalysisRunStatus, DomainError> => {
  const nonEmpty = createNonEmptyList(jobs);
  const newStatus = nonEmpty ? deriveAnalysisRunStatus(nonEmpty) : emptyFallback;
  return analysisRunRepository.updateStatus(analysisRun, newStatus).map(() => newStatus);
};

/**
 * 「兄弟 job を再取得 → 更新 job を差し替え → deriveAnalysisRunStatus → updateStatus」の共通形。
 * run-assessment-job の retry / fail / succeed の 3 箇所で使う（単一の更新済み Job を
 * 兄弟一覧に差し替えてから再計算するパターン）。
 */
export const recomputeAnalysisRunStatus = (
  analysisJobRepository: AnalysisJobRepository,
  analysisRunRepository: AnalysisRunRepository,
  updatedJob: AnalysisJob,
  emptyFallback: AnalysisRunStatus,
): ResultAsync<AnalysisRunStatus, DomainError> =>
  analysisJobRepository
    .search({ type: "jobsByAnalysisRun", analysisRun: updatedJob.analysisRun })
    .andThen((jobPage) => {
      const allJobs = jobPage.items.map((job) =>
        job.identifier === updatedJob.identifier ? updatedJob : job,
      );
      return finalizeAnalysisRunStatus(
        analysisRunRepository,
        updatedJob.analysisRun,
        allJobs,
        emptyFallback,
      );
    });
