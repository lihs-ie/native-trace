import { describe, it, expect } from "vitest";
import { tokenizeSectionBody, TOKENIZER_VERSION } from "./tokenizer";

describe("tokenizeSectionBody", () => {
  it("exports TOKENIZER_VERSION", () => {
    expect(typeof TOKENIZER_VERSION).toBe("string");
    expect(TOKENIZER_VERSION.length).toBeGreaterThan(0);
  });

  it("simple sentence: each word becomes a token", () => {
    const tokens = tokenizeSectionBody("Hello world");
    expect(tokens).toHaveLength(2);
    expect(tokens[0].text).toBe("Hello");
    expect(tokens[0].startChar).toBe(0);
    expect(tokens[0].endChar).toBe(5);
    expect(tokens[1].text).toBe("world");
    expect(tokens[1].startChar).toBe(6);
    expect(tokens[1].endChar).toBe(11);
  });

  it("token indices are sequential starting from 0", () => {
    const tokens = tokenizeSectionBody("one two three");
    expect(tokens.map((t) => t.tokenIndex)).toEqual([0, 1, 2]);
  });

  it("character offsets match original text", () => {
    const text = "The quick brown fox";
    const tokens = tokenizeSectionBody(text);
    for (const token of tokens) {
      expect(text.slice(token.startChar, token.endChar)).toBe(token.text);
    }
  });

  it("punctuation is separated into its own token", () => {
    const text = "Hello, world!";
    const tokens = tokenizeSectionBody(text);
    // "Hello" "," "world" "!"
    expect(tokens).toHaveLength(4);
    expect(tokens[0].text).toBe("Hello");
    expect(tokens[1].text).toBe(",");
    expect(tokens[1].startChar).toBe(5);
    expect(tokens[1].endChar).toBe(6);
    expect(tokens[2].text).toBe("world");
    expect(tokens[3].text).toBe("!");
  });

  it("contraction don't is kept as one token", () => {
    const text = "I don't know";
    const tokens = tokenizeSectionBody(text);
    const contractionToken = tokens.find((t) => t.text === "don't");
    expect(contractionToken).toBeDefined();
    expect(contractionToken!.startChar).toBe(2);
    expect(contractionToken!.endChar).toBe(7);
    // verify offset matches source
    expect(text.slice(contractionToken!.startChar, contractionToken!.endChar)).toBe("don't");
  });

  it("contraction I'm is kept as one token", () => {
    const text = "I'm fine";
    const tokens = tokenizeSectionBody(text);
    expect(tokens[0].text).toBe("I'm");
    expect(tokens[0].startChar).toBe(0);
    expect(tokens[0].endChar).toBe(3);
  });

  it("contraction can't is kept as one token", () => {
    const text = "I can't go";
    const tokens = tokenizeSectionBody(text);
    const token = tokens.find((t) => t.text === "can't");
    expect(token).toBeDefined();
    expect(text.slice(token!.startChar, token!.endChar)).toBe("can't");
  });

  it("empty string returns empty token array", () => {
    expect(tokenizeSectionBody("")).toHaveLength(0);
  });

  it("whitespace-only string returns empty token array", () => {
    expect(tokenizeSectionBody("   \t\n  ")).toHaveLength(0);
  });

  it("period at end of sentence is separate token", () => {
    const text = "Good morning.";
    const tokens = tokenizeSectionBody(text);
    const lastToken = tokens[tokens.length - 1];
    expect(lastToken.text).toBe(".");
    expect(lastToken.startChar).toBe(12);
    expect(lastToken.endChar).toBe(13);
  });

  it("numbers are included in tokens", () => {
    const text = "Step 1 of 10";
    const tokens = tokenizeSectionBody(text);
    expect(tokens.some((t) => t.text === "1")).toBe(true);
    expect(tokens.some((t) => t.text === "10")).toBe(true);
  });

  it("all token ranges are non-overlapping and within bounds", () => {
    const text = "This is a test, isn't it?";
    const tokens = tokenizeSectionBody(text);
    let previous = -1;
    for (const token of tokens) {
      expect(token.startChar).toBeGreaterThan(previous);
      expect(token.endChar).toBeGreaterThan(token.startChar);
      expect(token.startChar).toBeGreaterThanOrEqual(0);
      expect(token.endChar).toBeLessThanOrEqual(text.length);
      previous = token.startChar;
    }
  });

  it("token text matches source text at given offsets", () => {
    const text = "We're learning, aren't we?";
    const tokens = tokenizeSectionBody(text);
    for (const token of tokens) {
      expect(text.slice(token.startChar, token.endChar)).toBe(token.text);
    }
  });
});
