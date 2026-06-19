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

  // ADR-017 D2: epenthesis — insertedVowel present
  it("(ADR-017 D2) epenthesis with insertedVowel names the vowel with /vowel/ notation", () => {
    const message = generator.generate({
      phenomenon: "epenthesis",
      expected: { text: "strike", ipa: null },
      detected: { text: null, ipa: null },
      insertedVowel: "ɯ",
    });
    expect(typeof message).toBe("string");
    expect(message.length).toBeGreaterThan(0);
    // 母音が /ɯ/ 記法で含まれる
    expect(message).toContain("/ɯ/");
    // 単語名は含む
    expect(message).toContain("strike");
  });

  // ADR-017 D2: epenthesis — insertedVowel null → generic position message
  it("(ADR-017 D2) epenthesis with insertedVowel null produces generic position message", () => {
    const message = generator.generate({
      phenomenon: "epenthesis",
      expected: { text: "world", ipa: null },
      detected: { text: null, ipa: null },
      insertedVowel: null,
    });
    expect(typeof message).toBe("string");
    expect(message.length).toBeGreaterThan(0);
    // 単語を「母音」として名指さない
    expect(message).not.toContain("「world」という母音");
    // 汎用位置メッセージを含む（単語名 + 余分な母音）
    expect(message).toContain("world");
    expect(message).toContain("母音");
  });

  // ADR-020 M-HOW-6: ACL howJa branches on bare detectedTopCandidate via findStepsForSubstitute
  describe("(ADR-020 M-HOW-6) howJa ACL-layer branching on detectedTopCandidate", () => {
    it("(M-HOW-6) /l/ finding with detectedTopCandidate='ɾ' yields l-r-substitution ɾ-variant step in howJa", () => {
      const layers = generator.generateFeedbackLayers({
        phenomenon: "substitution",
        expected: { text: "light", ipa: null },
        detected: { text: null, ipa: null },
        catalogId: "l-r-substitution",
        detectedTopCandidate: "ɾ",
      });
      // l-r-substitution substituteVariants["ɾ"] unique text: 弾き音と違い、当てたまま保持する
      expect(layers.howJa).toContain("弾き音と違い、当てたまま保持する");
    });

    it("(M-HOW-6) /r/ finding with detectedTopCandidate='ɾ' yields r-substitution ɾ-variant step in howJa, different from /l/ howJa", () => {
      const lLayers = generator.generateFeedbackLayers({
        phenomenon: "substitution",
        expected: { text: "light", ipa: null },
        detected: { text: null, ipa: null },
        catalogId: "l-r-substitution",
        detectedTopCandidate: "ɾ",
      });
      const rLayers = generator.generateFeedbackLayers({
        phenomenon: "substitution",
        expected: { text: "right", ipa: null },
        detected: { text: null, ipa: null },
        catalogId: "r-substitution",
        detectedTopCandidate: "ɾ",
      });
      // r-substitution substituteVariants["ɾ"] unique text: 舌先を一切接触させない
      expect(rLayers.howJa).toContain("舌先を一切接触させない");
      // Proves real branching: /l/ and /r/ howJa must differ
      expect(lLayers.howJa).not.toBe(rLayers.howJa);
    });

    it("(M-HOW-6) /l/ finding with detectedTopCandidate=null falls back to generic stepsJa and excludes variant-only text", () => {
      const layers = generator.generateFeedbackLayers({
        phenomenon: "substitution",
        expected: { text: "light", ipa: null },
        detected: { text: null, ipa: null },
        catalogId: "l-r-substitution",
        detectedTopCandidate: null,
      });
      // Generic stepsJa[0] contains: 軽く当てる (not in variant steps)
      expect(layers.howJa).toContain("軽く当てる");
      // Variant-only text must NOT appear when detectedTopCandidate is null
      expect(layers.howJa).not.toContain("弾き音と違い、当てたまま保持する");
    });
  });

  // M-APD-16 (ADR-018 D6): acousticEvidence → howJa articulatory テキスト分岐
  describe("(M-APD-16) acousticEvidence direction labels → howJa articulatory text", () => {
    it("(M-APD-16) tongueHeight=tooLow yields howJa different from bare template", () => {
      const layers = generator.generateFeedbackLayers({
        phenomenon: "substitution",
        expected: { text: null, ipa: "iː" },
        detected: { text: null, ipa: "ɪ" },
        acousticEvidence: {
          tongueHeight: "tooLow",
          tongueBackness: "ok",
          rhoticity: "ok",
          sibilantPlace: "ok",
          vowelLength: "ok",
          measuredF1Hz: 450,
          measuredF2Hz: 2100,
          measuredF3Hz: 3000,
          targetF1Hz: 270,
          targetF2Hz: 2290,
          targetF3Hz: 3010,
        },
      });
      const bareTemplateLayers = generator.generateFeedbackLayers({
        phenomenon: "substitution",
        expected: { text: null, ipa: "iː" },
        detected: { text: null, ipa: "ɪ" },
        acousticEvidence: null,
      });
      // acousticEvidence あり → howJa が変わること
      expect(layers.howJa).not.toBe(bareTemplateLayers.howJa);
      // 舌高 articulatory テキストを含むこと
      expect(layers.howJa).toContain("舌をもっと高く");
    });

    it("(M-APD-16) rhoticity=insufficient yields articulatory howJa mentioning F3/rhoticity", () => {
      const layers = generator.generateFeedbackLayers({
        phenomenon: "substitution",
        expected: { text: null, ipa: "r" },
        detected: { text: null, ipa: "ɾ" },
        acousticEvidence: {
          tongueHeight: "ok",
          tongueBackness: "ok",
          rhoticity: "insufficient",
          sibilantPlace: "ok",
          vowelLength: "ok",
          measuredF1Hz: null,
          measuredF2Hz: null,
          measuredF3Hz: 2200,
          targetF1Hz: null,
          targetF2Hz: null,
          targetF3Hz: null,
        },
      });
      expect(layers.howJa).toContain("rhoticity");
    });

    it("(M-APD-16) vowelLength=tooShort yields howJa about vowel duration", () => {
      const layers = generator.generateFeedbackLayers({
        phenomenon: "substitution",
        expected: { text: null, ipa: "iː" },
        detected: { text: null, ipa: "ɪ" },
        acousticEvidence: {
          tongueHeight: "ok",
          tongueBackness: "ok",
          rhoticity: "ok",
          sibilantPlace: "ok",
          vowelLength: "tooShort",
          measuredF1Hz: null,
          measuredF2Hz: null,
          measuredF3Hz: null,
          targetF1Hz: null,
          targetF2Hz: null,
          targetF3Hz: null,
        },
      });
      expect(layers.howJa).toContain("母音をもっと長く");
    });

    it("(M-APD-16) acousticEvidence=null keeps legacy howJa unchanged (backward compat)", () => {
      const withNull = generator.generateFeedbackLayers({
        phenomenon: "substitution",
        expected: { text: "hello", ipa: null },
        detected: { text: "helo", ipa: null },
        acousticEvidence: null,
      });
      const withUndefined = generator.generateFeedbackLayers({
        phenomenon: "substitution",
        expected: { text: "hello", ipa: null },
        detected: { text: "helo", ipa: null },
      });
      // null と undefined いずれも従来 howJa を返す（後方互換）
      expect(withNull.howJa).toBe(withUndefined.howJa);
      // 空ではないこと
      expect(withNull.howJa.length).toBeGreaterThan(0);
    });

    it("(M-APD-16) all-ok acousticEvidence keeps legacy howJa unchanged", () => {
      const withAllOk = generator.generateFeedbackLayers({
        phenomenon: "substitution",
        expected: { text: "hello", ipa: null },
        detected: { text: "helo", ipa: null },
        acousticEvidence: {
          tongueHeight: "ok",
          tongueBackness: "ok",
          rhoticity: "ok",
          sibilantPlace: "ok",
          vowelLength: "ok",
          measuredF1Hz: null,
          measuredF2Hz: null,
          measuredF3Hz: null,
          targetF1Hz: null,
          targetF2Hz: null,
          targetF3Hz: null,
        },
      });
      const withNull = generator.generateFeedbackLayers({
        phenomenon: "substitution",
        expected: { text: "hello", ipa: null },
        detected: { text: "helo", ipa: null },
        acousticEvidence: null,
      });
      // 全ラベル "ok" → howJa は変わらない
      expect(withAllOk.howJa).toBe(withNull.howJa);
    });
  });

  // ADR-017 D2: epenthesis — word-as-vowel pattern must never appear
  it("(ADR-017 D2) epenthesis never produces 「<word>」という母音 for any input", () => {
    const word = "strike";
    const messageWithVowel = generator.generate({
      phenomenon: "epenthesis",
      expected: { text: word, ipa: null },
      detected: { text: null, ipa: null },
      insertedVowel: "ɯ",
    });
    const messageWithoutVowel = generator.generate({
      phenomenon: "epenthesis",
      expected: { text: word, ipa: null },
      detected: { text: null, ipa: null },
      insertedVowel: null,
    });
    expect(messageWithVowel).not.toContain(`「${word}」という母音`);
    expect(messageWithoutVowel).not.toContain(`「${word}」という母音`);
  });
});
