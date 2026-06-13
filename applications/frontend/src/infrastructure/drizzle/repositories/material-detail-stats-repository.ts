import { inArray, asc } from "drizzle-orm";
import { type DrizzleDatabase } from "../client";
import {
  type MaterialDetailStatsRepository,
  type SectionSeriesStats,
} from "../../../usecase/port/material-detail-stats-repository";
import { type DomainError } from "../../../domain/shared";
import { okAsync, errAsync } from "neverthrow";
import {
  sections,
  recordingAttempts,
  analysisRuns,
  analysisJobs,
  assessmentResults,
} from "../schema";

/**
 * テキストのワード数をスペース区切りで数える。
 * 空文字や null は 0 を返す。
 */
const countWords = (text: string): number => {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
};

export const createDrizzleMaterialDetailStatsRepository = (
  database: DrizzleDatabase,
): MaterialDetailStatsRepository => ({
  findStatsBySectionSeries: (
    sectionSeriesIdentifiers: ReadonlyArray<string>,
    latestBodyTextBySeries: ReadonlyMap<string, string>,
  ) => {
    return okAsync(null).andThen(() => {
      try {
        if (sectionSeriesIdentifiers.length === 0) {
          return okAsync(new Map<string, SectionSeriesStats>());
        }

        const identifiers = [...sectionSeriesIdentifiers];

        // --- 1. active sections per series ---
        const allSectionRows =
          identifiers.length > 0
            ? database
                .select({
                  identifier: sections.identifier,
                  sectionSeries: sections.sectionSeries,
                  deletedAt: sections.deletedAt,
                })
                .from(sections)
                .where(inArray(sections.sectionSeries, identifiers))
                .all()
            : [];

        const activeSectionIdentifiers = allSectionRows
          .filter((row) => !row.deletedAt)
          .map((row) => row.identifier);

        // section → series マッピング
        const sectionToSeriesMap = new Map<string, string>();
        for (const row of allSectionRows) {
          if (!row.deletedAt) {
            sectionToSeriesMap.set(row.identifier, row.sectionSeries);
          }
        }

        // --- 2. recording_attempts count per series ---
        const recordingAttemptCountBySeries = new Map<string, number>();

        if (activeSectionIdentifiers.length > 0) {
          const attemptRows = database
            .select({
              identifier: recordingAttempts.identifier,
              section: recordingAttempts.section,
              status: recordingAttempts.status,
              deletedAt: recordingAttempts.deletedAt,
            })
            .from(recordingAttempts)
            .where(inArray(recordingAttempts.section, activeSectionIdentifiers))
            .all();

          for (const row of attemptRows) {
            if (row.deletedAt) continue;
            if (row.status !== "ready") continue;

            const seriesId = sectionToSeriesMap.get(row.section);
            if (!seriesId) continue;

            recordingAttemptCountBySeries.set(
              seriesId,
              (recordingAttemptCountBySeries.get(seriesId) ?? 0) + 1,
            );
          }
        }

        // --- 3. assessment_results overall_score per series ---
        const bestScoreBySeries = new Map<string, number>();
        const scoreHistoryBySeries = new Map<string, number[]>();

        if (activeSectionIdentifiers.length > 0) {
          const readyAttemptRows = database
            .select({
              identifier: recordingAttempts.identifier,
              section: recordingAttempts.section,
              deletedAt: recordingAttempts.deletedAt,
              status: recordingAttempts.status,
            })
            .from(recordingAttempts)
            .where(inArray(recordingAttempts.section, activeSectionIdentifiers))
            .all()
            .filter((row) => !row.deletedAt && row.status === "ready");

          if (readyAttemptRows.length > 0) {
            const attemptIdentifiers = readyAttemptRows.map((row) => row.identifier);

            // attempt → series map
            const attemptToSeriesMap = new Map<string, string>();
            for (const row of readyAttemptRows) {
              const seriesId = sectionToSeriesMap.get(row.section);
              if (seriesId) {
                attemptToSeriesMap.set(row.identifier, seriesId);
              }
            }

            // analysis_runs
            const runRows = database
              .select({
                identifier: analysisRuns.identifier,
                recordingAttempt: analysisRuns.recordingAttempt,
                deletedAt: analysisRuns.deletedAt,
              })
              .from(analysisRuns)
              .where(inArray(analysisRuns.recordingAttempt, attemptIdentifiers))
              .all()
              .filter((row) => !row.deletedAt);

            if (runRows.length > 0) {
              const runIdentifiers = runRows.map((row) => row.identifier);

              // run → series map (via attempt)
              const runToSeriesMap = new Map<string, string>();
              for (const row of runRows) {
                const seriesId = attemptToSeriesMap.get(row.recordingAttempt);
                if (seriesId) {
                  runToSeriesMap.set(row.identifier, seriesId);
                }
              }

              // analysis_jobs
              const jobRows = database
                .select({
                  identifier: analysisJobs.identifier,
                  analysisRun: analysisJobs.analysisRun,
                  deletedAt: analysisJobs.deletedAt,
                })
                .from(analysisJobs)
                .where(inArray(analysisJobs.analysisRun, runIdentifiers))
                .all()
                .filter((row) => !row.deletedAt);

              if (jobRows.length > 0) {
                const jobIdentifiers = jobRows.map((row) => row.identifier);

                // job → series map (via run)
                const jobToSeriesMap = new Map<string, string>();
                for (const row of jobRows) {
                  const seriesId = runToSeriesMap.get(row.analysisRun);
                  if (seriesId) {
                    jobToSeriesMap.set(row.identifier, seriesId);
                  }
                }

                // assessment_results ordered by createdAt asc for history
                const resultRows = database
                  .select({
                    analysisJob: assessmentResults.analysisJob,
                    overallScore: assessmentResults.overallScore,
                    deletedAt: assessmentResults.deletedAt,
                    createdAt: assessmentResults.createdAt,
                  })
                  .from(assessmentResults)
                  .where(inArray(assessmentResults.analysisJob, jobIdentifiers))
                  .orderBy(asc(assessmentResults.createdAt))
                  .all()
                  .filter((row) => !row.deletedAt);

                for (const row of resultRows) {
                  const seriesId = jobToSeriesMap.get(row.analysisJob);
                  if (!seriesId) continue;

                  const currentBest = bestScoreBySeries.get(seriesId) ?? -Infinity;
                  if (row.overallScore > currentBest) {
                    bestScoreBySeries.set(seriesId, row.overallScore);
                  }

                  const history = scoreHistoryBySeries.get(seriesId) ?? [];
                  history.push(row.overallScore);
                  scoreHistoryBySeries.set(seriesId, history);
                }
              }
            }
          }
        }

        // --- 4. 組み立て ---
        const resultMap = new Map<string, SectionSeriesStats>();
        for (const seriesId of identifiers) {
          const attemptCount = recordingAttemptCountBySeries.get(seriesId) ?? 0;
          const bestScore = bestScoreBySeries.has(seriesId)
            ? (bestScoreBySeries.get(seriesId) as number)
            : null;
          const scoreHistory = scoreHistoryBySeries.get(seriesId) ?? [];
          const bodyText = latestBodyTextBySeries.get(seriesId);
          const wordCount = bodyText !== undefined ? countWords(bodyText) : null;

          resultMap.set(seriesId, {
            sectionSeriesIdentifier: seriesId,
            wordCount,
            recordingAttemptCount: attemptCount,
            bestOverallScore: bestScore,
            overallScoreHistory: scoreHistory,
          });
        }

        return okAsync(resultMap as ReadonlyMap<string, SectionSeriesStats>);
      } catch (error) {
        return errAsync({ type: "persistenceFailed", reason: String(error) } as DomainError);
      }
    });
  },
});
