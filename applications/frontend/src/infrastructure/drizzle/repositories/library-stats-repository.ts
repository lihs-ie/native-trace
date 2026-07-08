import { inArray } from "drizzle-orm";
import { type DrizzleDatabase } from "../client";
import {
  type LibraryStatsRepository,
  type MaterialStats,
} from "../../../usecase/port/library-stats-repository";
import { sectionSeries, sections } from "../schema";
import {
  collectScoresBySection,
  type SectionScoreEntry,
  type SectionScoreStats,
} from "./section-score-traversal";
import { tryPersistence } from "./try-persistence";

type ActiveSeriesResult = Readonly<{
  seriesCountByMaterial: ReadonlyMap<string, number>;
  activeSeriesIdentifiers: ReadonlyArray<string>;
  seriesToMaterialMap: ReadonlyMap<string, string>;
}>;

/** section_series を material 単位で読み込み、active 件数と series→material マッピングを作る。 */
const loadActiveSeries = (
  database: DrizzleDatabase,
  materialIdentifiers: ReadonlyArray<string>,
): ActiveSeriesResult => {
  // --- 1. section_series per material (active = deletedAt IS NULL) ---
  const allSeriesDetailRows = database
    .select({
      identifier: sectionSeries.identifier,
      material: sectionSeries.material,
      deletedAt: sectionSeries.deletedAt,
    })
    .from(sectionSeries)
    .where(inArray(sectionSeries.material, materialIdentifiers))
    .all();

  // material ごとの active section_series 数
  const seriesCountByMaterial = new Map<string, number>();
  for (const row of allSeriesDetailRows) {
    if (!row.deletedAt) {
      seriesCountByMaterial.set(row.material, (seriesCountByMaterial.get(row.material) ?? 0) + 1);
    }
  }

  // --- 2. active section_series の identifier を収集 ---
  const activeSeriesIdentifiers = allSeriesDetailRows
    .filter((r) => !r.deletedAt)
    .map((r) => r.identifier);

  // series → material マッピング
  const seriesToMaterialMap = new Map<string, string>();
  for (const row of allSeriesDetailRows) {
    seriesToMaterialMap.set(row.identifier, row.material);
  }

  return { seriesCountByMaterial, activeSeriesIdentifiers, seriesToMaterialMap };
};

type SectionsToMaterialsResult = Readonly<{
  activeSectionIdentifiers: ReadonlyArray<string>;
  sectionToMaterialMap: ReadonlyMap<string, string>;
}>;

/** active な section_series 配下の sections を読み込み、section→material マッピングを作る。 */
const mapSectionsToMaterials = (
  database: DrizzleDatabase,
  activeSeriesIdentifiers: ReadonlyArray<string>,
  seriesToMaterialMap: ReadonlyMap<string, string>,
): SectionsToMaterialsResult => {
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

  // section → series のマッピング
  const sectionToSeriesMap = new Map<string, string>();
  for (const row of allSectionRows) {
    sectionToSeriesMap.set(row.identifier, row.sectionSeries);
  }

  const sectionToMaterialMap = new Map<string, string>();
  for (const [sectionId, seriesId] of sectionToSeriesMap) {
    const materialId = seriesToMaterialMap.get(seriesId);
    if (materialId) {
      sectionToMaterialMap.set(sectionId, materialId);
    }
  }

  return { activeSectionIdentifiers, sectionToMaterialMap };
};

/**
 * section 単位のスコア履歴エントリを createdAt 昇順にマージする。
 * 1 material が複数 section にまたがる場合でも、port の契約
 * （overallScoreHistory は createdAt 昇順）を満たすために使う。
 */
const mergeScoreHistoryByCreatedAt = (
  entries: ReadonlyArray<SectionScoreEntry>,
): ReadonlyArray<number> =>
  [...entries]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((entry) => entry.overallScore);

/** section 単位の集計結果を material 単位に group-by して MaterialStats を組み立てる。 */
const assembleStats = (
  materialIdentifiers: ReadonlyArray<string>,
  seriesCountByMaterial: ReadonlyMap<string, number>,
  activeSectionIdentifiers: ReadonlyArray<string>,
  sectionToMaterialMap: ReadonlyMap<string, string>,
  sectionScores: ReadonlyMap<string, SectionScoreStats>,
): ReadonlyMap<string, MaterialStats> => {
  const attemptCountByMaterial = new Map<string, number>();
  const lastPracticedAtByMaterial = new Map<string, Date>();
  const bestScoreByMaterial = new Map<string, number>();
  const scoreEntriesByMaterial = new Map<string, SectionScoreEntry[]>();

  for (const sectionId of activeSectionIdentifiers) {
    const materialId = sectionToMaterialMap.get(sectionId);
    if (!materialId) continue;

    const stats = sectionScores.get(sectionId);
    if (!stats) continue;

    attemptCountByMaterial.set(
      materialId,
      (attemptCountByMaterial.get(materialId) ?? 0) + stats.attemptCount,
    );

    if (stats.lastPracticedAt) {
      const existing = lastPracticedAtByMaterial.get(materialId);
      if (!existing || stats.lastPracticedAt > existing) {
        lastPracticedAtByMaterial.set(materialId, stats.lastPracticedAt);
      }
    }

    if (stats.bestScore !== null) {
      const currentBest = bestScoreByMaterial.get(materialId) ?? -Infinity;
      if (stats.bestScore > currentBest) {
        bestScoreByMaterial.set(materialId, stats.bestScore);
      }
    }

    const entries = scoreEntriesByMaterial.get(materialId) ?? [];
    entries.push(...stats.scoreHistory);
    scoreEntriesByMaterial.set(materialId, entries);
  }

  // --- 組み立て ---
  const resultMap = new Map<string, MaterialStats>();
  for (const materialId of materialIdentifiers) {
    const seriesCount = seriesCountByMaterial.get(materialId) ?? 0;
    const attemptCount = attemptCountByMaterial.get(materialId) ?? 0;
    const bestScore = bestScoreByMaterial.has(materialId)
      ? (bestScoreByMaterial.get(materialId) as number)
      : null;
    const scoreHistory = mergeScoreHistoryByCreatedAt(scoreEntriesByMaterial.get(materialId) ?? []);
    const lastPracticedAt = lastPracticedAtByMaterial.get(materialId) ?? null;

    resultMap.set(materialId, {
      sectionSeriesCount: seriesCount,
      recordingAttemptCount: attemptCount,
      bestOverallScore: bestScore,
      overallScoreHistory: scoreHistory,
      lastPracticedAt,
    });
  }

  return resultMap;
};

export const createDrizzleLibraryStatsRepository = (
  database: DrizzleDatabase,
): LibraryStatsRepository => ({
  findStatsByMaterials: (materialIdentifiers: ReadonlyArray<string>) => {
    return tryPersistence(() => {
      if (materialIdentifiers.length === 0) {
        return new Map<string, MaterialStats>() as ReadonlyMap<string, MaterialStats>;
      }

      const identifiers = [...materialIdentifiers];

      const { seriesCountByMaterial, activeSeriesIdentifiers, seriesToMaterialMap } =
        loadActiveSeries(database, identifiers);

      const { activeSectionIdentifiers, sectionToMaterialMap } = mapSectionsToMaterials(
        database,
        activeSeriesIdentifiers,
        seriesToMaterialMap,
      );

      const sectionScores = collectScoresBySection(database, activeSectionIdentifiers);

      return assembleStats(
        identifiers,
        seriesCountByMaterial,
        activeSectionIdentifiers,
        sectionToMaterialMap,
        sectionScores,
      );
    });
  },
});
