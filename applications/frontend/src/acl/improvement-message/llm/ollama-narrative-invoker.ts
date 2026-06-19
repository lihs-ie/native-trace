/**
 * ollama-narrative-invoker.ts — Ollama local inference invoker (ADR-021 D7 / M-LLM-14)
 *
 * S-LLM-3 quality note:
 *   Small models (7B class, e.g. llama3.1:8b) produce lower-quality Japanese phonetic
 *   explanations than Claude. Grounding validation (M-LLM-9) rejects hallucinated IPA or
 *   extra keys. Rejected outputs fall back to rule-based, meaning many findings will not
 *   benefit from LLM narrative when using small Ollama models. This is expected behaviour.
 *
 * process.env is BANNED in this directory (M-LLM-18 / no-process-env-in-llm-acl.yml).
 * All config values are passed via deps from registry.
 */

import { type LlmNarrativeInvoker } from "./create-llm-improvement-message-generator";

export type OllamaNarrativeInvokerDeps = {
  /**
   * Base URL for the Ollama daemon (e.g. "http://localhost:11434").
   * Sourced from config.ollamaEndpoint via registry.
   */
  ollamaEndpoint: string;
  /**
   * Model identifier string (e.g. "llama3.1:8b").
   * Sourced from config.ollamaModel via registry.
   */
  ollamaModel: string;
  /**
   * Timeout in milliseconds applied via AbortSignal.timeout.
   * Sourced from config.llmNarrativeTimeoutMilliseconds (default 30000).
   */
  timeoutMs: number;
};

/**
 * createOllamaNarrativeInvoker — returns a LlmNarrativeInvoker that calls the local
 * Ollama daemon via POST /api/generate with stream:false.
 *
 * Failure modes → reject (factory degrades to fallback):
 *   - Connection refused (daemon not running)
 *   - AbortSignal.timeout expiry
 *   - Non-2xx HTTP response
 *   - response.json().response parse failure
 */
export const createOllamaNarrativeInvoker = (
  deps: OllamaNarrativeInvokerDeps,
): LlmNarrativeInvoker => {
  const { ollamaEndpoint, ollamaModel, timeoutMs } = deps;

  return async (systemPromptText: string, userPromptText: string): Promise<string> => {
    const url = `${ollamaEndpoint}/api/generate`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ollamaModel,
        system: systemPromptText,
        prompt: userPromptText,
        stream: false,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      throw new Error(
        `Ollama /api/generate returned HTTP ${response.status}: ${await response.text().catch(() => "(unreadable)")}`,
      );
    }

    const responseBody = (await response.json()) as Record<string, unknown>;

    const responseText = responseBody["response"];

    if (typeof responseText !== "string") {
      throw new Error(
        `Ollama response.json().response is not a string: ${JSON.stringify(responseText).slice(0, 200)}`,
      );
    }

    // Return raw response text — validation (M-LLM-9) is applied in the factory
    return responseText;
  };
};
