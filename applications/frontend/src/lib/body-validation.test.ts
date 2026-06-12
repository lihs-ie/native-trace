import { describe, expect, it } from "vitest";
import {
  computeBodyMetrics,
  hasControlCharacters,
  validateBody,
  MAX_BODY_TEXT_LENGTH,
  MIN_ENGLISH_CHAR_RATIO,
  LONG_BODY_WARN_LENGTH,
} from "./body-validation";

describe("computeBodyMetrics", () => {
  it("空文字列は words=0, chars=0, englishRatio=0 を返す", () => {
    const result = computeBodyMetrics("");
    expect(result.words).toBe(0);
    expect(result.chars).toBe(0);
    expect(result.englishRatio).toBe(0);
  });

  it("英字のみの文章は englishRatio=1 に近い値を返す", () => {
    const text = "Hello World";
    const result = computeBodyMetrics(text);
    expect(result.words).toBe(2);
    expect(result.chars).toBe(11);
    // "Hello World" = 10 英字 / 11 文字（スペース含む）
    expect(result.englishRatio).toBeCloseTo(10 / 11);
  });

  it("日本語のみの文章は englishRatio=0 を返す", () => {
    const text = "こんにちは世界";
    const result = computeBodyMetrics(text);
    expect(result.englishRatio).toBe(0);
    expect(result.chars).toBe(7);
  });

  it("英字と日本語が混在する場合、正しい割合を返す", () => {
    // 英字 10 文字、全体 20 文字 = 0.5
    const text = "Hello日本語World!!!!";
    const result = computeBodyMetrics(text);
    expect(result.englishRatio).toBeGreaterThan(0);
    expect(result.englishRatio).toBeLessThan(1);
  });

  it("複数スペースの単語は空フィルタで正しく数える", () => {
    const text = "  one  two  three  ";
    const result = computeBodyMetrics(text);
    expect(result.words).toBe(3);
  });
});

describe("hasControlCharacters", () => {
  it("制御文字がない文字列は false を返す", () => {
    expect(hasControlCharacters("Hello, World!")).toBe(false);
  });

  it("タブ文字は許容するため false を返す", () => {
    expect(hasControlCharacters("Hello\tWorld")).toBe(false);
  });

  it("改行文字は許容するため false を返す", () => {
    expect(hasControlCharacters("Hello\nWorld")).toBe(false);
  });

  it("CR は許容するため false を返す", () => {
    expect(hasControlCharacters("Hello\rWorld")).toBe(false);
  });

  it("NUL 文字（\\x00）は制御文字として検出する", () => {
    expect(hasControlCharacters("Hello\x00World")).toBe(true);
  });

  it("\\x01-\\x08 範囲の制御文字を検出する", () => {
    expect(hasControlCharacters("Hello\x07World")).toBe(true);
  });

  it("\\x0B（垂直タブ）は制御文字として検出する", () => {
    expect(hasControlCharacters("Hello\x0BWorld")).toBe(true);
  });

  it("\\x0C（フォームフィード）は制御文字として検出する", () => {
    expect(hasControlCharacters("Hello\x0CWorld")).toBe(true);
  });

  it("\\x0E-\\x1F 範囲の制御文字を検出する", () => {
    expect(hasControlCharacters("Hello\x1FWorld")).toBe(true);
  });

  it("\\x7F（DEL）は制御文字として検出する", () => {
    expect(hasControlCharacters("Hello\x7FWorld")).toBe(true);
  });
});

describe("validateBody", () => {
  describe("isNotEmpty", () => {
    it("空文字列は warn を返す", () => {
      const result = validateBody("");
      expect(result.isNotEmpty).toBe("warn");
    });

    it("非空の文字列は ok を返す", () => {
      const result = validateBody("Hello");
      expect(result.isNotEmpty).toBe("ok");
    });

    it("スペースのみは ok を返す（chars > 0）", () => {
      const result = validateBody("   ");
      expect(result.isNotEmpty).toBe("ok");
    });
  });

  describe("isWithinMaxLength", () => {
    it("MAX_BODY_TEXT_LENGTH 以内は ok を返す", () => {
      const text = "a".repeat(MAX_BODY_TEXT_LENGTH);
      const result = validateBody(text);
      expect(result.isWithinMaxLength).toBe("ok");
    });

    it("MAX_BODY_TEXT_LENGTH ちょうどは ok を返す（境界値）", () => {
      const text = "a".repeat(MAX_BODY_TEXT_LENGTH);
      expect(text.length).toBe(MAX_BODY_TEXT_LENGTH);
      const result = validateBody(text);
      expect(result.isWithinMaxLength).toBe("ok");
    });

    it("MAX_BODY_TEXT_LENGTH + 1 は warn を返す（境界値）", () => {
      const text = "a".repeat(MAX_BODY_TEXT_LENGTH + 1);
      const result = validateBody(text);
      expect(result.isWithinMaxLength).toBe("warn");
    });
  });

  describe("meetsEnglishRatio", () => {
    it("英字割合が MIN_ENGLISH_CHAR_RATIO 以上は ok を返す", () => {
      // 英字 3、全体 9。3/9 = 0.333... >= 0.3
      const text = "abc日本語日本語日";
      const metrics = computeBodyMetrics(text);
      expect(metrics.englishRatio).toBeGreaterThanOrEqual(MIN_ENGLISH_CHAR_RATIO);
      const result = validateBody(text);
      expect(result.meetsEnglishRatio).toBe("ok");
    });

    it("英字割合が MIN_ENGLISH_CHAR_RATIO ちょうどは ok を返す（境界値）", () => {
      // 英字 3、数字 7 = 全 10 文字、3/10 = 0.3 ちょうど
      const thirtyPercent = "abc1234567";
      const thirtyMetrics = computeBodyMetrics(thirtyPercent);
      expect(thirtyMetrics.englishRatio).toBeCloseTo(0.3);
      expect(validateBody(thirtyPercent).meetsEnglishRatio).toBe("ok");
    });

    it("英字割合が MIN_ENGLISH_CHAR_RATIO 未満は warn を返す（境界値）", () => {
      // 英字 2 / 全体 10 = 0.2 < 0.3
      const text = "ab12345678"; // 英字 2、数字 8 = 全 10 文字
      const metrics = computeBodyMetrics(text);
      expect(metrics.englishRatio).toBeCloseTo(0.2);
      const result = validateBody(text);
      expect(result.meetsEnglishRatio).toBe("warn");
    });

    it("空文字列は warn を返す", () => {
      const result = validateBody("");
      expect(result.meetsEnglishRatio).toBe("warn");
    });
  });

  describe("hasNoControlCharacters", () => {
    it("制御文字なし -> ok", () => {
      const result = validateBody("Hello World");
      expect(result.hasNoControlCharacters).toBe("ok");
    });

    it("制御文字あり -> warn", () => {
      const result = validateBody("Hello\x00World");
      expect(result.hasNoControlCharacters).toBe("warn");
    });

    it("改行・タブは制御文字として扱わない -> ok", () => {
      const result = validateBody("Hello\n\tWorld");
      expect(result.hasNoControlCharacters).toBe("ok");
    });
  });

  describe("isNotLong（長文分割推奨）", () => {
    it("LONG_BODY_WARN_LENGTH 以内は ok を返す", () => {
      const text = "a".repeat(LONG_BODY_WARN_LENGTH);
      const result = validateBody(text);
      expect(result.isNotLong).toBe("ok");
    });

    it("LONG_BODY_WARN_LENGTH ちょうどは ok を返す（境界値）", () => {
      const text = "a".repeat(LONG_BODY_WARN_LENGTH);
      expect(text.length).toBe(LONG_BODY_WARN_LENGTH);
      expect(validateBody(text).isNotLong).toBe("ok");
    });

    it("LONG_BODY_WARN_LENGTH + 1 は warn を返す（境界値）", () => {
      const text = "a".repeat(LONG_BODY_WARN_LENGTH + 1);
      expect(validateBody(text).isNotLong).toBe("warn");
    });
  });

  describe("統合シナリオ", () => {
    it("典型的な英文本文は全チェックが ok になる", () => {
      const text =
        "I am honored to be with you today at your commencement from one of the finest universities in the world.";
      const result = validateBody(text);
      expect(result.isNotEmpty).toBe("ok");
      expect(result.isWithinMaxLength).toBe("ok");
      expect(result.meetsEnglishRatio).toBe("ok");
      expect(result.hasNoControlCharacters).toBe("ok");
      expect(result.isNotLong).toBe("ok");
    });

    it("空文字列の isWithinMaxLength/hasNoControlCharacters/isNotLong は ok になる", () => {
      const result = validateBody("");
      expect(result.isNotEmpty).toBe("warn");
      expect(result.meetsEnglishRatio).toBe("warn");
      // isWithinMaxLength と hasNoControlCharacters と isNotLong は ok
      expect(result.isWithinMaxLength).toBe("ok");
      expect(result.hasNoControlCharacters).toBe("ok");
      expect(result.isNotLong).toBe("ok");
    });
  });
});
