import { type ResultAsync, errAsync } from "neverthrow";
import { z } from "zod";
import { type DomainError, type NonEmptyList, validationFailed } from "../../domain/shared";
import {
  retireSectionSeries,
  createSectionSeriesIdentifier,
  type SectionSeriesRetired,
} from "../../domain/section-series";
import { type SectionSeriesRepository } from "../port/section-series-repository";
import { type TransactionManager } from "../port/transaction-manager";
import { type Clock } from "../port/clock";
import { type Logger } from "../port/logger";
import { parseInput } from "../shared/validation";

// ---- Input ----

const retirePracticeSectionSeriesSchema = z.object({
  sectionSeries: z.string().min(1, "SectionSeriesIDは空にできません"),
});

export type RetirePracticeSectionSeriesInput = z.infer<typeof retirePracticeSectionSeriesSchema>;

// ---- Output ----

export type RetirePracticeSectionSeriesOutput = Readonly<{
  sectionSeries: Readonly<{
    identifier: string;
    title: string;
    deletedAt: string;
  }>;
  events: NonEmptyList<SectionSeriesRetired>;
}>;

// ---- Dependencies ----

export type RetirePracticeSectionSeriesDependencies = Readonly<{
  sectionSeriesRepository: SectionSeriesRepository;
  transactionManager: TransactionManager;
  clock: Clock;
  logger: Logger;
}>;

// ---- Implementation ----

export const createRetirePracticeSectionSeries =
  (dependencies: RetirePracticeSectionSeriesDependencies) =>
  (
    input: RetirePracticeSectionSeriesInput,
  ): ResultAsync<RetirePracticeSectionSeriesOutput, DomainError> => {
    const parsedInput = parseInput(retirePracticeSectionSeriesSchema, input);
    if (parsedInput.isErr()) {
      return errAsync(parsedInput.error);
    }
    const parsed = parsedInput.value;

    const identifierResult = createSectionSeriesIdentifier(parsed.sectionSeries);
    if (!identifierResult) {
      return errAsync(validationFailed("sectionSeries", "不正なSectionSeriesIDです"));
    }

    return dependencies.transactionManager.execute(() =>
      dependencies.sectionSeriesRepository.find(identifierResult).andThen((existing) => {
        const now = dependencies.clock.now();
        const { sectionSeries: retired, events } = retireSectionSeries(existing, now);

        return dependencies.sectionSeriesRepository.persist(retired).map(() => {
          dependencies.logger.info("retirePracticeSectionSeries: retired", {
            identifier: retired.identifier,
          });

          return {
            sectionSeries: {
              identifier: retired.identifier as string,
              title: retired.title as string,
              deletedAt: retired.deletedAt.toISOString(),
            },
            events,
          };
        });
      }),
    );
  };
