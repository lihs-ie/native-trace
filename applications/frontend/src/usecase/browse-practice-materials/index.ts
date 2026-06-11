import { type ResultAsync } from "neverthrow";
import { z } from "zod";
import { errAsync } from "../../domain/shared";
import { type DomainError, validationFailed } from "../../domain/shared";
import { type MaterialIdentifier } from "../../domain/material";
import { type MaterialRepository } from "../port/material-repository";
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

export type MaterialSummaryOutput = Readonly<{
  identifier: string;
  title: string;
  sourceType: string | null;
  createdAt: string;
  updatedAt: string;
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
}>;

// ---- Implementation ----

const toMaterialSummaryOutput = (
  material: { identifier: MaterialIdentifier; title: string; source: { sourceType: string } | null; createdAt: Date; updatedAt: Date }
): MaterialSummaryOutput => ({
  identifier: material.identifier as string,
  title: material.title as string,
  sourceType: material.source?.sourceType ?? null,
  createdAt: material.createdAt.toISOString(),
  updatedAt: material.updatedAt.toISOString(),
});

export const createBrowsePracticeMaterials =
  (dependencies: BrowsePracticeMaterialsDependencies) =>
  (input: BrowsePracticeMaterialsInput): ResultAsync<BrowsePracticeMaterialsOutput, DomainError> => {
    const parsed = browsePracticeMaterialsSchema.safeParse(input);
    if (!parsed.success) {
      return errAsync(
        validationFailed("input", parsed.error.errors.map((e) => e.message).join(", "))
      );
    }

    const pagination = toDomainPagination(parsed.data.pagination);

    return dependencies.materialRepository
      .search({
        type: "activeMaterials",
        pagination,
        sort: "updatedAt_desc",
      })
      .map((page) => ({
        materials: page.items
          .filter((m) => m.type === "active")
          .map((m) => {
            // m は Material（active | deleted）だが filter で active を絞った
            if (m.type !== "active") throw new Error("unreachable");
            return toMaterialSummaryOutput(m);
          }),
        page: {
          offset: pagination.offset as number,
          limit: pagination.limit as number,
          total: page.total,
        },
      }));
  };
