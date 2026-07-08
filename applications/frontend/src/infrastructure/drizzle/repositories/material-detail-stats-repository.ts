import { inArray } from "drizzle-orm";
import { type DrizzleDatabase } from "../client";
import {
  type MaterialDetailStatsRepository,
  type SectionSeriesStats,
} from "../../../usecase/port/material-detail-stats-repository";
import { type DomainError } from "../../../domain/shared";
import { okAsync, errAsync } from "neverthrow";
import { sections } from "../schema";
import {
  collectScoresBySection,
  type SectionScoreEntry,
  type SectionScoreStats,
} from "./section-score-traversal";

/**
 * テキストのワード数をスペース区切りで数える。
 * 空文字や null は 0 を返す。
 */
const countWords = (text: string): number => {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
};

type SectionsToSeriesResult = Readonly<{
  activeSectionIdentifiers: ReadonlyArray<string>;
  sectionToSeriesMap: ReadonlyMap<string, string>;
}>;

/** section_series 配下の active sections を読み込み、section→series マッピングを作る。 */
const mapSectionsToSeries = (
  database: DrizzleDatabase,
  sectionSeriesIdentifiers: ReadonlyArray<string>,
): SectionsToSeriesResult => {
  // --- 1. active sections per series ---
  const allSectionRows =
    sectionSeriesIdentifiers.length > 0
      ? database
          .select({
            identifier: sections.identifier,
            sectionSeries: sections.sectionSeries,
            deletedAt: sections.deletedAt,
          })
          .from(sections)
          .where(inArray(sections.sectionSeries, sectionSeriesIdentifiers))
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

  return { activeSectionIdentifiers, sectionToSeriesMap };
};

/**
 * section 単位のスコア履歴エントリを createdAt 昇順にマージする。
 * 1 series が複数 section にまたがる場合でも、port の契約
 * （overallScoreHistory は createdAt 昇順）を満たすために使う。
 */
const mergeScoreHistoryByCreatedAt = (
  entries: ReadonlyArray<SectionScoreEntry>,
): ReadonlyArray<number> =>
  [...entries]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((entry) => entry.overallScore);

/** section 単位の集計結果を series 単位に group-by して SectionSeriesStats を組み立てる。 */
const assembleStats = (
  sectionSeriesIdentifiers: ReadonlyArray<string>,
  activeSectionIdentifiers: ReadonlyArray<string>,
  sectionToSeriesMap: ReadonlyMap<string, string>,
  sectionScores: ReadonlyMap<string, SectionScoreStats>,
  latestBodyTextBySeries: ReadonlyMap<string, string>,
): ReadonlyMap<string, SectionSeriesStats> => {
  const attemptCountBySeries = new Map<string, number>();
  const bestScoreBySeries = new Map<string, number>();
  const scoreEntriesBySeries = new Map<string, SectionScoreEntry[]>();

  for (const sectionId of activeSectionIdentifiers) {
    const seriesId = sectionToSeriesMap.get(sectionId);
    if (!seriesId) continue;

    const stats = sectionScores.get(sectionId);
    if (!stats) continue;

    attemptCountBySeries.set(
      seriesId,
      (attemptCountBySeries.get(seriesId) ?? 0) + stats.attemptCount,
    );

    if (stats.bestScore !== null) {
      const currentBest = bestScoreBySeries.get(seriesId) ?? -Infinity;
      if (stats.bestScore > currentBest) {
        bestScoreBySeries.set(seriesId, stats.bestScore);
      }
    }

    const entries = scoreEntriesBySeries.get(seriesId) ?? [];
    entries.push(...stats.scoreHistory);
    scoreEntriesBySeries.set(seriesId, entries);
  }

  // --- 組み立て ---
  const resultMap = new Map<string, SectionSeriesStats>();
  for (const seriesId of sectionSeriesIdentifiers) {
    const attemptCount = attemptCountBySeries.get(seriesId) ?? 0;
    const bestScore = bestScoreBySeries.has(seriesId)
      ? (bestScoreBySeries.get(seriesId) as number)
      : null;
    const scoreHistory = mergeScoreHistoryByCreatedAt(scoreEntriesBySeries.get(seriesId) ?? []);
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

  return resultMap;
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

        const { activeSectionIdentifiers, sectionToSeriesMap } = mapSectionsToSeries(
          database,
          identifiers,
        );

        const sectionScores = collectScoresBySection(database, activeSectionIdentifiers);

        const resultMap = assembleStats(
          identifiers,
          activeSectionIdentifiers,
          sectionToSeriesMap,
          sectionScores,
          latestBodyTextBySeries,
        );

        return okAsync(resultMap as ReadonlyMap<string, SectionSeriesStats>);
      } catch (error) {
        return errAsync({ type: "persistenceFailed", reason: String(error) } as DomainError);
      }
    });
  },
});
