import { type ResultAsync, errAsync, fromSafePromise } from "neverthrow";
import { z } from "zod";
import { type DomainError, validationFailed } from "../../domain/shared";
import { createMaterialIdentifier, type ActiveMaterial } from "../../domain/material";
import { type ActiveSectionSeries } from "../../domain/section-series";
import { type SectionRepository } from "../port/section-repository";
import { type MaterialRepository } from "../port/material-repository";
import { type SectionSeriesRepository } from "../port/section-series-repository";

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
}>;

export type ViewMaterialPracticePlanOutput = Readonly<{
  material: Readonly<{
    identifier: string;
    title: string;
    sourceType: string | null;
    updatedAt: string;
  }>;
  sectionSeriesItems: ReadonlyArray<SectionSeriesItemOutput>;
}>;

// ---- Dependencies ----

export type ViewMaterialPracticePlanDependencies = Readonly<{
  materialRepository: MaterialRepository;
  sectionSeriesRepository: SectionSeriesRepository;
  sectionRepository: SectionRepository;
}>;

// ---- Helpers ----

const buildSectionSeriesItem = async (
  series: ActiveSectionSeries,
  sectionRepository: SectionRepository
): Promise<SectionSeriesItemOutput> => {
  const [latestResult, versionsResult] = await Promise.all([
    sectionRepository.findLatestInSeries(series.identifier),
    sectionRepository.search({
      type: "sectionVersionsInSeries",
      sectionSeries: series.identifier,
      pagination: { type: "offset", offset: 0 as never, limit: 100 as never },
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
  };
};

// ---- Implementation ----

export const createViewMaterialPracticePlan =
  (dependencies: ViewMaterialPracticePlanDependencies) =>
  (input: ViewMaterialPracticePlanInput): ResultAsync<ViewMaterialPracticePlanOutput, DomainError> => {
    const parsed = viewMaterialPracticePlanSchema.safeParse(input);
    if (!parsed.success) {
      return errAsync(
        validationFailed("input", parsed.error.errors.map((e) => e.message).join(", "))
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
            pagination: { type: "offset", offset: 0 as never, limit: 1000 as never },
            sort: "displayOrder_asc",
          })
          .andThen((seriesPage) => {
            const activeSeries = seriesPage.items.filter(
              (s): s is ActiveSectionSeries => s.type === "active"
            );

            return fromSafePromise(
              Promise.all(
                activeSeries.map((s) =>
                  buildSectionSeriesItem(s, dependencies.sectionRepository)
                )
              )
            ).map((sectionSeriesItems) => ({
              material: {
                identifier: material.identifier as string,
                title: material.title as string,
                sourceType: material.source?.sourceType ?? null,
                updatedAt: material.updatedAt.toISOString(),
              },
              sectionSeriesItems,
            }));
          })
      );
  };
