import { type ResultAsync, errAsync } from "neverthrow";
import { z } from "zod";
import { type DomainError, type NonEmptyList, validationFailed } from "../../domain/shared";
import {
  retireMaterial,
  createMaterialIdentifier,
  type MaterialRetired,
} from "../../domain/material";
import {
  retireSectionSeries,
  type DeletedSectionSeries,
  type SectionSeriesRetired,
} from "../../domain/section-series";
import { type MaterialRepository } from "../port/material-repository";
import { type SectionSeriesRepository } from "../port/section-series-repository";
import { type TransactionManager } from "../port/transaction-manager";
import { type Clock } from "../port/clock";
import { type Logger } from "../port/logger";

// ---- Input ----

const retireMaterialSchema = z.object({
  material: z.string().min(1, "素材IDは空にできません"),
});

export type RetireMaterialInput = z.infer<typeof retireMaterialSchema>;

// ---- Output ----

export type RetireMaterialOutput = Readonly<{
  material: Readonly<{
    identifier: string;
    title: string;
    deletedAt: string;
  }>;
  retiredSectionSeriesCount: number;
  events: NonEmptyList<MaterialRetired | SectionSeriesRetired>;
}>;

// ---- Dependencies ----

export type RetireMaterialDependencies = Readonly<{
  materialRepository: MaterialRepository;
  sectionSeriesRepository: SectionSeriesRepository;
  transactionManager: TransactionManager;
  clock: Clock;
  logger: Logger;
}>;

// ---- Implementation ----

export const createRetireMaterial =
  (dependencies: RetireMaterialDependencies) =>
  (input: RetireMaterialInput): ResultAsync<RetireMaterialOutput, DomainError> => {
    const parsed = retireMaterialSchema.safeParse(input);
    if (!parsed.success) {
      return errAsync(
        validationFailed("input", parsed.error.errors.map((e) => e.message).join(", ")),
      );
    }

    const identifierResult = createMaterialIdentifier(parsed.data.material);
    if (!identifierResult) {
      return errAsync(validationFailed("material", "不正な素材IDです"));
    }

    return dependencies.transactionManager.execute(() =>
      dependencies.materialRepository.find(identifierResult).andThen((existing) => {
        const now = dependencies.clock.now();
        const { material: deletedMaterial, events: materialEvents } = retireMaterial(existing, now);

        // 配下の ActiveSectionSeries をすべて論理削除
        return dependencies.sectionSeriesRepository
          .search({
            type: "activeSeriesInMaterial",
            material: identifierResult,
            pagination: { type: "offset", offset: 0 as never, limit: 1000 as never },
            sort: "displayOrder_asc",
          })
          .andThen((seriesPage) => {
            const seriesRetiredEvents: SectionSeriesRetired[] = [];
            const retiredSeriesList: DeletedSectionSeries[] = [];

            for (const series of seriesPage.items) {
              if (series.type !== "active") continue;
              const { sectionSeries: retired, events: seriesEvents } = retireSectionSeries(
                series,
                now,
              );
              retiredSeriesList.push(retired);
              seriesRetiredEvents.push(...seriesEvents);
            }

            // persist material
            return dependencies.materialRepository
              .persist(deletedMaterial)
              .andThen(() => {
                // persist all retired series
                const persistPromises = retiredSeriesList.map((s) =>
                  dependencies.sectionSeriesRepository.persist(s),
                );
                if (persistPromises.length === 0) {
                  return dependencies.materialRepository
                    .persist(deletedMaterial)
                    .map(() => undefined);
                }
                // シーケンシャルに persist
                return persistPromises.reduce(
                  (acc, curr) => acc.andThen(() => curr),
                  dependencies.materialRepository.persist(deletedMaterial),
                );
              })
              .map(() => {
                dependencies.logger.info("retireMaterial: material retired", {
                  identifier: deletedMaterial.identifier,
                  retiredSeriesCount: retiredSeriesList.length,
                });

                const allEvents: NonEmptyList<MaterialRetired | SectionSeriesRetired> = [
                  ...materialEvents,
                  ...seriesRetiredEvents,
                ] as NonEmptyList<MaterialRetired | SectionSeriesRetired>;

                return {
                  material: {
                    identifier: deletedMaterial.identifier as string,
                    title: deletedMaterial.title as string,
                    deletedAt: deletedMaterial.deletedAt.toISOString(),
                  },
                  retiredSectionSeriesCount: retiredSeriesList.length,
                  events: allEvents,
                };
              });
          });
      }),
    );
  };
