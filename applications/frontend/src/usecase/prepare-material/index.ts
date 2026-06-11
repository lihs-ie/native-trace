import { type ResultAsync, errAsync } from "neverthrow";
import { z } from "zod";
import { type DomainError, type NonEmptyList, validationFailed } from "../../domain/shared";
import {
  createMaterial,
  createMaterialIdentifier,
  createMaterialTitle,
  createMaterialSource,
  type ActiveMaterial,
  type MaterialCreated,
} from "../../domain/material";
import { type MaterialRepository } from "../port/material-repository";
import { type TransactionManager } from "../port/transaction-manager";
import { type EntropyProvider } from "../port/entropy-provider";
import { type Clock } from "../port/clock";
import { type Logger } from "../port/logger";

// ---- Input ----

const prepareMaterialSchema = z.object({
  title: z.string().min(1, "タイトルは空にできません"),
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

export type PrepareMaterialInput = z.infer<typeof prepareMaterialSchema>;

// ---- Output ----

export type PrepareMaterialMaterialOutput = Readonly<{
  identifier: string;
  title: string;
  sourceType: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type PrepareMaterialOutput = Readonly<{
  material: PrepareMaterialMaterialOutput;
  events: NonEmptyList<MaterialCreated>;
}>;

// ---- Dependencies ----

export type PrepareMaterialDependencies = Readonly<{
  materialRepository: MaterialRepository;
  transactionManager: TransactionManager;
  entropyProvider: EntropyProvider;
  clock: Clock;
  logger: Logger;
}>;

// ---- Implementation ----

const toMaterialOutput = (material: ActiveMaterial): PrepareMaterialMaterialOutput => ({
  identifier: material.identifier as string,
  title: material.title as string,
  sourceType: material.source?.sourceType ?? null,
  createdAt: material.createdAt.toISOString(),
  updatedAt: material.updatedAt.toISOString(),
});

export const createPrepareMaterial =
  (dependencies: PrepareMaterialDependencies) =>
  (input: PrepareMaterialInput): ResultAsync<PrepareMaterialOutput, DomainError> => {
    const parsed = prepareMaterialSchema.safeParse(input);
    if (!parsed.success) {
      return errAsync(
        validationFailed("input", parsed.error.errors.map((e) => e.message).join(", "))
      );
    }

    const titleResult = createMaterialTitle(parsed.data.title);
    if (titleResult.isErr()) return errAsync(titleResult.error);

    const title = titleResult.value;

    // source を解析
    let source = null;
    if (parsed.data.source) {
      const sourceType = parsed.data.source.sourceType ?? "other";
      const sourceResult = createMaterialSource({
        sourceType,
        url: parsed.data.source.sourceUrl ?? null,
        sourceTitle: parsed.data.source.sourceTitle ?? null,
        speakerName: parsed.data.source.speakerName ?? null,
      });
      if (sourceResult.isErr()) return errAsync(sourceResult.error);
      source = sourceResult.value;
    }

    return dependencies.transactionManager.execute(() => {
      const rawIdentifier = dependencies.entropyProvider.generateUlid();
      const identifierResult = createMaterialIdentifier(rawIdentifier);
      if (!identifierResult) {
        return errAsync(validationFailed("identifier", "ULID 生成に失敗しました"));
      }

      const now = dependencies.clock.now();
      const { material, events } = createMaterial({
        identifier: identifierResult,
        title,
        source,
        now,
      });

      return dependencies.materialRepository.persist(material).map(() => {
        dependencies.logger.info("prepareMaterial: material created", {
          identifier: material.identifier,
        });
        return {
          material: toMaterialOutput(material),
          events,
        };
      });
    });
  };
