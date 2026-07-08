import { inArray, asc } from "drizzle-orm";
import { type DrizzleDatabase } from "../client";
import { recordingAttempts, analysisRuns, analysisJobs, assessmentResults } from "../schema";

/**
 * assessment_results 1 件分のスコアと発生時刻。
 * 呼び出し側（library-stats / material-detail-stats）が section 単位の結果を
 * material / series 単位へ group-by する際、createdAt 昇順のマージに使う。
 */
export type SectionScoreEntry = Readonly<{
  overallScore: number;
  createdAt: Date;
}>;

/** section 単位のスコア集計結果。 */
export type SectionScoreStats = Readonly<{
  bestScore: number | null;
  scoreHistory: ReadonlyArray<SectionScoreEntry>;
  lastPracticedAt: Date | null;
  attemptCount: number;
}>;

/**
 * recording_attempt → analysis_run → analysis_job → assessment_result の 5 段結合で
 * section 単位のスコア統計を収集する。
 *
 * library-stats-repository（material 単位で group-by）と
 * material-detail-stats-repository（series 単位で group-by）で共通の走査ロジック。
 * このヘルパー自体は section 単位の結果だけを返し、material / series への集約は
 * 呼び出し側に残す。
 *
 * ソフトデリートの非対称性（W10 特性テストの前提・finding F08）:
 * - recording_attempt.deletedAt は attemptCount / lastPracticedAt / bestScore / scoreHistory
 *   の全集計から連鎖除外する。
 * - analysis_run.deletedAt のみが立った場合は attemptCount / lastPracticedAt には残るが、
 *   bestScore / scoreHistory からは除外される。
 *   → attempt 系の集計と run→job→result 系の集計は独立したクエリのまま計算し、
 *     互いのフィルタを混ぜない（本関数内でもこの 2 系統を統合しない）。
 *
 * クエリの発行順・`inArray` の段数・JS フィルタ条件は元実装
 * （library-stats-repository.ts / material-detail-stats-repository.ts の W25 抽出前バージョン）
 * と同一に保つ（性能改善はしない）。
 */
export const collectScoresBySection = (
  database: DrizzleDatabase,
  sectionIdentifiers: ReadonlyArray<string>,
): ReadonlyMap<string, SectionScoreStats> => {
  const attemptCountBySection = new Map<string, number>();
  const lastPracticedAtBySection = new Map<string, Date>();
  const bestScoreBySection = new Map<string, number>();
  const scoreHistoryBySection = new Map<string, SectionScoreEntry[]>();

  if (sectionIdentifiers.length > 0) {
    // --- recording_attempts count + lastPracticedAt (section 単位) ---
    const attemptRows = database
      .select({
        identifier: recordingAttempts.identifier,
        section: recordingAttempts.section,
        status: recordingAttempts.status,
        deletedAt: recordingAttempts.deletedAt,
        createdAt: recordingAttempts.createdAt,
      })
      .from(recordingAttempts)
      .where(inArray(recordingAttempts.section, sectionIdentifiers))
      .all();

    for (const row of attemptRows) {
      if (row.deletedAt) continue;
      if (row.status !== "ready") continue;

      attemptCountBySection.set(row.section, (attemptCountBySection.get(row.section) ?? 0) + 1);

      const attemptDate = new Date(row.createdAt);
      const existing = lastPracticedAtBySection.get(row.section);
      if (!existing || attemptDate > existing) {
        lastPracticedAtBySection.set(row.section, attemptDate);
      }
    }

    // --- assessment_results overall_score per section ---
    // recording_attempt → analysis_run → analysis_job → assessment_result の結合
    const readyAttemptRows = database
      .select({
        identifier: recordingAttempts.identifier,
        section: recordingAttempts.section,
        deletedAt: recordingAttempts.deletedAt,
        status: recordingAttempts.status,
      })
      .from(recordingAttempts)
      .where(inArray(recordingAttempts.section, sectionIdentifiers))
      .all()
      .filter((r) => !r.deletedAt && r.status === "ready");

    if (readyAttemptRows.length > 0) {
      const attemptIdentifiers = readyAttemptRows.map((r) => r.identifier);

      // attempt → section map
      const attemptToSectionMap = new Map<string, string>();
      for (const row of readyAttemptRows) {
        attemptToSectionMap.set(row.identifier, row.section);
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

        // run → section map (via attempt)
        const runToSectionMap = new Map<string, string>();
        for (const row of runRows) {
          const sectionId = attemptToSectionMap.get(row.recordingAttempt);
          if (sectionId) {
            runToSectionMap.set(row.identifier, sectionId);
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

          // job → section map (via run)
          const jobToSectionMap = new Map<string, string>();
          for (const row of jobRows) {
            const sectionId = runToSectionMap.get(row.analysisRun);
            if (sectionId) {
              jobToSectionMap.set(row.identifier, sectionId);
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
            const sectionId = jobToSectionMap.get(row.analysisJob);
            if (!sectionId) continue;

            const currentBest = bestScoreBySection.get(sectionId) ?? -Infinity;
            if (row.overallScore > currentBest) {
              bestScoreBySection.set(sectionId, row.overallScore);
            }

            const history = scoreHistoryBySection.get(sectionId) ?? [];
            history.push({ overallScore: row.overallScore, createdAt: new Date(row.createdAt) });
            scoreHistoryBySection.set(sectionId, history);
          }
        }
      }
    }
  }

  const resultMap = new Map<string, SectionScoreStats>();
  for (const sectionId of sectionIdentifiers) {
    resultMap.set(sectionId, {
      bestScore: bestScoreBySection.has(sectionId)
        ? (bestScoreBySection.get(sectionId) as number)
        : null,
      scoreHistory: scoreHistoryBySection.get(sectionId) ?? [],
      lastPracticedAt: lastPracticedAtBySection.get(sectionId) ?? null,
      attemptCount: attemptCountBySection.get(sectionId) ?? 0,
    });
  }

  return resultMap;
};
