import { type ResultAsync } from "neverthrow";
import { z } from "zod";
import { errAsync } from "../../domain/shared";
import { type DomainError, validationFailed } from "../../domain/shared";
import { type MaterialIdentifier } from "../../domain/material";
import { type MaterialRepository } from "../port/material-repository";
import { type LibraryStatsRepository } from "../port/library-stats-repository";
import { toDomainPagination } from "../shared/pagination";

// ---- Input ----

const browsePracticeMaterialsSchema = z.object({
  pagination: z
    .object({
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    })
    .optional(),
});

export type BrowsePracticeMaterialsInput = z.infer<typeof browsePracticeMaterialsSchema>;

// ---- Output ----

export type MaterialStatsOutput = Readonly<{
  sectionSeriesCount: number;
  recordingAttemptCount: number;
  bestOverallScore: number | null;
  overallScoreHistory: ReadonlyArray<number>;
  lastPracticedAt: string | null;
}>;

export type MaterialSummaryOutput = Readonly<{
  identifier: string;
  title: string;
  sourceType: string | null;
  createdAt: string;
  updatedAt: string;
  stats: MaterialStatsOutput;
}>;

export type BrowsePracticeMaterialsOutput = Readonly<{
  materials: ReadonlyArray<MaterialSummaryOutput>;
  page: Readonly<{
    offset: number;
    limit: number;
    total: number;
  }>;
}>;

// ---- Dependencies ----

export type BrowsePracticeMaterialsDependencies = Readonly<{
  materialRepository: MaterialRepository;
  libraryStatsRepository: LibraryStatsRepository;
}>;

// ---- Implementation ----

const toMaterialSummaryOutput = (
  material: {
    identifier: MaterialIdentifier;
    title: string;
    source: { sourceType: string } | null;
    createdAt: Date;
    updatedAt: Date;
  },
  stats: MaterialStatsOutput,
): MaterialSummaryOutput => ({
  identifier: material.identifier as string,
  title: material.title as string,
  sourceType: material.source?.sourceType ?? null,
  createdAt: material.createdAt.toISOString(),
  updatedAt: material.updatedAt.toISOString(),
  stats,
});

const emptyStats = (): MaterialStatsOutput => ({
  sectionSeriesCount: 0,
  recordingAttemptCount: 0,
  bestOverallScore: null,
  overallScoreHistory: [],
  lastPracticedAt: null,
});

export const createBrowsePracticeMaterials =
  (dependencies: BrowsePracticeMaterialsDependencies) =>
  (
    input: BrowsePracticeMaterialsInput,
  ): ResultAsync<BrowsePracticeMaterialsOutput, DomainError> => {
    const parsed = browsePracticeMaterialsSchema.safeParse(input);
    if (!parsed.success) {
      return errAsync(
        validationFailed("input", parsed.error.errors.map((e) => e.message).join(", ")),
      );
    }

    const pagination = toDomainPagination(parsed.data.pagination);

    return dependencies.materialRepository
      .search({
        type: "activeMaterials",
        pagination,
        sort: "updatedAt_desc",
      })
      .andThen((page) => {
        const activeMaterials = page.items.filter((m) => m.type === "active");
        const identifiers = activeMaterials.map((m) => m.identifier as string);

        return dependencies.libraryStatsRepository
          .findStatsByMaterials(identifiers)
          .map((statsMap) => ({
            materials: activeMaterials.map((m) => {
              if (m.type !== "active") throw new Error("unreachable");
              const rawStats = statsMap.get(m.identifier as string);
              const stats: MaterialStatsOutput = rawStats
                ? {
                    sectionSeriesCount: rawStats.sectionSeriesCount,
                    recordingAttemptCount: rawStats.recordingAttemptCount,
                    bestOverallScore: rawStats.bestOverallScore,
                    overallScoreHistory: rawStats.overallScoreHistory,
                    lastPracticedAt: rawStats.lastPracticedAt?.toISOString() ?? null,
                  }
                : emptyStats();
              return toMaterialSummaryOutput(m, stats);
            }),
            page: {
              offset: pagination.offset as number,
              limit: pagination.limit as number,
              total: page.total,
            },
          }));
      });
  };
