/**
 * Improvement message generator の配線 — registry.ts (Composition Root) から W45 で純移動。
 *
 * M-LLM-16 provider branch (ADR-021 D6): llmCoachingProvider に応じて
 * rule-based / claude-code / ollama の generator を組み立てる。
 * claude-code 指定でも executable が解決できない場合は rule-based へダウングレードする (M-LLM-7)。
 *
 * このモジュールは registry.ts と同層（composition root の一部）であり、
 * Route Handler / UseCase / Domain / ACL からは import しない。
 */

import {
  isClaudeCodeAvailable,
  buildClaudeCodeChildEnv,
  type AppConfig,
} from "./infrastructure/config/index";
import { type DrizzleDatabase } from "./infrastructure/drizzle/client";
import { createRuleBasedImprovementMessageGenerator } from "./acl/improvement-message/rule-based/create-rule-based-improvement-message-generator";
import { createLlmImprovementMessageGenerator } from "./acl/improvement-message/llm/create-llm-improvement-message-generator";
import { createClaudeCodeNarrativeInvoker } from "./acl/improvement-message/llm/claude-code-narrative-invoker";
import { createOllamaNarrativeInvoker } from "./acl/improvement-message/llm/ollama-narrative-invoker";
import { createDrizzleLlmNarrativeCacheRepository } from "./infrastructure/drizzle/repositories/llm-narrative-cache-repository";
import type { ImprovementMessageGenerator } from "./usecase/port/improvement-message-generator";
import type { Logger } from "./usecase/port/logger";

export const buildImprovementMessageGenerator = (
  config: AppConfig,
  database: DrizzleDatabase,
  logger: Logger,
): ImprovementMessageGenerator => {
  // ACL: improvement message generator — M-LLM-16 provider branch (ADR-021 D6)
  const fallbackGenerator = createRuleBasedImprovementMessageGenerator();

  let improvementMessageGenerator: ImprovementMessageGenerator;

  if (config.llmCoachingProvider === "rule-based") {
    // Default path — unchanged behaviour; generateFeedbackLayersAsync stays undefined.
    improvementMessageGenerator = fallbackGenerator;
  } else if (
    config.llmCoachingProvider === "claude-code" &&
    !isClaudeCodeAvailable(config.claudeCodeExecutablePath)
  ) {
    // M-LLM-7 downgrade: claude executable not resolvable on PATH (covers Docker-without-claude).
    // generateFeedbackLayersAsync remains undefined → pre-loop batch skipped → rule-based sync path.
    console.warn(
      JSON.stringify({
        level: "warn",
        message:
          "LLM coaching provider is 'claude-code' but the claude executable is not available; downgrading to rule-based.",
        claudeExecutablePath: config.claudeCodeExecutablePath,
      }),
    );
    improvementMessageGenerator = fallbackGenerator;
  } else {
    // LLM path: build cache + invoker + LLM adaptor factory.
    const narrativeCache = createDrizzleLlmNarrativeCacheRepository(database);

    const invoker =
      config.llmCoachingProvider === "claude-code"
        ? createClaudeCodeNarrativeInvoker({
            claudeExecutablePath: config.claudeCodeExecutablePath,
            providerModel: config.claudeCodeModel,
            timeoutMs: config.llmNarrativeTimeoutMilliseconds,
            childEnv: buildClaudeCodeChildEnv(),
          })
        : createOllamaNarrativeInvoker({
            ollamaEndpoint: config.ollamaEndpoint,
            ollamaModel: config.ollamaModel,
            timeoutMs: config.llmNarrativeTimeoutMilliseconds,
          });

    const providerModel =
      config.llmCoachingProvider === "claude-code" ? config.claudeCodeModel : config.ollamaModel;

    improvementMessageGenerator = createLlmImprovementMessageGenerator({
      provider: config.llmCoachingProvider,
      invoker,
      cache: narrativeCache,
      fallback: fallbackGenerator,
      promptVersion: config.llmNarrativePromptVersion,
      providerModel,
      logger, // ADR-023 D3 (M-TMO-9): pass structured logger for fallback observability
    });
  }

  return improvementMessageGenerator;
};
