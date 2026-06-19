/**
 * create-llm-improvement-message-generator.ts — LLM adaptor factory (ADR-021 D1 / M-LLM-5)
 *
 * Factory + plain object pattern. NO class syntax (ast-grep no-class-declaration enforces).
 * process.env is BANNED in this directory (M-LLM-18).
 * All config values must be passed via deps.
 *
 * Critical path note: factory must NOT throw synchronously.
 * Async failures (invoker reject / timeout / grounding fail / cache error)
 * degrade to fallback.generateFeedbackLayers(input) — never propagate to caller.
 *
 * ADR-023 D3 fallback reason enum (M-TMO-7):
 *   "cache_error" — cache.findBySignature returned Err
 *   "invoker_error" — invoker threw (includes AbortController timeout; both unified as invoker_error)
 *   "parse_failed" — invoker returned empty / blank string
 *   "grounding_rejected" — validateLlmOutput returned valid=false
 * Note: "timeout" and "invoker_error" are both in the ADR-023 D3 enum. This implementation
 * unifies AbortController timeout and other invoker errors as "invoker_error" because the
 * invoker catch block does not currently expose the abort signal's abort reason to distinguish
 * them. This choice is recorded in .agent-evidence/llm-narrative-timeout-budget/commands.txt.
 */

import { createHash } from "node:crypto";

import {
  type ImprovementMessageGenerator,
  type ImprovementMessageGeneratorInput,
  type FeedbackLayersOutput,
} from "../../../usecase/port/improvement-message-generator";
import { type LlmNarrativeCache } from "../../../usecase/port/llm-narrative-cache";
import { type Logger } from "../../../usecase/port/logger";
import { buildGroundingPrompt, validateLlmOutput } from "./grounding-prompt";

// ---- Public type ----

/**
 * LlmNarrativeInvoker — thin async abstraction over LLM backend.
 * Receives fully-built system + user prompts, returns the raw response text.
 * Implementations: claude-code-narrative-invoker.ts, ollama-narrative-invoker.ts.
 */
export type LlmNarrativeInvoker = (system: string, user: string) => Promise<string>;

// ---- Cache signature (M-LLM-11) ----

/**
 * computeCacheSignature — sha256 of the fields that define a unique narrative request.
 * Fields joined with literal "|". null/undefined → empty string (deterministic).
 *
 * Fields: phenomenon | expected.ipa | detected.ipa | catalogId | wordPositionLabel |
 *         detectedTopCandidate | insertedVowel | promptVersion | providerModel
 */
const computeCacheSignature = (
  input: ImprovementMessageGeneratorInput,
  promptVersion: string,
  providerModel: string,
): string => {
  const parts = [
    input.phenomenon,
    input.expected.ipa ?? "",
    input.detected.ipa ?? "",
    input.catalogId ?? "",
    input.wordPositionLabel ?? "",
    input.detectedTopCandidate ?? "",
    input.insertedVowel ?? "",
    promptVersion,
    providerModel,
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
};

// ---- Factory (M-LLM-5) ----

type LlmImprovementMessageGeneratorDeps = {
  provider: "claude-code" | "ollama";
  invoker: LlmNarrativeInvoker;
  cache: LlmNarrativeCache;
  fallback: ImprovementMessageGenerator;
  promptVersion: string;
  providerModel: string;
  /** ADR-023 D3 (M-TMO-6): optional structured logger. Absent → silent (backward compatible). */
  logger?: Logger;
};

/**
 * createLlmImprovementMessageGenerator — returns an ImprovementMessageGenerator
 * that delegates synchronous paths to fallback and serves LLM narratives
 * via generateFeedbackLayersAsync (M-LLM-11 cache + invoker flow).
 *
 * Synchronous methods generate / generateFeedbackLayers ALWAYS use fallback
 * because LLM is async-only. This matches the existing rule-based contract
 * (generate returns generateFeedbackLayers().whatJa).
 */
export const createLlmImprovementMessageGenerator = (
  deps: LlmImprovementMessageGeneratorDeps,
): ImprovementMessageGenerator => {
  const { provider, invoker, cache, fallback, promptVersion, providerModel, logger } = deps;

  const generateFeedbackLayersAsync = async (
    input: ImprovementMessageGeneratorInput,
    onFallback?: (reason: string) => void,
  ): Promise<FeedbackLayersOutput> => {
    // Step 1: compute cache signature
    const signature = computeCacheSignature(input, promptVersion, providerModel);

    // Step 2: cache lookup — hit → return immediately (no invoker call)
    const cacheResult = await cache.findBySignature(signature);

    // On cache error: degrade to fallback (never throw to caller)
    if (cacheResult.isErr()) {
      // ADR-023 D3 (M-TMO-7): emit structured warn + notify caller via onFallback
      logger?.warn("llm narrative fallback", { reason: "cache_error", provider, providerModel });
      onFallback?.("cache_error");
      return fallback.generateFeedbackLayers(input);
    }

    const cached = cacheResult.value;
    if (cached !== null) {
      // cache hit — success path, do NOT call onFallback
      return cached;
    }

    // Step 3: cache miss → get fallback layers for grounding + build prompts
    const fallbackLayers = fallback.generateFeedbackLayers(input);
    const { systemPrompt, userPrompt, groundingText } = buildGroundingPrompt(input, fallbackLayers);

    // Step 4: invoke LLM
    let rawOutput: string;
    try {
      rawOutput = await invoker(systemPrompt, userPrompt);
    } catch {
      // invoker reject / timeout → fallback, no cache write
      // ADR-023 D3 (M-TMO-7): "invoker_error" (unifies timeout + other errors; see file header)
      logger?.warn("llm narrative fallback", { reason: "invoker_error", provider, providerModel });
      onFallback?.("invoker_error");
      return fallbackLayers;
    }

    if (!rawOutput || rawOutput.trim() === "") {
      // ADR-023 D3 (M-TMO-7): empty / blank output → parse_failed
      logger?.warn("llm narrative fallback", { reason: "parse_failed", provider, providerModel });
      onFallback?.("parse_failed");
      return fallbackLayers;
    }

    // Step 5: validate (M-LLM-9)
    const validationResult = validateLlmOutput(rawOutput, groundingText);
    if (!validationResult.valid) {
      // Grounding validation fail → fallback, no cache write
      // ADR-023 D3 (M-TMO-7): grounding rejection
      logger?.warn("llm narrative fallback", {
        reason: "grounding_rejected",
        provider,
        providerModel,
      });
      onFallback?.("grounding_rejected");
      return fallbackLayers;
    }

    const layers = validationResult.layers;

    // Step 6: store in cache (only on validation pass)
    const storeResult = await cache.store(signature, layers, {
      provider,
      model: providerModel,
      promptVersion,
    });

    // Cache store error is non-fatal — still return valid layers (success, no onFallback)
    if (storeResult.isErr()) {
      return layers;
    }

    return layers;
  };

  return {
    generate: (input: ImprovementMessageGeneratorInput): string =>
      fallback.generateFeedbackLayers(input).whatJa,

    generateFeedbackLayers: (input: ImprovementMessageGeneratorInput): FeedbackLayersOutput =>
      fallback.generateFeedbackLayers(input),

    generateFeedbackLayersAsync,
  };
};
