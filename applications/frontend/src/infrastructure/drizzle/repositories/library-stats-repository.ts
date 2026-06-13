import { inArray, asc } from "drizzle-orm";
import { type DrizzleDatabase } from "../client";
import {
  type LibraryStatsRepository,
  type MaterialStats,
} from "../../../usecase/port/library-stats-repository";
import { type DomainError } from "../../../domain/shared";
import { okAsync, errAsync } from "neverthrow";
import {
  sectionSeries,
  sections,
  recordingAttempts,
  analysisRuns,
  analysisJobs,
  assessmentResults,
} from "../schema";

export const createDrizzleLibraryStatsRepository = (
  database: DrizzleDatabase,
): LibraryStatsRepository => ({
  findStatsByMaterials: (materialIdentifiers: ReadonlyArray<string>) => {
    return okAsync(null).andThen(() => {
      try {
        if (materialIdentifiers.length === 0) {
          return okAsync(new Map<string, MaterialStats>());
        }

        const identifiers = [...materialIdentifiers];

        // --- 1. section_series per material (active = deletedAt IS NULL) ---
        const allSeriesDetailRows = database
          .select({
            identifier: sectionSeries.identifier,
            material: sectionSeries.material,
            deletedAt: sectionSeries.deletedAt,
          })
          .from(sectionSeries)
          .where(inArray(sectionSeries.material, identifiers))
          .all();

        // material ごとの active section_series 数
        const seriesCountByMaterial = new Map<string, number>();
        for (const row of allSeriesDetailRows) {
          if (!row.deletedAt) {
            seriesCountByMaterial.set(
              row.material,
              (seriesCountByMaterial.get(row.material) ?? 0) + 1,
            );
          }
        }

        // --- 2. active section_series の identifier を収集 ---
        const activeSeriesIdentifiers = allSeriesDetailRows
          .filter((r) => !r.deletedAt)
          .map((r) => r.identifier);

        // --- 3. active sections の identifier (series → sections) ---
        const allSectionRows =
          activeSeriesIdentifiers.length > 0
            ? database
                .select({
                  identifier: sections.identifier,
                  sectionSeries: sections.sectionSeries,
                  deletedAt: sections.deletedAt,
                })
                .from(sections)
                .where(inArray(sections.sectionSeries, activeSeriesIdentifiers))
                .all()
            : [];

        const activeSectionIdentifiers = allSectionRows
          .filter((r) => !r.deletedAt)
          .map((r) => r.identifier);

        // section → material のマッピング
        const sectionToSeriesMap = new Map<string, string>();
        for (const row of allSectionRows) {
          sectionToSeriesMap.set(row.identifier, row.sectionSeries);
        }

        // series → material マッピング
        const seriesToMaterialMap = new Map<string, string>();
        for (const row of allSeriesDetailRows) {
          seriesToMaterialMap.set(row.identifier, row.material);
        }

        const sectionToMaterialMap = new Map<string, string>();
        for (const [sectionId, seriesId] of sectionToSeriesMap) {
          const materialId = seriesToMaterialMap.get(seriesId);
          if (materialId) {
            sectionToMaterialMap.set(sectionId, materialId);
          }
        }

        // --- 4. recording_attempts count per material ---
        const recordingAttemptCountByMaterial = new Map<string, number>();
        const lastPracticedAtByMaterial = new Map<string, Date>();

        if (activeSectionIdentifiers.length > 0) {
          const attemptRows = database
            .select({
              identifier: recordingAttempts.identifier,
              section: recordingAttempts.section,
              status: recordingAttempts.status,
              deletedAt: recordingAttempts.deletedAt,
              createdAt: recordingAttempts.createdAt,
            })
            .from(recordingAttempts)
            .where(inArray(recordingAttempts.section, activeSectionIdentifiers))
            .all();

          for (const row of attemptRows) {
            if (row.deletedAt) continue;
            if (row.status !== "ready") continue;

            const materialId = sectionToMaterialMap.get(row.section);
            if (!materialId) continue;

            recordingAttemptCountByMaterial.set(
              materialId,
              (recordingAttemptCountByMaterial.get(materialId) ?? 0) + 1,
            );

            const attemptDate = new Date(row.createdAt);
            const existing = lastPracticedAtByMaterial.get(materialId);
            if (!existing || attemptDate > existing) {
              lastPracticedAtByMaterial.set(materialId, attemptDate);
            }
          }
        }

        // --- 5. assessment_results overall_score per material ---
        // recording_attempt → analysis_run → analysis_job → assessment_result の結合
        const bestScoreByMaterial = new Map<string, number>();
        const scoreHistoryByMaterial = new Map<string, number[]>();

        if (activeSectionIdentifiers.length > 0) {
          // recording_attempts (ready, not deleted)
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
            .filter((r) => !r.deletedAt && r.status === "ready");

          if (readyAttemptRows.length > 0) {
            const attemptIdentifiers = readyAttemptRows.map((r) => r.identifier);

            // attempt → material map
            const attemptToMaterialMap = new Map<string, string>();
            for (const row of readyAttemptRows) {
              const materialId = sectionToMaterialMap.get(row.section);
              if (materialId) {
                attemptToMaterialMap.set(row.identifier, materialId);
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
              .filter((r) => !r.deletedAt);

            if (runRows.length > 0) {
              const runIdentifiers = runRows.map((r) => r.identifier);

              // run → material map (via attempt)
              const runToMaterialMap = new Map<string, string>();
              for (const row of runRows) {
                const materialId = attemptToMaterialMap.get(row.recordingAttempt);
                if (materialId) {
                  runToMaterialMap.set(row.identifier, materialId);
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
                .filter((r) => !r.deletedAt);

              if (jobRows.length > 0) {
                const jobIdentifiers = jobRows.map((r) => r.identifier);

                // job → material map (via run)
                const jobToMaterialMap = new Map<string, string>();
                for (const row of jobRows) {
                  const materialId = runToMaterialMap.get(row.analysisRun);
                  if (materialId) {
                    jobToMaterialMap.set(row.identifier, materialId);
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
                  .filter((r) => !r.deletedAt);

                for (const row of resultRows) {
                  const materialId = jobToMaterialMap.get(row.analysisJob);
                  if (!materialId) continue;

                  const currentBest = bestScoreByMaterial.get(materialId) ?? -Infinity;
                  if (row.overallScore > currentBest) {
                    bestScoreByMaterial.set(materialId, row.overallScore);
                  }

                  const history = scoreHistoryByMaterial.get(materialId) ?? [];
                  history.push(row.overallScore);
                  scoreHistoryByMaterial.set(materialId, history);
                }
              }
            }
          }
        }

        // --- 6. 組み立て ---
        const resultMap = new Map<string, MaterialStats>();
        for (const materialId of identifiers) {
          const seriesCount = seriesCountByMaterial.get(materialId) ?? 0;
          const attemptCount = recordingAttemptCountByMaterial.get(materialId) ?? 0;
          const bestScore = bestScoreByMaterial.has(materialId)
            ? (bestScoreByMaterial.get(materialId) as number)
            : null;
          const scoreHistory = scoreHistoryByMaterial.get(materialId) ?? [];
          const lastPracticedAt = lastPracticedAtByMaterial.get(materialId) ?? null;

          resultMap.set(materialId, {
            sectionSeriesCount: seriesCount,
            recordingAttemptCount: attemptCount,
            bestOverallScore: bestScore,
            overallScoreHistory: scoreHistory,
            lastPracticedAt,
          });
        }

        return okAsync(resultMap as ReadonlyMap<string, MaterialStats>);
      } catch (e) {
        return errAsync({ type: "persistenceFailed", reason: String(e) } as DomainError);
      }
    });
  },
});
