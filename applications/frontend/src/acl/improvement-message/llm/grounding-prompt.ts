/**
 * grounding-prompt.ts — LLM narrative grounding contract (ADR-021 D4)
 *
 * WARNING (S-LLM-1): This file defines the system prompt and user prompt template.
 * Changing either template REQUIRES bumping LLM_NARRATIVE_PROMPT_VERSION (env var).
 * Failing to bump promptVersion causes stale cached narratives to be served.
 *
 * process.env is BANNED in this directory (M-LLM-18 / no-process-env-in-llm-acl.yml).
 * All config values are passed via deps.
 */

import {
  type ImprovementMessageGeneratorInput,
  type FeedbackLayersOutput,
} from "../../../usecase/port/improvement-message-generator";
import {
  findCatalogEntryById,
  findCatalogEntry,
  type ErrorCatalogEntry,
} from "../../../domain/error-catalog";

// ---- System prompt (ADR-021 D4 / M-LLM-8) ----
// Copy verbatim — any edit here MUST be accompanied by promptVersion bump.

export const LLM_NARRATIVE_SYSTEM_PROMPT =
  "You are a pronunciation coach for Japanese (L1) speakers learning English.\n" +
  "You receive a structured FINDING object and a CATALOG object.\n" +
  "Output ONLY a JSON object with exactly three string fields whatJa, whyJa, howJa, all in Japanese.\n" +
  "You MUST NOT introduce any phonetic claim, IPA symbol, articulatory direction, formant value,\n" +
  "or word form not present in the FINDING or CATALOG objects.\n" +
  "Use only the IPA symbols and words given.\n" +
  "If a field cannot be grounded, copy the corresponding FALLBACK text verbatim.\n" +
  "Do not add markdown, preamble, or commentary.";

// ---- Catalog lookup ----

const resolveDisplayText = (
  evidence: Readonly<{ text: string | null; ipa: string | null }>,
): string | null => evidence.text ?? evidence.ipa ?? null;

const lookupCatalogEntry = (input: ImprovementMessageGeneratorInput): ErrorCatalogEntry | null => {
  const catalogEntry = input.catalogId ? findCatalogEntryById(input.catalogId) : null;
  const detectedDisplay = resolveDisplayText(input.detected);
  return catalogEntry ?? findCatalogEntry(input.phenomenon, detectedDisplay);
};

// ---- User prompt builder (M-LLM-8) ----

export type GroundingPromptParts = {
  systemPrompt: string;
  userPrompt: string;
  /** Serialised grounding text used for IPA-token validation in M-LLM-9 */
  groundingText: string;
};

/**
 * buildGroundingPrompt — builds system + user prompt pair from the generator input.
 *
 * ACOUSTIC key is OMITTED when not supplied (ADR-021 Non-goal: acoustic grounding not in scope).
 * The builder supports omission cleanly — callers simply do not pass the acoustic argument.
 *
 * FINDING keys:
 *   phenomenon, expected{text,ipa}, detected{text,ipa}, wordPositionLabel, gop,
 *   detectedTopCandidate, nBest[{phoneme,confidence}], insertedVowel, insertionPositionMs,
 *   wordPair, expectedPronunciation, functionalLoad
 *
 * CATALOG keys (sourced from ErrorCatalogEntry):
 *   l1MechanismJa, articulation.stepsJa, articulation.mannerJa, confusionSet,
 *   functionalLoad, intelligibilityImpact
 *
 * FALLBACK = rule-based generateFeedbackLayers(input) result {whatJa,whyJa,howJa}
 */
export const buildGroundingPrompt = (
  input: ImprovementMessageGeneratorInput,
  fallbackLayers: FeedbackLayersOutput,
  acoustic?: Record<string, unknown>,
): GroundingPromptParts => {
  const catalogEntry = lookupCatalogEntry(input);

  const findingObject = {
    phenomenon: input.phenomenon,
    expected: { text: input.expected.text, ipa: input.expected.ipa },
    detected: { text: input.detected.text, ipa: input.detected.ipa },
    wordPositionLabel: input.wordPositionLabel ?? null,
    gop: input.gop ?? null,
    detectedTopCandidate: input.detectedTopCandidate ?? null,
    nBest: input.nBest ? [...input.nBest] : null,
    insertedVowel: input.insertedVowel ?? null,
    insertionPositionMs: input.insertionPositionMs ?? null,
    wordPair: input.wordPair
      ? { first: input.wordPair.first, second: input.wordPair.second }
      : null,
    expectedPronunciation: input.expectedPronunciation ?? null,
    functionalLoad: input.functionalLoad ?? null,
  };

  const catalogObject = catalogEntry
    ? {
        l1MechanismJa: catalogEntry.l1MechanismJa,
        articulation: {
          stepsJa: catalogEntry.articulation?.stepsJa ?? [],
          mannerJa: catalogEntry.articulation?.mannerJa ?? "",
        },
        confusionSet: [...catalogEntry.confusionSet],
        functionalLoad: catalogEntry.functionalLoad,
        intelligibilityImpact: catalogEntry.intelligibilityImpact,
      }
    : null;

  const fallbackObject = {
    whatJa: fallbackLayers.whatJa,
    whyJa: fallbackLayers.whyJa,
    howJa: fallbackLayers.howJa,
  };

  // Build the user prompt payload — omit ACOUSTIC key entirely when not supplied
  const userPayload: Record<string, unknown> = {
    FINDING: findingObject,
    CATALOG: catalogObject,
    FALLBACK: fallbackObject,
  };

  if (acoustic !== undefined) {
    userPayload["ACOUSTIC"] = acoustic;
  }

  const userPrompt = JSON.stringify(userPayload, null, 2);

  // Grounding text = full serialisation used for IPA-token validation (M-LLM-9 condition d)
  const groundingText = userPrompt;

  return {
    systemPrompt: LLM_NARRATIVE_SYSTEM_PROMPT,
    userPrompt,
    groundingText,
  };
};

// ---- Output validation (M-LLM-9) ----

/**
 * stripCodeFence — removes a surrounding markdown code fence if present.
 *
 * Handles:
 *   ```json\n{...}\n```   (claude -p default output despite "no markdown" system prompt)
 *   ```\n{...}\n```        (fence without language tag)
 *   {... }                 (already-bare JSON — returned as-is)
 *
 * The fence strip is purely syntactic: the strict M-LLM-9 validation runs on the
 * extracted inner text unchanged. An invalid payload that happens to be fenced will
 * still fail the key/length/IPA checks below.
 *
 * Approach: trim; if starts with ```, remove first fence line and trailing ```.
 * Fallback: if the result of fence-stripping is not valid JSON, extract from first
 * '{' to last '}' so that minor surrounding whitespace/artifacts do not cause failure.
 */
const stripCodeFence = (raw: string): string => {
  const trimmed = raw.trim();

  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  // Remove first fence line (```json or ```)
  const firstNewline = trimmed.indexOf("\n");
  if (firstNewline === -1) {
    // Degenerate: single line starting with ``` — strip and return
    return trimmed
      .replace(/^```[a-z]*\s*/, "")
      .replace(/\s*```$/, "")
      .trim();
  }

  const afterOpenFence = trimmed.slice(firstNewline + 1);

  // Remove trailing ``` (possibly with trailing newline/spaces)
  const closeIndex = afterOpenFence.lastIndexOf("```");
  if (closeIndex === -1) {
    return afterOpenFence.trim();
  }

  return afterOpenFence.slice(0, closeIndex).trim();
};

/**
 * Extracts /.../ IPA tokens from a string.
 * Returns an array of the inner content (without surrounding slashes).
 */
const extractIpaTokens = (text: string): ReadonlyArray<string> => {
  const matches = text.matchAll(/\/([^/]+)\//g);
  const tokens: string[] = [];
  for (const match of matches) {
    if (match[1] !== undefined) {
      tokens.push(match[1]);
    }
  }
  return tokens;
};

export type ValidationResult =
  | { valid: true; layers: FeedbackLayersOutput }
  | { valid: false; reason: string };

/**
 * validateLlmOutput — validates LLM raw JSON string output against grounding constraints.
 *
 * Conditions (M-LLM-9):
 * (a) Parsed value is an object with EXACTLY the 3 keys whatJa/whyJa/howJa (no extras)
 * (b) Each value is a non-empty string
 * (c) Each value length >= 4 and <= 400 chars
 * (d) No /.../-style IPA token in any output field that does NOT appear in the grounding text
 */
export const validateLlmOutput = (rawOutput: string, groundingText: string): ValidationResult => {
  // Strip surrounding markdown code fence before parsing.
  // claude -p wraps output in ```json\n{...}\n``` despite the system prompt forbidding markdown.
  // ollama 7B small models exhibit the same behaviour.
  // stripCodeFence is purely syntactic — all M-LLM-9 conditions still apply to the inner text.
  const stripped = stripCodeFence(rawOutput);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped) as unknown;
  } catch {
    return { valid: false, reason: "JSON parse failed" };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { valid: false, reason: "output is not an object" };
  }

  const keys = Object.keys(parsed as object);

  // (a) Exactly 3 keys: whatJa, whyJa, howJa
  if (
    keys.length !== 3 ||
    !keys.includes("whatJa") ||
    !keys.includes("whyJa") ||
    !keys.includes("howJa")
  ) {
    return {
      valid: false,
      reason: `output must have exactly 3 keys (whatJa/whyJa/howJa); got: ${keys.join(",")}`,
    };
  }

  const obj = parsed as Record<string, unknown>;
  const whatJa = obj["whatJa"];
  const whyJa = obj["whyJa"];
  const howJa = obj["howJa"];

  // (b) Each value is a non-empty string
  if (typeof whatJa !== "string" || whatJa === "") {
    return { valid: false, reason: "whatJa must be a non-empty string" };
  }
  if (typeof whyJa !== "string" || whyJa === "") {
    return { valid: false, reason: "whyJa must be a non-empty string" };
  }
  if (typeof howJa !== "string" || howJa === "") {
    return { valid: false, reason: "howJa must be a non-empty string" };
  }

  // (c) Length 4..400
  if (whatJa.length < 4 || whatJa.length > 400) {
    return { valid: false, reason: `whatJa length ${whatJa.length} out of range [4,400]` };
  }
  if (whyJa.length < 4 || whyJa.length > 400) {
    return { valid: false, reason: `whyJa length ${whyJa.length} out of range [4,400]` };
  }
  if (howJa.length < 4 || howJa.length > 400) {
    return { valid: false, reason: `howJa length ${howJa.length} out of range [4,400]` };
  }

  // (d) IPA token check: each /.../ token in output must appear in groundingText
  for (const field of [whatJa, whyJa, howJa]) {
    const ipaTokens = extractIpaTokens(field);
    for (const token of ipaTokens) {
      if (!groundingText.includes(`/${token}/`)) {
        return {
          valid: false,
          reason: `IPA token /${token}/ in output is not present in grounding text`,
        };
      }
    }
  }

  return {
    valid: true,
    layers: { whatJa, whyJa, howJa },
  };
};
