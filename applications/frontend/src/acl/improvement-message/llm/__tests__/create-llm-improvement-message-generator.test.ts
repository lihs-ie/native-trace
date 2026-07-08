/**
 * Tests for LLM ACL layer (ADR-021 M-LLM-5, M-LLM-9, M-LLM-11)
 *
 * Test doubles (fakes, spies) are ONLY in this test file — never in production code.
 */

import { describe, it, expect, vi } from "vitest";
import { okAsync, errAsync } from "neverthrow";

import { createLlmImprovementMessageGenerator } from "../create-llm-improvement-message-generator";
import { createRuleBasedImprovementMessageGenerator } from "../../rule-based/create-rule-based-improvement-message-generator";
import {
  type ImprovementMessageGeneratorInput,
  type FeedbackLayersOutput,
} from "../../../../usecase/port/improvement-message-generator";
import { type LlmNarrativeCache } from "../../../../usecase/port/llm-narrative-cache";

// ---- Shared test fixtures ----

const sampleInput: ImprovementMessageGeneratorInput = {
  phenomenon: "substitution",
  expected: { text: "this", ipa: "/ð/" },
  detected: { text: "dis", ipa: "/d/" },
  wordPositionLabel: "initial",
  catalogId: null,
  detectedTopCandidate: "d",
  insertedVowel: null,
  gop: 0.42,
  functionalLoad: "high",
};

const validLlmOutput: FeedbackLayersOutput = {
  whatJa: "「/ð/」の音が「/d/」に置き換わっています",
  whyJa: "日本語に /ð/ の音素がないため、近い音の /d/ で代替しています",
  howJa: "舌先を上の歯の裏に当てて、息を漏らしながら発音してください",
};

const makeValidLlmRawJson = (layers: FeedbackLayersOutput = validLlmOutput): string =>
  JSON.stringify(layers);

// A fallback generator that always returns deterministic values
const makeFallback = () => createRuleBasedImprovementMessageGenerator();

// A cache that always returns null (miss) and records store calls
const makeMissCache = (): {
  cache: LlmNarrativeCache;
  storedSignatures: string[];
} => {
  const storedSignatures: string[] = [];
  const cache: LlmNarrativeCache = {
    findBySignature: () => okAsync(null),
    store: (signature, _layers, _meta) => {
      storedSignatures.push(signature);
      return okAsync(undefined);
    },
  };
  return { cache, storedSignatures };
};

// ---- M-LLM-5: invoker rejects → result equals fallback.generateFeedbackLayers ----

describe("M-LLM-5: invoker failure degrades to fallback", () => {
  it("when invoker rejects, generateFeedbackLayersAsync returns fallback.generateFeedbackLayers result", async () => {
    const fallback = makeFallback();
    const { cache } = makeMissCache();

    const rejectingInvoker = () => Promise.reject(new Error("LLM unavailable"));

    const generator = createLlmImprovementMessageGenerator({
      provider: "claude-code",
      invoker: rejectingInvoker,
      cache,
      fallback,
      promptVersion: "v1",
      providerModel: "claude-sonnet",
    });

    const result = await generator.generateFeedbackLayersAsync!(sampleInput);
    const expected = fallback.generateFeedbackLayers(sampleInput);

    expect(result).toEqual(expected);
  });

  it("when invoker returns empty string, generateFeedbackLayersAsync returns fallback result", async () => {
    const fallback = makeFallback();
    const { cache } = makeMissCache();

    const emptyInvoker = () => Promise.resolve("");

    const generator = createLlmImprovementMessageGenerator({
      provider: "claude-code",
      invoker: emptyInvoker,
      cache,
      fallback,
      promptVersion: "v1",
      providerModel: "claude-sonnet",
    });

    const result = await generator.generateFeedbackLayersAsync!(sampleInput);
    const expected = fallback.generateFeedbackLayers(sampleInput);

    expect(result).toEqual(expected);
  });

  it("synchronous generate delegates to fallback.generateFeedbackLayers().whatJa", () => {
    const fallback = makeFallback();
    const { cache } = makeMissCache();

    const generator = createLlmImprovementMessageGenerator({
      provider: "claude-code",
      invoker: () => Promise.resolve(""),
      cache,
      fallback,
      promptVersion: "v1",
      providerModel: "claude-sonnet",
    });

    const expected = fallback.generateFeedbackLayers(sampleInput).whatJa;
    expect(generator.generate(sampleInput)).toBe(expected);
  });

  it("cache error on findBySignature degrades to fallback", async () => {
    const fallback = makeFallback();
    const errorCache: LlmNarrativeCache = {
      findBySignature: () => errAsync({ type: "persistenceFailed" as const, reason: "db error" }),
      store: () => okAsync(undefined),
    };

    const invoker = vi.fn().mockResolvedValue(makeValidLlmRawJson());

    const generator = createLlmImprovementMessageGenerator({
      provider: "claude-code",
      invoker,
      cache: errorCache,
      fallback,
      promptVersion: "v1",
      providerModel: "claude-sonnet",
    });

    const result = await generator.generateFeedbackLayersAsync!(sampleInput);
    const expected = fallback.generateFeedbackLayers(sampleInput);

    expect(result).toEqual(expected);
    // invoker should NOT be called because cache error already means degrade
    expect(invoker).not.toHaveBeenCalled();
  });
});

// ---- M-LLM-9: output validation — 4 reject cases ----

describe("M-LLM-9: output validation rejects bad LLM outputs", () => {
  const setupGenerator = (rawLlmResponse: string) => {
    const fallback = makeFallback();
    const { cache, storedSignatures } = makeMissCache();
    const invoker = () => Promise.resolve(rawLlmResponse);

    const generator = createLlmImprovementMessageGenerator({
      provider: "claude-code",
      invoker,
      cache,
      fallback,
      promptVersion: "v1",
      providerModel: "claude-sonnet",
    });

    return { generator, fallback, storedSignatures };
  };

  it("(a) rejects object with 4 keys (extra key) → returns fallback, cache.store NOT called", async () => {
    const badOutput = JSON.stringify({
      whatJa: "valid text here",
      whyJa: "valid reason here",
      howJa: "valid advice here",
      extra: "x",
    });
    const { generator, fallback, storedSignatures } = setupGenerator(badOutput);

    const result = await generator.generateFeedbackLayersAsync!(sampleInput);
    expect(result).toEqual(fallback.generateFeedbackLayers(sampleInput));
    expect(storedSignatures).toHaveLength(0);
  });

  it("(b) rejects when whatJa is empty string → returns fallback, cache.store NOT called", async () => {
    const badOutput = JSON.stringify({
      whatJa: "",
      whyJa: "valid reason here",
      howJa: "valid advice here",
    });
    const { generator, fallback, storedSignatures } = setupGenerator(badOutput);

    const result = await generator.generateFeedbackLayersAsync!(sampleInput);
    expect(result).toEqual(fallback.generateFeedbackLayers(sampleInput));
    expect(storedSignatures).toHaveLength(0);
  });

  it("(c) rejects when howJa has 3 chars (< 4 minimum) → returns fallback, cache.store NOT called", async () => {
    const badOutput = JSON.stringify({
      whatJa: "valid text here",
      whyJa: "valid reason here",
      howJa: "abc",
    });
    const { generator, fallback, storedSignatures } = setupGenerator(badOutput);

    const result = await generator.generateFeedbackLayersAsync!(sampleInput);
    expect(result).toEqual(fallback.generateFeedbackLayers(sampleInput));
    expect(storedSignatures).toHaveLength(0);
  });

  it("(d) rejects IPA token /θ/ not present in FINDING/CATALOG → returns fallback, cache.store NOT called", async () => {
    // /θ/ is not in the sampleInput (which uses /ð/ and /d/)
    // The grounding text will contain /ð/ and /d/ but NOT /θ/
    const badOutput = JSON.stringify({
      whatJa: "「/θ/」という音が含まれています（長さ4文字以上確保）",
      whyJa: "日本語には /θ/ がないため誤りが生じます（理由テキスト）",
      howJa: "舌を歯に当てて /θ/ を練習してください（方法テキスト）",
    });
    const { generator, fallback, storedSignatures } = setupGenerator(badOutput);

    const result = await generator.generateFeedbackLayersAsync!(sampleInput);
    expect(result).toEqual(fallback.generateFeedbackLayers(sampleInput));
    expect(storedSignatures).toHaveLength(0);
  });

  it("validation pass → cache.store IS called", async () => {
    // Use IPA tokens that ARE in the grounding text (sampleInput has /ð/ and /d/)
    const goodOutput = JSON.stringify({
      whatJa: "「/ð/」の音が「/d/」に置き換わっています（確認済み）",
      whyJa: "日本語に /ð/ の音素がないため代替が起きています",
      howJa: "舌先を上の歯の裏に当てて /ð/ を意識して発音してください",
    });
    const { generator, storedSignatures } = setupGenerator(goodOutput);

    await generator.generateFeedbackLayersAsync!(sampleInput);
    expect(storedSignatures).toHaveLength(1);
  });

  it("claude real fenced output is stripped → LLM narrative used (not fallback), cache.store called", async () => {
    // Regression for the runtime FAIL: claude -p wraps the JSON in a markdown code fence
    // (```json\n{...}\n```) despite the system prompt forbidding markdown. The raw `result`
    // string is fenced; validateLlmOutput must strip the fence before JSON.parse, otherwise
    // every finding silently falls back to rule-based and the cache stays empty.
    // This fixture mirrors claude's REAL output shape (fixture-vs-reality gap that the
    // bare-JSON fixtures above did not catch).
    const innerJson = JSON.stringify({
      whatJa: "「/ð/」の音が「/d/」に置き換わっています（フェンス検証）",
      whyJa: "日本語に /ð/ の音素がないため /d/ で代替しています",
      howJa: "舌先を上の歯の裏に当てて /ð/ を意識して発音してください",
    });
    const fencedOutput = "```json\n" + innerJson + "\n```";
    const { generator, fallback, storedSignatures } = setupGenerator(fencedOutput);

    const result = await generator.generateFeedbackLayersAsync!(sampleInput);

    // The fenced LLM narrative is used, NOT the rule-based fallback ...
    expect(result.whatJa).toContain("フェンス検証");
    expect(result).not.toEqual(fallback.generateFeedbackLayers(sampleInput));
    // ... and a cache row was written (proves validation passed on the stripped inner text).
    expect(storedSignatures).toHaveLength(1);
  });
});

// ---- M-LLM-11: cache signature + flow ----

describe("M-LLM-11: cache signature and adaptor flow", () => {
  it("1st call invokes LLM + stores in cache; 2nd call hits cache (no invoker call)", async () => {
    const fallback = makeFallback();

    // Simple in-memory cache
    const cacheStore = new Map<string, FeedbackLayersOutput>();
    const invokerCallCount = { count: 0 };
    const storeCallCount = { count: 0 };

    const cache: LlmNarrativeCache = {
      findBySignature: (sig) => okAsync(cacheStore.get(sig) ?? null),
      store: (sig, layers, _meta) => {
        storeCallCount.count++;
        cacheStore.set(sig, layers);
        return okAsync(undefined);
      },
    };

    // Use IPA tokens from sampleInput to pass validation
    const goodRawOutput = JSON.stringify({
      whatJa: "「/ð/」の音が「/d/」に置き換わっています（確認済み）",
      whyJa: "日本語に /ð/ の音素がないため代替が起きています",
      howJa: "舌先を上の歯の裏に当てて /ð/ を意識して発音してください",
    });

    const invoker = () => {
      invokerCallCount.count++;
      return Promise.resolve(goodRawOutput);
    };

    const generator = createLlmImprovementMessageGenerator({
      provider: "claude-code",
      invoker,
      cache,
      fallback,
      promptVersion: "v1",
      providerModel: "claude-sonnet",
    });

    // First call: invoker called, cache stored
    const result1 = await generator.generateFeedbackLayersAsync!(sampleInput);
    expect(invokerCallCount.count).toBe(1);
    expect(storeCallCount.count).toBe(1);

    // Second call: cache hit, invoker NOT called
    const result2 = await generator.generateFeedbackLayersAsync!(sampleInput);
    expect(invokerCallCount.count).toBe(1); // still 1
    expect(result2).toEqual(result1);
  });

  it("different promptVersion produces different signature (cache miss)", async () => {
    const fallback = makeFallback();
    const cacheStore = new Map<string, FeedbackLayersOutput>();
    const invokerCallCount = { count: 0 };

    const cache: LlmNarrativeCache = {
      findBySignature: (sig) => okAsync(cacheStore.get(sig) ?? null),
      store: (sig, layers, _meta) => {
        cacheStore.set(sig, layers);
        return okAsync(undefined);
      },
    };

    const goodRawOutput = JSON.stringify({
      whatJa: "「/ð/」の音が「/d/」に置き換わっています（確認済み）",
      whyJa: "日本語に /ð/ の音素がないため代替が起きています",
      howJa: "舌先を上の歯の裏に当てて /ð/ を意識して発音してください",
    });

    const invoker = () => {
      invokerCallCount.count++;
      return Promise.resolve(goodRawOutput);
    };

    const generator1 = createLlmImprovementMessageGenerator({
      provider: "claude-code",
      invoker,
      cache,
      fallback,
      promptVersion: "v1",
      providerModel: "claude-sonnet",
    });

    const generator2 = createLlmImprovementMessageGenerator({
      provider: "claude-code",
      invoker,
      cache,
      fallback,
      promptVersion: "v2", // different version
      providerModel: "claude-sonnet",
    });

    await generator1.generateFeedbackLayersAsync!(sampleInput);
    expect(invokerCallCount.count).toBe(1);

    // Different promptVersion → different signature → cache miss → invoker called again
    await generator2.generateFeedbackLayersAsync!(sampleInput);
    expect(invokerCallCount.count).toBe(2);
  });

  it("different providerModel produces different signature", async () => {
    const fallback = makeFallback();
    const cacheStore = new Map<string, FeedbackLayersOutput>();
    const invokerCallCount = { count: 0 };

    const cache: LlmNarrativeCache = {
      findBySignature: (sig) => okAsync(cacheStore.get(sig) ?? null),
      store: (sig, layers, _meta) => {
        cacheStore.set(sig, layers);
        return okAsync(undefined);
      },
    };

    const goodRawOutput = JSON.stringify({
      whatJa: "「/ð/」の音が「/d/」に置き換わっています（確認済み）",
      whyJa: "日本語に /ð/ の音素がないため代替が起きています",
      howJa: "舌先を上の歯の裏に当てて /ð/ を意識して発音してください",
    });

    const invoker = () => {
      invokerCallCount.count++;
      return Promise.resolve(goodRawOutput);
    };

    const generator1 = createLlmImprovementMessageGenerator({
      provider: "claude-code",
      invoker,
      cache,
      fallback,
      promptVersion: "v1",
      providerModel: "claude-sonnet",
    });

    const generator2 = createLlmImprovementMessageGenerator({
      provider: "claude-code",
      invoker,
      cache,
      fallback,
      promptVersion: "v1",
      providerModel: "claude-opus", // different model
    });

    await generator1.generateFeedbackLayersAsync!(sampleInput);
    expect(invokerCallCount.count).toBe(1);

    await generator2.generateFeedbackLayersAsync!(sampleInput);
    expect(invokerCallCount.count).toBe(2);
  });

  it("different detectedTopCandidate produces different signature", async () => {
    const fallback = makeFallback();
    const cacheStore = new Map<string, FeedbackLayersOutput>();
    const invokerCallCount = { count: 0 };

    const cache: LlmNarrativeCache = {
      findBySignature: (sig) => okAsync(cacheStore.get(sig) ?? null),
      store: (sig, layers, _meta) => {
        cacheStore.set(sig, layers);
        return okAsync(undefined);
      },
    };

    const goodRawOutput = JSON.stringify({
      whatJa: "「/ð/」の音が「/d/」に置き換わっています（確認済み）",
      whyJa: "日本語に /ð/ の音素がないため代替が起きています",
      howJa: "舌先を上の歯の裏に当てて /ð/ を意識して発音してください",
    });

    const invoker = () => {
      invokerCallCount.count++;
      return Promise.resolve(goodRawOutput);
    };

    const input1: ImprovementMessageGeneratorInput = { ...sampleInput, detectedTopCandidate: "d" };
    const input2: ImprovementMessageGeneratorInput = { ...sampleInput, detectedTopCandidate: "t" };

    const generator = createLlmImprovementMessageGenerator({
      provider: "claude-code",
      invoker,
      cache,
      fallback,
      promptVersion: "v1",
      providerModel: "claude-sonnet",
    });

    await generator.generateFeedbackLayersAsync!(input1);
    expect(invokerCallCount.count).toBe(1);

    // Different detectedTopCandidate → different signature → cache miss
    await generator.generateFeedbackLayersAsync!(input2);
    expect(invokerCallCount.count).toBe(2);
  });
});

// ---- M-TMO-7: logger.warn on fallback + onFallback callback ----

describe("M-TMO-7: structured logger.warn emitted on each fallback path", () => {
  const makeLogger = () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  });

  it("(cache_error) logger.warn called with reason: cache_error", async () => {
    const logger = makeLogger();
    const fallback = makeFallback();

    const cacheWithError: LlmNarrativeCache = {
      findBySignature: () => errAsync({ type: "persistenceFailed" as const, reason: "db error" }),
      store: () => okAsync(undefined),
    };

    const generator = createLlmImprovementMessageGenerator({
      provider: "claude-code",
      invoker: () => Promise.resolve(""),
      cache: cacheWithError,
      fallback,
      promptVersion: "v1",
      providerModel: "claude-sonnet",
      logger,
    });

    await generator.generateFeedbackLayersAsync!(sampleInput);

    expect(logger.warn).toHaveBeenCalledOnce();
    const [message, context] = logger.warn.mock.calls[0]!;
    expect(message).toBe("llm narrative fallback");
    expect((context as { reason: string }).reason).toBe("cache_error");
  });

  it("(invoker_error) logger.warn called with reason: invoker_error when invoker rejects", async () => {
    const logger = makeLogger();
    const fallback = makeFallback();
    const { cache } = makeMissCache();

    const generator = createLlmImprovementMessageGenerator({
      provider: "claude-code",
      invoker: () => Promise.reject(new Error("LLM timeout")),
      cache,
      fallback,
      promptVersion: "v1",
      providerModel: "claude-sonnet",
      logger,
    });

    await generator.generateFeedbackLayersAsync!(sampleInput);

    expect(logger.warn).toHaveBeenCalledOnce();
    const [message, context] = logger.warn.mock.calls[0]!;
    expect(message).toBe("llm narrative fallback");
    expect((context as { reason: string }).reason).toBe("invoker_error");
  });

  it("(parse_failed) logger.warn called with reason: parse_failed when invoker returns empty string", async () => {
    const logger = makeLogger();
    const fallback = makeFallback();
    const { cache } = makeMissCache();

    const generator = createLlmImprovementMessageGenerator({
      provider: "claude-code",
      invoker: () => Promise.resolve(""),
      cache,
      fallback,
      promptVersion: "v1",
      providerModel: "claude-sonnet",
      logger,
    });

    await generator.generateFeedbackLayersAsync!(sampleInput);

    expect(logger.warn).toHaveBeenCalledOnce();
    const [message, context] = logger.warn.mock.calls[0]!;
    expect(message).toBe("llm narrative fallback");
    expect((context as { reason: string }).reason).toBe("parse_failed");
  });

  it("(grounding_rejected) logger.warn called with reason: grounding_rejected on bad IPA token", async () => {
    const logger = makeLogger();
    const fallback = makeFallback();
    const { cache } = makeMissCache();

    // Contains /θ/ which is not in sampleInput's grounding text (/ð/ and /d/)
    const badOutput = JSON.stringify({
      whatJa: "「/θ/」という音が含まれています（長さ4文字以上確保）",
      whyJa: "日本語には /θ/ がないため誤りが生じます（理由テキスト）",
      howJa: "舌を歯に当てて /θ/ を練習してください（方法テキスト）",
    });

    const generator = createLlmImprovementMessageGenerator({
      provider: "claude-code",
      invoker: () => Promise.resolve(badOutput),
      cache,
      fallback,
      promptVersion: "v1",
      providerModel: "claude-sonnet",
      logger,
    });

    await generator.generateFeedbackLayersAsync!(sampleInput);

    expect(logger.warn).toHaveBeenCalledOnce();
    const [message, context] = logger.warn.mock.calls[0]!;
    expect(message).toBe("llm narrative fallback");
    expect((context as { reason: string }).reason).toBe("grounding_rejected");
  });

  it("(no logger) no throw and no warn when logger dep is absent", async () => {
    const fallback = makeFallback();
    const { cache } = makeMissCache();

    // No logger — backward compat
    const generator = createLlmImprovementMessageGenerator({
      provider: "claude-code",
      invoker: () => Promise.reject(new Error("unavailable")),
      cache,
      fallback,
      promptVersion: "v1",
      providerModel: "claude-sonnet",
      // logger intentionally absent
    });

    // Must not throw even without logger
    await expect(generator.generateFeedbackLayersAsync!(sampleInput)).resolves.toEqual(
      fallback.generateFeedbackLayers(sampleInput),
    );
  });

  it("(onFallback callback) fires with the same reason as logger when invoker rejects", async () => {
    const logger = makeLogger();
    const fallback = makeFallback();
    const { cache } = makeMissCache();

    const generator = createLlmImprovementMessageGenerator({
      provider: "claude-code",
      invoker: () => Promise.reject(new Error("unavailable")),
      cache,
      fallback,
      promptVersion: "v1",
      providerModel: "claude-sonnet",
      logger,
    });

    const capturedReasons: string[] = [];
    const onFallback = (reason: string) => {
      capturedReasons.push(reason);
    };

    await generator.generateFeedbackLayersAsync!(sampleInput, onFallback);

    // onFallback fires once with "invoker_error"
    expect(capturedReasons).toEqual(["invoker_error"]);
    // logger.warn fires with same reason
    expect(logger.warn).toHaveBeenCalledOnce();
    expect((logger.warn.mock.calls[0]![1] as { reason: string }).reason).toBe("invoker_error");
  });
});
