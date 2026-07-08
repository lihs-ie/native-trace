import { type ResultAsync, errAsync, fromSafePromise } from "neverthrow";
import { z } from "zod";
import { type DomainError, validationFailed } from "../../domain/shared";
import { createMaterialIdentifier, type ActiveMaterial } from "../../domain/material";
import { type ActiveSectionSeries } from "../../domain/section-series";
import { type SectionRepository } from "../port/section-repository";
import { type MaterialRepository } from "../port/material-repository";
import { type SectionSeriesRepository } from "../port/section-series-repository";
import {
  type MaterialDetailStatsRepository,
  type SectionSeriesStats,
} from "../port/material-detail-stats-repository";
import { firstPage, unboundedPage } from "../shared/pagination";

// ---- Input ----

const viewMaterialPracticePlanSchema = z.object({
  material: z.string().min(1, "素材IDは空にできません"),
});

export type ViewMaterialPracticePlanInput = z.infer<typeof viewMaterialPracticePlanSchema>;

// ---- Output ----

export type SectionVersionSummaryOutput = Readonly<{
  identifier: string;
  version: number;
  createdAt: string;
}>;

export type SectionSeriesStatsOutput = Readonly<{
  /** 最新本文版のワード数。section が存在しない場合は null (honest empty) */
  wordCount: number | null;
  /** recording_attempts の ready 件数 */
  recordingAttemptCount: number;
  /** assessment_results.overall_score の最大値。試行なし = null（honest empty） */
  bestOverallScore: number | null;
  /**
   * スコア推移 (overall_score を createdAt 昇順)。
   * 0 件のとき [] (honest empty)。UI は 1 件以下のとき spark を非表示にする。
   */
  overallScoreHistory: ReadonlyArray<number>;
}>;

export type SectionSeriesItemOutput = Readonly<{
  identifier: string;
  title: string;
  displayOrder: number;
  latestSection: Readonly<{
    identifier: string;
    version: number;
    bodyText: string;
    createdAt: string;
  }> | null;
  versionSummaries: ReadonlyArray<SectionVersionSummaryOutput>;
  stats: SectionSeriesStatsOutput;
}>;

export type MaterialLevelStatsOutput = Readonly<{
  /**
   * 全セクション本文の合計ワード数。section が 1 件もない場合は 0。
   */
  totalWordCount: number;
  /** 全セクション合算の recording_attempts ready 件数 */
  totalRecordingAttemptCount: number;
  /**
   * 全セクション中の最高スコア。試行なし = null（honest empty）
   */
  bestOverallScore: number | null;
}>;

export type ViewMaterialPracticePlanOutput = Readonly<{
  material: Readonly<{
    identifier: string;
    title: string;
    sourceType: string | null;
    speakerName: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  materialLevelStats: MaterialLevelStatsOutput;
  sectionSeriesItems: ReadonlyArray<SectionSeriesItemOutput>;
}>;

// ---- Dependencies ----

export type ViewMaterialPracticePlanDependencies = Readonly<{
  materialRepository: MaterialRepository;
  sectionSeriesRepository: SectionSeriesRepository;
  sectionRepository: SectionRepository;
  materialDetailStatsRepository: MaterialDetailStatsRepository;
}>;

// ---- Helpers ----

type SectionSeriesItemWithoutStats = Omit<SectionSeriesItemOutput, "stats"> & {
  latestBodyText: string | null;
};

const buildSectionSeriesItemWithoutStats = async (
  series: ActiveSectionSeries,
  sectionRepository: SectionRepository,
): Promise<SectionSeriesItemWithoutStats> => {
  const [latestResult, versionsResult] = await Promise.all([
    sectionRepository.findLatestInSeries(series.identifier),
    sectionRepository.search({
      type: "sectionVersionsInSeries",
      sectionSeries: series.identifier,
      pagination: firstPage(100),
      sort: "version_desc",
    }),
  ]);

  const latestSection = latestResult.isOk() ? latestResult.value : null;
  const versions = versionsResult.isOk() ? versionsResult.value.items : [];

  return {
    identifier: series.identifier as string,
    title: series.title as string,
    displayOrder: series.displayOrder as number,
    latestSection: latestSection
      ? {
          identifier: latestSection.identifier as string,
          version: latestSection.version as number,
          bodyText: latestSection.bodyText as string,
          createdAt: latestSection.createdAt.toISOString(),
        }
      : null,
    versionSummaries: versions.map((s) => ({
      identifier: s.identifier as string,
      version: s.version as number,
      createdAt: s.createdAt.toISOString(),
    })),
    latestBodyText: latestSection ? (latestSection.bodyText as string) : null,
  };
};

const emptyStats = (bodyText: string | null): SectionSeriesStatsOutput => ({
  wordCount: bodyText !== null ? bodyText.trim().split(/\s+/).filter(Boolean).length : null,
  recordingAttemptCount: 0,
  bestOverallScore: null,
  overallScoreHistory: [],
});

const statsFromRepository = (stats: SectionSeriesStats): SectionSeriesStatsOutput => ({
  wordCount: stats.wordCount,
  recordingAttemptCount: stats.recordingAttemptCount,
  bestOverallScore: stats.bestOverallScore,
  overallScoreHistory: stats.overallScoreHistory,
});

// ---- Implementation ----

export const createViewMaterialPracticePlan =
  (dependencies: ViewMaterialPracticePlanDependencies) =>
  (
    input: ViewMaterialPracticePlanInput,
  ): ResultAsync<ViewMaterialPracticePlanOutput, DomainError> => {
    const parsed = viewMaterialPracticePlanSchema.safeParse(input);
    if (!parsed.success) {
      return errAsync(
        validationFailed("input", parsed.error.errors.map((e) => e.message).join(", ")),
      );
    }

    const identifierResult = createMaterialIdentifier(parsed.data.material);
    if (!identifierResult) {
      return errAsync(validationFailed("material", "不正な素材IDです"));
    }

    return dependencies.materialRepository
      .find(identifierResult)
      .andThen((material: ActiveMaterial) =>
        dependencies.sectionSeriesRepository
          .search({
            type: "activeSeriesInMaterial",
            material: identifierResult,
            pagination: unboundedPage(),
            sort: "displayOrder_asc",
          })
          .andThen((seriesPage) => {
            const activeSeries = seriesPage.items.filter(
              (s): s is ActiveSectionSeries => s.type === "active",
            );

            return fromSafePromise(
              Promise.all(
                activeSeries.map((s) =>
                  buildSectionSeriesItemWithoutStats(s, dependencies.sectionRepository),
                ),
              ),
            ).andThen((itemsWithoutStats) => {
              const latestBodyTextBySeries = new Map<string, string>();
              for (const item of itemsWithoutStats) {
                if (item.latestBodyText !== null) {
                  latestBodyTextBySeries.set(item.identifier, item.latestBodyText);
                }
              }

              const seriesIdentifiers = itemsWithoutStats.map((item) => item.identifier);

              return dependencies.materialDetailStatsRepository
                .findStatsBySectionSeries(seriesIdentifiers, latestBodyTextBySeries)
                .map((statsMap) => {
                  const sectionSeriesItems: SectionSeriesItemOutput[] = itemsWithoutStats.map(
                    (item) => {
                      const repoStats = statsMap.get(item.identifier);
                      const stats = repoStats
                        ? statsFromRepository(repoStats)
                        : emptyStats(item.latestBodyText);
                      const { latestBodyText: _ignored, ...rest } = item;
                      return { ...rest, stats };
                    },
                  );

                  const totalWordCount = sectionSeriesItems.reduce(
                    (sum, item) => sum + (item.stats.wordCount ?? 0),
                    0,
                  );
                  const totalRecordingAttemptCount = sectionSeriesItems.reduce(
                    (sum, item) => sum + item.stats.recordingAttemptCount,
                    0,
                  );
                  const allScores = sectionSeriesItems
                    .map((item) => item.stats.bestOverallScore)
                    .filter((score): score is number => score !== null);
                  const bestOverallScore = allScores.length > 0 ? Math.max(...allScores) : null;

                  return {
                    material: {
                      identifier: material.identifier as string,
                      title: material.title as string,
                      sourceType: material.source?.sourceType ?? null,
                      speakerName: material.source?.speakerName ?? null,
                      createdAt: material.createdAt.toISOString(),
                      updatedAt: material.updatedAt.toISOString(),
                    },
                    materialLevelStats: {
                      totalWordCount,
                      totalRecordingAttemptCount,
                      bestOverallScore,
                    },
                    sectionSeriesItems,
                  };
                });
            });
          }),
      );
  };
