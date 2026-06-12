/**
 * Done When (d): RuleBased ImprovementMessageGenerator のテスト。
 * substitution/omission/insertion/connectedSpeech に非空 string を返すことを確認する。
 */

import { describe, it, expect } from "vitest";
import { createRuleBasedImprovementMessageGenerator } from "../create-rule-based-improvement-message-generator";

describe("createRuleBasedImprovementMessageGenerator", () => {
  const generator = createRuleBasedImprovementMessageGenerator();

  // Done When (d): 各 phenomenon に非空 string を返す
  it("(d) returns non-empty string for phenomenon=substitution with expected and detected", () => {
    const message = generator.generate({
      phenomenon: "substitution",
      expected: { text: "hello", ipa: "/həˈloʊ/" },
      detected: { text: "helo", ipa: null },
    });
    expect(typeof message).toBe("string");
    expect(message.length).toBeGreaterThan(0);
  });

  it("(d) returns non-empty string for phenomenon=omission with ipa", () => {
    const message = generator.generate({
      phenomenon: "omission",
      expected: { text: null, ipa: "h ə l oʊ w ɜː l d" },
      detected: { text: null, ipa: "f ʌ n ɔ w ɜː l d" },
    });
    expect(typeof message).toBe("string");
    expect(message.length).toBeGreaterThan(0);
    // omission は expected の ipa を含む文を返す
    expect(message).toContain("h ə l oʊ w ɜː l d");
  });

  it("(d) returns non-empty string for phenomenon=insertion", () => {
    const message = generator.generate({
      phenomenon: "insertion",
      expected: { text: "world", ipa: null },
      detected: { text: "aworld", ipa: null },
    });
    expect(typeof message).toBe("string");
    expect(message.length).toBeGreaterThan(0);
  });

  it("(d) returns non-empty string for phenomenon=connectedSpeech", () => {
    const message = generator.generate({
      phenomenon: "connectedSpeech",
      expected: { text: "did you", ipa: null },
      detected: { text: "did you", ipa: null },
    });
    expect(typeof message).toBe("string");
    expect(message.length).toBeGreaterThan(0);
  });

  it("returns fallback non-empty string for unknown phenomenon", () => {
    const message = generator.generate({
      phenomenon: "unknownPhenomenon",
      expected: { text: null, ipa: null },
      detected: { text: null, ipa: null },
    });
    expect(typeof message).toBe("string");
    expect(message.length).toBeGreaterThan(0);
  });

  it("returns non-empty string for substitution with both text and ipa null", () => {
    const message = generator.generate({
      phenomenon: "substitution",
      expected: { text: null, ipa: null },
      detected: { text: null, ipa: null },
    });
    expect(typeof message).toBe("string");
    expect(message.length).toBeGreaterThan(0);
  });

  it("uses ipa as fallback when text is null for substitution", () => {
    const message = generator.generate({
      phenomenon: "substitution",
      expected: { text: null, ipa: "h ə l oʊ" },
      detected: { text: null, ipa: "f ʌ n" },
    });
    expect(message).toContain("h ə l oʊ");
    expect(message).toContain("f ʌ n");
  });

  it("uses text over ipa when both are provided for omission", () => {
    const message = generator.generate({
      phenomenon: "omission",
      expected: { text: "hello", ipa: "/həˈloʊ/" },
      detected: { text: null, ipa: null },
    });
    // text が優先されるので "hello" を含む
    expect(message).toContain("hello");
  });
});
