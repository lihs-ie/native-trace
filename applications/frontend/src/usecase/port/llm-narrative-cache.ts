import { type ResultAsync } from "neverthrow";
import { type DomainError } from "../../domain/shared";
import { type FeedbackLayersOutput } from "./improvement-message-generator";

/**
 * LlmNarrativeCache port (ADR-021 D5)。
 * LLM が生成した feedbackLayers を sha256 署名をキーにキャッシュし、
 * 同一 input への再呼び出しを省く。
 * 実装は infrastructure/drizzle/repositories/llm-narrative-cache-repository.ts に置く。
 */
export type LlmNarrativeCache = {
  findBySignature(signature: string): ResultAsync<FeedbackLayersOutput | null, DomainError>;
  store(
    signature: string,
    layers: FeedbackLayersOutput,
    metadata: { provider: string; model: string; promptVersion: string },
  ): ResultAsync<void, DomainError>;
};
