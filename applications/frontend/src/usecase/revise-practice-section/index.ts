import { type ResultAsync, errAsync, ok, okAsync } from "neverthrow";
import { z } from "zod";
import { type DomainError, type NonEmptyList, validationFailed } from "../../domain/shared";
import {
  reviseSectionSeries,
  createSectionSeriesIdentifier,
  createSectionTitle,
  createSectionDisplayOrder,
  type SectionSeriesRevised,
} from "../../domain/section-series";
import {
  createSection,
  createSectionIdentifier,
  createSectionBodyText,
  type SectionCreated,
} from "../../domain/section";
import { type SectionSeriesRepository } from "../port/section-series-repository";
import { type SectionRepository } from "../port/section-repository";
import { type TransactionManager } from "../port/transaction-manager";
import { type EntropyProvider } from "../port/entropy-provider";
import { type Clock } from "../port/clock";
import { type Logger } from "../port/logger";
import { parseInput } from "../shared/validation";

// ---- Input ----

const revisePracticeSectionSchema = z.object({
  sectionSeries: z.string().min(1, "SectionSeriesIDは空にできません"),
  title: z.string().min(1).optional(),
  displayOrder: z.number().int().min(0).optional(),
  bodyText: z.string().min(1).optional(),
});

export type RevisePracticeSectionInput = z.infer<typeof revisePracticeSectionSchema>;

// ---- Output ----

export type RevisePracticeSectionOutput = Readonly<{
  sectionSeries: Readonly<{
    identifier: string;
    title: string;
    displayOrder: number;
    updatedAt: string;
  }>;
  newSection: Readonly<{
    identifier: string;
    version: number;
    bodyText: string;
    createdAt: string;
  }> | null;
  previousLatestSection: Readonly<{
    identifier: string;
    version: number;
    createdAt: string;
  }> | null;
  events: NonEmptyList<SectionSeriesRevised | SectionCreated>;
}>;

// ---- Dependencies ----

export type RevisePracticeSectionDependencies = Readonly<{
  sectionSeriesRepository: SectionSeriesRepository;
  sectionRepository: SectionRepository;
  transactionManager: TransactionManager;
  entropyProvider: EntropyProvider;
  clock: Clock;
  logger: Logger;
}>;

// ---- Implementation ----

export const createRevisePracticeSection =
  (dependencies: RevisePracticeSectionDependencies) =>
  (input: RevisePracticeSectionInput): ResultAsync<RevisePracticeSectionOutput, DomainError> => {
    // 1. Zod 検証
    const parsedInput = parseInput(revisePracticeSectionSchema, input);
    if (parsedInput.isErr()) {
      return errAsync(parsedInput.error);
    }
    const parsed = parsedInput.value;

    // 少なくとも1つのフィールドが必要
    if (
      parsed.title === undefined &&
      parsed.displayOrder === undefined &&
      parsed.bodyText === undefined
    ) {
      return errAsync(
        validationFailed(
          "input",
          "title, displayOrder, bodyText の少なくとも1つを指定してください",
        ),
      );
    }

    const seriesIdentifierResult = createSectionSeriesIdentifier(parsed.sectionSeries);
    if (!seriesIdentifierResult) {
      return errAsync(validationFailed("sectionSeries", "不正なSectionSeriesIDです"));
    }

    // bodyText がある場合は事前に VO 変換（validation first）
    let newBodyText = null;
    if (parsed.bodyText !== undefined) {
      const bodyTextResult = createSectionBodyText(parsed.bodyText);
      if (bodyTextResult.isErr()) return errAsync(bodyTextResult.error);
      newBodyText = bodyTextResult.value;
    }

    return dependencies.transactionManager.execute(() =>
      // 2. Active SectionSeries を取得
      dependencies.sectionSeriesRepository
        .find(seriesIdentifierResult)
        .andThen((existingSeries) => {
          const now = dependencies.clock.now();

          // 3. title / displayOrder の決定（未指定は現行維持）
          let newTitleResult: ReturnType<typeof createSectionTitle>;
          if (parsed.title !== undefined) {
            newTitleResult = createSectionTitle(parsed.title);
          } else {
            newTitleResult = ok(existingSeries.title);
          }
          if (newTitleResult.isErr()) return errAsync(newTitleResult.error);
          const newTitle = newTitleResult.value;

          let newDisplayOrderResult: ReturnType<typeof createSectionDisplayOrder>;
          if (parsed.displayOrder !== undefined) {
            newDisplayOrderResult = createSectionDisplayOrder(parsed.displayOrder);
          } else {
            newDisplayOrderResult = ok(existingSeries.displayOrder);
          }
          if (newDisplayOrderResult.isErr()) return errAsync(newDisplayOrderResult.error);
          const newDisplayOrder = newDisplayOrderResult.value;

          // 4. SectionSeries を revision
          const { sectionSeries: revisedSeries, events: seriesEvents } = reviseSectionSeries(
            existingSeries,
            { title: newTitle, displayOrder: newDisplayOrder, now },
          );

          // 5. bodyText 変更がある場合のみ新 Section 版を作る
          if (newBodyText !== null) {
            // 現在の最新版を取得してバージョン番号を確認
            return dependencies.sectionRepository
              .findLatestVersionNumber(seriesIdentifierResult)
              .andThen((latestVersion) =>
                dependencies.sectionRepository
                  .findLatestInSeries(seriesIdentifierResult)
                  .andThen((previousLatestSection) => {
                    const nextVersion = latestVersion + 1;

                    const rawSectionId = dependencies.entropyProvider.generateUlid();
                    const sectionIdentifierResult = createSectionIdentifier(rawSectionId);
                    if (!sectionIdentifierResult) {
                      return errAsync(
                        validationFailed("sectionIdentifier", "ULID 生成に失敗しました"),
                      );
                    }

                    // createSectionVersion は Result を返すが、値は計算済みなので cast
                    const { section: newSection, events: sectionEvents } = createSection({
                      identifier: sectionIdentifierResult,
                      sectionSeries: revisedSeries.identifier,
                      version: nextVersion as never,
                      bodyText: newBodyText!,
                      now,
                    });

                    const allEvents: NonEmptyList<SectionSeriesRevised | SectionCreated> = [
                      ...seriesEvents,
                      ...sectionEvents,
                    ] as NonEmptyList<SectionSeriesRevised | SectionCreated>;

                    return dependencies.sectionSeriesRepository
                      .persist(revisedSeries)
                      .andThen(() => dependencies.sectionRepository.persist(newSection))
                      .map(() => {
                        dependencies.logger.info(
                          "revisePracticeSection: revised with new section version",
                          {
                            seriesIdentifier: revisedSeries.identifier,
                            newVersion: nextVersion,
                          },
                        );
                        return {
                          sectionSeries: {
                            identifier: revisedSeries.identifier as string,
                            title: revisedSeries.title as string,
                            displayOrder: revisedSeries.displayOrder as number,
                            updatedAt: revisedSeries.updatedAt.toISOString(),
                          },
                          newSection: {
                            identifier: newSection.identifier as string,
                            version: newSection.version as number,
                            bodyText: newSection.bodyText as string,
                            createdAt: newSection.createdAt.toISOString(),
                          },
                          previousLatestSection: {
                            identifier: previousLatestSection.identifier as string,
                            version: previousLatestSection.version as number,
                            createdAt: previousLatestSection.createdAt.toISOString(),
                          },
                          events: allEvents,
                        };
                      });
                  }),
              );
          } else {
            // bodyText 変更なし → SectionSeries のみ更新、newSection は null
            const allEvents: NonEmptyList<SectionSeriesRevised> = seriesEvents;

            return dependencies.sectionSeriesRepository.persist(revisedSeries).andThen(() =>
              okAsync({
                sectionSeries: {
                  identifier: revisedSeries.identifier as string,
                  title: revisedSeries.title as string,
                  displayOrder: revisedSeries.displayOrder as number,
                  updatedAt: revisedSeries.updatedAt.toISOString(),
                },
                newSection: null,
                previousLatestSection: null,
                events: allEvents as NonEmptyList<SectionSeriesRevised | SectionCreated>,
              }),
            );
          }
        }),
    );
  };
