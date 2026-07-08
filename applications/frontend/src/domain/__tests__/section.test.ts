import { describe, it, expect } from "vitest";
import {
  createSectionBodyText,
  createSectionVersion,
  createSectionIdentifier,
  createSection,
} from "../section";
import { createSectionSeriesIdentifier } from "../section-series";

describe("createSectionBodyText", () => {
  it("空文字はエラーを返す", () => {
    const result = createSectionBodyText("");
    expect(result.isErr()).toBe(true);
  });

  it("空白のみはエラーを返す", () => {
    const result = createSectionBodyText("   ");
    expect(result.isErr()).toBe(true);
  });

  it("英字が十分にある本文は成功する", () => {
    const result = createSectionBodyText("Hello, my name is John. Nice to meet you.");
    expect(result.isOk()).toBe(true);
  });

  it("英字割合が低い（日本語のみ）はエラーを返す", () => {
    // 30%未満の英字割合
    const result = createSectionBodyText("これはテストです。全部日本語です。問題ありません。");
    expect(result.isErr()).toBe(true);
  });

  it("10000文字超はエラーを返す", () => {
    // 英字割合を満たしつつ 10001 文字
    const longText = "a".repeat(10001);
    const result = createSectionBodyText(longText);
    expect(result.isErr()).toBe(true);
  });

  it("ちょうど10000文字は成功する", () => {
    const longText = "a".repeat(10000);
    const result = createSectionBodyText(longText);
    expect(result.isOk()).toBe(true);
  });

  it("制御文字（NUL）を含む場合はエラーを返す", () => {
    // NUL 文字は禁止
    const result = createSectionBodyText("Hello\x00World");
    expect(result.isErr()).toBe(true);
  });

  it("改行・タブは制御文字として禁止されない", () => {
    // \n \t は許可
    const result = createSectionBodyText("Hello\nWorld\tThis is a test sentence.");
    expect(result.isOk()).toBe(true);
  });

  it("英字30%ちょうどの境界", () => {
    // 10文字中3文字が英字 = 30%
    const text = "abc日本語日本語日";
    const engCount = (text.match(/[a-zA-Z]/g) ?? []).length;
    const ratio = engCount / text.length;
    if (ratio >= 0.3) {
      expect(createSectionBodyText(text).isOk()).toBe(true);
    } else {
      expect(createSectionBodyText(text).isErr()).toBe(true);
    }
  });
});

describe("createSectionVersion", () => {
  it("1は有効", () => {
    const result = createSectionVersion(1);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(1);
  });

  it("0はエラーを返す", () => {
    const result = createSectionVersion(0);
    expect(result.isErr()).toBe(true);
  });

  it("負数はエラーを返す", () => {
    const result = createSectionVersion(-1);
    expect(result.isErr()).toBe(true);
  });

  it("小数はエラーを返す", () => {
    const result = createSectionVersion(1.5);
    expect(result.isErr()).toBe(true);
  });
});

describe("createSection", () => {
  it("ActiveSection を作成しイベントを返す", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const identifier = createSectionIdentifier("01HTEST000000000003");
    const seriesIdentifier = createSectionSeriesIdentifier("01HTEST000000000002");
    const bodyText = createSectionBodyText("Hello, this is a test sentence for English practice.");
    const version = createSectionVersion(1);

    if (!identifier || !seriesIdentifier || bodyText.isErr() || version.isErr()) {
      throw new Error("setup failed");
    }

    const output = createSection({
      identifier,
      sectionSeries: seriesIdentifier,
      version: version._unsafeUnwrap(),
      bodyText: bodyText._unsafeUnwrap(),
      now,
    });

    expect(output.section.type).toBe("active");
    expect(output.section.createdAt).toBe(now);
    expect(output.events).toHaveLength(1);
    expect(output.events[0].type).toBe("sectionCreated");
  });
});
