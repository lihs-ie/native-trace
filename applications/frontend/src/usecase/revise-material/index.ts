import { type ResultAsync, errAsync } from "neverthrow";
import { z } from "zod";
import { type DomainError, type NonEmptyList, validationFailed } from "../../domain/shared";
import {
  reviseMaterial,
  createMaterialIdentifier,
  createMaterialTitle,
  createMaterialSource,
  type ActiveMaterial,
  type MaterialRevised,
} from "../../domain/material";
import { type MaterialRepository } from "../port/material-repository";
import { type TransactionManager } from "../port/transaction-manager";
import { type Clock } from "../port/clock";
import { type Logger } from "../port/logger";

// ---- Input ----

const reviseMaterialSchema = z.object({
  material: z.string().min(1, "素材IDは空にできません"),
  title: z.string().min(1).optional(),
  source: z
    .object({
      sourceType: z.string().optional(),
      sourceUrl: z.string().optional().nullable(),
      sourceTitle: z.string().optional().nullable(),
      speakerName: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
});

export type ReviseMaterialInput = z.infer<typeof reviseMaterialSchema>;

// ---- Output ----

export type ReviseMaterialMaterialOutput = Readonly<{
  identifier: string;
  title: string;
  sourceType: string | null;
  updatedAt: string;
}>;

export type ReviseMaterialOutput = Readonly<{
  material: ReviseMaterialMaterialOutput;
  events: NonEmptyList<MaterialRevised>;
}>;

// ---- Dependencies ----

export type ReviseMaterialDependencies = Readonly<{
  materialRepository: MaterialRepository;
  transactionManager: TransactionManager;
  clock: Clock;
  logger: Logger;
}>;

// ---- Implementation ----

const toMaterialOutput = (material: ActiveMaterial): ReviseMaterialMaterialOutput => ({
  identifier: material.identifier as string,
  title: material.title as string,
  sourceType: material.source?.sourceType ?? null,
  updatedAt: material.updatedAt.toISOString(),
});

export const createReviseMaterial =
  (dependencies: ReviseMaterialDependencies) =>
  (input: ReviseMaterialInput): ResultAsync<ReviseMaterialOutput, DomainError> => {
    const parsed = reviseMaterialSchema.safeParse(input);
    if (!parsed.success) {
      return errAsync(
        validationFailed("input", parsed.error.errors.map((e) => e.message).join(", "))
      );
    }

    // 少なくとも1つのフィールドが更新対象でなければならない
    if (parsed.data.title === undefined && parsed.data.source === undefined) {
      return errAsync(
        validationFailed("input", "title または source の少なくとも1つを指定してください")
      );
    }

    const identifierResult = createMaterialIdentifier(parsed.data.material);
    if (!identifierResult) {
      return errAsync(validationFailed("material", "不正な素材IDです"));
    }

    return dependencies.transactionManager.execute(() =>
      dependencies.materialRepository.find(identifierResult).andThen((existing) => {
        // タイトルの決定（変更あり or 現行維持）
        const newTitleResult =
          parsed.data.title !== undefined
            ? createMaterialTitle(parsed.data.title)
            : ({ isOk: () => true, isErr: () => false, value: existing.title } as ReturnType<typeof createMaterialTitle>);

        if (newTitleResult.isErr()) return errAsync(newTitleResult.error);
        const newTitle = newTitleResult.value;

        // ソースの決定（変更あり or 現行維持）
        let newSource = existing.source;
        if (parsed.data.source !== undefined) {
          if (parsed.data.source === null) {
            newSource = null;
          } else {
            const sourceType = parsed.data.source.sourceType ?? "other";
            const sourceResult = createMaterialSource({
              sourceType,
              url: parsed.data.source.sourceUrl ?? null,
              sourceTitle: parsed.data.source.sourceTitle ?? null,
              speakerName: parsed.data.source.speakerName ?? null,
            });
            if (sourceResult.isErr()) return errAsync(sourceResult.error);
            newSource = sourceResult.value;
          }
        }

        const now = dependencies.clock.now();
        const { material, events } = reviseMaterial(existing, {
          title: newTitle,
          source: newSource,
          now,
        });

        return dependencies.materialRepository.persist(material).map(() => {
          dependencies.logger.info("reviseMaterial: material revised", {
            identifier: material.identifier,
          });
          return {
            material: toMaterialOutput(material),
            events,
          };
        });
      })
    );
  };
