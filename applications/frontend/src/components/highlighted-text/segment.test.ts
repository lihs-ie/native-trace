import { describe, expect, it } from "vitest";
import { buildSegments, type HighlightRange } from "./segment";

const makeRange = (
  finding: string,
  startChar: number,
  endChar: number,
  severity = "minor",
): HighlightRange => ({
  finding,
  severity,
  category: "accuracy",
  textRange: { startChar, endChar },
  tokenRange: null,
  audioRange: null,
  messageJa: null,
  messageEn: null,
  confidence: null,
});

describe("buildSegments", () => {
  it("空文字列は空配列を返す", () => {
    expect(buildSegments("", [])).toEqual([]);
  });

  it("ハイライトなしは全体を1セグメント返す", () => {
    const segments = buildSegments("Hello", []);
    expect(segments).toHaveLength(1);
    expect(segments[0].text).toBe("Hello");
    expect(segments[0].highlights).toHaveLength(0);
  });

  it("ハイライトが1つの場合、前・中の2セグメントを返す（末尾まで範囲の場合）", () => {
    const text = "Hello world";
    const highlights = [makeRange("f1", 6, 11)];
    const segments = buildSegments(text, highlights);

    // 境界点: {0, 6, 11} → セグメント [0,6) と [6,11) の2つ
    expect(segments).toHaveLength(2);
    expect(segments[0].text).toBe("Hello ");
    expect(segments[0].highlights).toHaveLength(0);
    expect(segments[1].text).toBe("world");
    expect(segments[1].highlights).toHaveLength(1);
    expect(segments[1].highlights[0].finding).toBe("f1");
  });

  it("ハイライトが中間にある場合、前・中・後の3セグメントを返す", () => {
    const text = "Hello world!";
    const highlights = [makeRange("f1", 6, 11)];
    const segments = buildSegments(text, highlights);

    // 境界点: {0, 6, 11, 12} → 3セグメント
    expect(segments).toHaveLength(3);
    expect(segments[0].text).toBe("Hello ");
    expect(segments[0].highlights).toHaveLength(0);
    expect(segments[1].text).toBe("world");
    expect(segments[1].highlights).toHaveLength(1);
    expect(segments[1].highlights[0].finding).toBe("f1");
    expect(segments[2].text).toBe("!");
    expect(segments[2].highlights).toHaveLength(0);
  });

  it("ハイライトが先頭から始まる場合", () => {
    const text = "Hello world";
    const highlights = [makeRange("f1", 0, 5)];
    const segments = buildSegments(text, highlights).filter((s) => s.text.length > 0);

    expect(segments[0].text).toBe("Hello");
    expect(segments[0].highlights).toHaveLength(1);
    expect(segments[1].text).toBe(" world");
    expect(segments[1].highlights).toHaveLength(0);
  });

  it("隣接する2つのハイライトは4セグメントに分割される", () => {
    const text = "abcdef";
    const highlights = [makeRange("f1", 0, 3), makeRange("f2", 3, 6)];
    const segments = buildSegments(text, highlights).filter((s) => s.text.length > 0);

    expect(segments).toHaveLength(2);
    expect(segments[0].text).toBe("abc");
    expect(segments[0].highlights[0].finding).toBe("f1");
    expect(segments[1].text).toBe("def");
    expect(segments[1].highlights[0].finding).toBe("f2");
  });

  it("重複するハイライトは両方を適用する", () => {
    const text = "abcdef";
    const highlights = [makeRange("f1", 0, 6), makeRange("f2", 2, 4)];
    const segments = buildSegments(text, highlights).filter((s) => s.text.length > 0);

    // 境界: 0, 2, 4, 6 → セグメント [0,2), [2,4), [4,6)
    expect(segments).toHaveLength(3);

    // "ab" は f1 のみ
    expect(segments[0].text).toBe("ab");
    expect(segments[0].highlights.map((h) => h.finding)).toContain("f1");
    expect(segments[0].highlights.map((h) => h.finding)).not.toContain("f2");

    // "cd" は f1 と f2 の両方
    expect(segments[1].text).toBe("cd");
    expect(segments[1].highlights.map((h) => h.finding)).toContain("f1");
    expect(segments[1].highlights.map((h) => h.finding)).toContain("f2");

    // "ef" は f1 のみ
    expect(segments[2].text).toBe("ef");
    expect(segments[2].highlights.map((h) => h.finding)).toContain("f1");
    expect(segments[2].highlights.map((h) => h.finding)).not.toContain("f2");
  });

  it("textRange が本文長を超えた場合でもクランプして処理する", () => {
    const text = "abc";
    const highlights = [makeRange("f1", 0, 100)];
    const segments = buildSegments(text, highlights).filter((s) => s.text.length > 0);

    expect(segments).toHaveLength(1);
    expect(segments[0].text).toBe("abc");
    expect(segments[0].highlights).toHaveLength(1);
  });

  it("全文プレーンテキスト（ハイライトが範囲外の場合は適用しない）", () => {
    const text = "Hello";
    const highlights = [makeRange("f1", 10, 15)]; // 完全に範囲外
    const segments = buildSegments(text, highlights).filter((s) => s.text.length > 0);

    expect(segments).toHaveLength(1);
    expect(segments[0].highlights).toHaveLength(0);
  });
});
