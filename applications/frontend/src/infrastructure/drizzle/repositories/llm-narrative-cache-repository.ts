import { eq } from "drizzle-orm";
import { type DrizzleDatabase } from "../client";
import { llmNarrativeCache } from "../schema";
import { type LlmNarrativeCache } from "../../../usecase/port/llm-narrative-cache";
import { type FeedbackLayersOutput } from "../../../usecase/port/improvement-message-generator";
import { type DomainError } from "../../../domain/shared";
import { okAsync, errAsync } from "neverthrow";

/**
 * createDrizzleLlmNarrativeCacheRepository (ADR-021 D5, M-LLM-13)
 *
 * factory + plain object パターン（finding-dismissal-repository.ts に準拠）。
 * findBySignature: PRIMARY KEY による SELECT。行なし → null を返す。
 * store: INSERT OR REPLACE (onConflictDoUpdate で signature PK を上書き)。
 */
export const createDrizzleLlmNarrativeCacheRepository = (
  database: DrizzleDatabase,
): LlmNarrativeCache => ({
  findBySignature: (signature: string) => {
    return okAsync(null).andThen(() => {
      try {
        const rows = database
          .select()
          .from(llmNarrativeCache)
          .where(eq(llmNarrativeCache.signature, signature))
          .all();

        if (rows.length === 0) {
          return okAsync(null);
        }

        const row = rows[0];
        const layers: FeedbackLayersOutput = {
          whatJa: row.whatJa,
          whyJa: row.whyJa,
          howJa: row.howJa,
        };
        return okAsync(layers);
      } catch (e) {
        return errAsync({ type: "persistenceFailed", reason: String(e) } as DomainError);
      }
    });
  },

  store: (
    signature: string,
    layers: FeedbackLayersOutput,
    metadata: { provider: string; model: string; promptVersion: string },
  ) => {
    return okAsync(null).andThen(() => {
      try {
        database
          .insert(llmNarrativeCache)
          .values({
            signature,
            provider: metadata.provider,
            model: metadata.model,
            promptVersion: metadata.promptVersion,
            whatJa: layers.whatJa,
            whyJa: layers.whyJa,
            howJa: layers.howJa,
            createdAt: new Date().toISOString(),
          })
          .onConflictDoUpdate({
            target: llmNarrativeCache.signature,
            set: {
              provider: metadata.provider,
              model: metadata.model,
              promptVersion: metadata.promptVersion,
              whatJa: layers.whatJa,
              whyJa: layers.whyJa,
              howJa: layers.howJa,
              createdAt: new Date().toISOString(),
            },
          })
          .run();
        return okAsync(undefined);
      } catch (e) {
        return errAsync({ type: "persistenceFailed", reason: String(e) } as DomainError);
      }
    });
  },
});
