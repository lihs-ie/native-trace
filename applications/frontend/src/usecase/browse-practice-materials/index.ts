import { type ResultAsync } from "neverthrow";
import { z } from "zod";
import { errAsync } from "../../domain/shared";
import { type DomainError } from "../../domain/shared";
import { type ActiveMaterial, type MaterialIdentifier } from "../../domain/material";
import { type MaterialRepository } from "../port/material-repository";
import { type LibraryStatsRepository } from "../port/library-stats-repository";
import { toDomainPagination } from "../shared/pagination";
import { parseInput } from "../shared/validation";

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
    const parsedInput = parseInput(browsePracticeMaterialsSchema, input);
    if (parsedInput.isErr()) {
      return errAsync(parsedInput.error);
    }
    const parsed = parsedInput.value;

    const pagination = toDomainPagination(parsed.pagination);

    return dependencies.materialRepository
      .search({
        type: "activeMaterials",
        pagination,
        sort: "updatedAt_desc",
      })
      .andThen((page) => {
        const activeMaterials = page.items.filter(
          (material): material is ActiveMaterial => material.type === "active",
        );
        const identifiers = activeMaterials.map((m) => m.identifier as string);

        return dependencies.libraryStatsRepository
          .findStatsByMaterials(identifiers)
          .map((statsMap) => ({
            materials: activeMaterials.map((m) => {
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
