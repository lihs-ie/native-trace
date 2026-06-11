import { type ResultAsync, errAsync } from "neverthrow";
import { z } from "zod";
import { type DomainError, type NonEmptyList, validationFailed } from "../../domain/shared";
import { createMaterialIdentifier } from "../../domain/material";
import {
  createSectionSeriesAggregate,
  createSectionSeriesIdentifier,
  createSectionTitle,
  createSectionDisplayOrder,
  type ActiveSectionSeries,
  type SectionSeriesCreated,
} from "../../domain/section-series";
import {
  createSection,
  createSectionIdentifier,
  createSectionVersion,
  createSectionBodyText,
  type ActiveSection,
  type SectionCreated,
} from "../../domain/section";
import { type MaterialRepository } from "../port/material-repository";
import { type SectionSeriesRepository } from "../port/section-series-repository";
import { type SectionRepository } from "../port/section-repository";
import { type TransactionManager } from "../port/transaction-manager";
import { type EntropyProvider } from "../port/entropy-provider";
import { type Clock } from "../port/clock";
import { type Logger } from "../port/logger";

// ---- Input ----

const definePracticeSectionSchema = z.object({
  material: z.string().min(1, "素材IDは空にできません"),
  title: z.string().min(1, "タイトルは空にできません"),
  bodyText: z.string().min(1, "本文は空にできません"),
  displayOrder: z.number().int().min(0),
});

export type DefinePracticeSectionInput = z.infer<typeof definePracticeSectionSchema>;

// ---- Output ----

export type DefinePracticeSectionOutput = Readonly<{
  sectionSeries: Readonly<{
    identifier: string;
    title: string;
    displayOrder: number;
    createdAt: string;
  }>;
  section: Readonly<{
    identifier: string;
    version: number;
    bodyText: string;
    createdAt: string;
  }>;
  events: NonEmptyList<SectionSeriesCreated | SectionCreated>;
}>;

// ---- Dependencies ----

export type DefinePracticeSectionDependencies = Readonly<{
  materialRepository: MaterialRepository;
  sectionSeriesRepository: SectionSeriesRepository;
  sectionRepository: SectionRepository;
  transactionManager: TransactionManager;
  entropyProvider: EntropyProvider;
  clock: Clock;
  logger: Logger;
}>;

// ---- Helpers ----

const toSectionSeriesOutput = (ss: ActiveSectionSeries) => ({
  identifier: ss.identifier as string,
  title: ss.title as string,
  displayOrder: ss.displayOrder as number,
  createdAt: ss.createdAt.toISOString(),
});

const toSectionOutput = (s: ActiveSection) => ({
  identifier: s.identifier as string,
  version: s.version as number,
  bodyText: s.bodyText as string,
  createdAt: s.createdAt.toISOString(),
});

// ---- Implementation ----

export const createDefinePracticeSection =
  (dependencies: DefinePracticeSectionDependencies) =>
  (input: DefinePracticeSectionInput): ResultAsync<DefinePracticeSectionOutput, DomainError> => {
    // 1. Zod 検証
    const parsed = definePracticeSectionSchema.safeParse(input);
    if (!parsed.success) {
      return errAsync(
        validationFailed("input", parsed.error.errors.map((e) => e.message).join(", "))
      );
    }

    const materialIdentifierResult = createMaterialIdentifier(parsed.data.material);
    if (!materialIdentifierResult) {
      return errAsync(validationFailed("material", "不正な素材IDです"));
    }

    // 2. bodyText の Domain VO 変換（空/最大長/英字割合/制御文字）
    const bodyTextResult = createSectionBodyText(parsed.data.bodyText);
    if (bodyTextResult.isErr()) return errAsync(bodyTextResult.error);
    const bodyText = bodyTextResult.value;

    // 3. title と displayOrder の VO 変換
    const titleResult = createSectionTitle(parsed.data.title);
    if (titleResult.isErr()) return errAsync(titleResult.error);
    const title = titleResult.value;

    const displayOrderResult = createSectionDisplayOrder(parsed.data.displayOrder);
    if (displayOrderResult.isErr()) return errAsync(displayOrderResult.error);
    const displayOrder = displayOrderResult.value;

    return dependencies.transactionManager.execute(() =>
      // 4. Material が Active か確認
      dependencies.materialRepository.find(materialIdentifierResult).andThen((material) => {
        if (material.type !== "active") {
          return errAsync(
            validationFailed("material", "削除済みの素材にはセクションを追加できません")
          );
        }

        const now = dependencies.clock.now();

        // 5. SectionSeries 作成
        const seriesRawId = dependencies.entropyProvider.generateUlid();
        const seriesIdentifierResult = createSectionSeriesIdentifier(seriesRawId);
        if (!seriesIdentifierResult) {
          return errAsync(validationFailed("seriesIdentifier", "ULID 生成に失敗しました"));
        }

        const { sectionSeries, events: seriesEvents } = createSectionSeriesAggregate({
          identifier: seriesIdentifierResult,
          material: material.identifier,
          title,
          displayOrder,
          now,
        });

        // 6. 初版 Section 作成
        const sectionRawId = dependencies.entropyProvider.generateUlid();
        const sectionIdentifierResult = createSectionIdentifier(sectionRawId);
        if (!sectionIdentifierResult) {
          return errAsync(validationFailed("sectionIdentifier", "ULID 生成に失敗しました"));
        }

        const versionResult = createSectionVersion(1);
        if (versionResult.isErr()) return errAsync(versionResult.error);

        const { section, events: sectionEvents } = createSection({
          identifier: sectionIdentifierResult,
          sectionSeries: sectionSeries.identifier,
          version: versionResult.value,
          bodyText,
          now,
        });

        // 7. 同一トランザクションで両方 persist
        return dependencies.sectionSeriesRepository
          .persist(sectionSeries)
          .andThen(() => dependencies.sectionRepository.persist(section))
          .map(() => {
            dependencies.logger.info("definePracticeSection: created", {
              sectionSeriesIdentifier: sectionSeries.identifier,
              sectionIdentifier: section.identifier,
            });

            const allEvents: NonEmptyList<SectionSeriesCreated | SectionCreated> = [
              ...seriesEvents,
              ...sectionEvents,
            ] as NonEmptyList<SectionSeriesCreated | SectionCreated>;

            return {
              sectionSeries: toSectionSeriesOutput(sectionSeries),
              section: toSectionOutput(section),
              events: allEvents,
            };
          });
      })
    );
  };
