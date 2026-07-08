/**
 * phenomenon ユーティリティのユニットテスト
 */

import { describe, expect, it } from "vitest";
import {
  getPhenomenonIcon,
  getPhenomenonLabelJa,
  getPhenomenonLabelEn,
  confidenceToLevel,
  PHENOMENON_ICONS,
  PHENOMENON_LABELS_JA,
  PHENOMENON_LABELS_EN,
} from "./phenomenon";
import type { FindingPhenomenon } from "./api-types";

describe("getPhenomenonIcon", () => {
  it("substitution は ⇄ を返す", () => {
    expect(getPhenomenonIcon("substitution")).toBe("⇄");
  });

  it("omission は ∅ を返す", () => {
    expect(getPhenomenonIcon("omission")).toBe("∅");
  });

  it("epenthesis は ‸ を返す", () => {
    expect(getPhenomenonIcon("epenthesis")).toBe("‸");
  });

  it("lexicalStress は ˈ を返す", () => {
    expect(getPhenomenonIcon("lexicalStress")).toBe("ˈ");
  });

  it("null のとき空文字を返す", () => {
    expect(getPhenomenonIcon(null)).toBe("");
  });

  it("全 11 phenomenon に対してアイコンが存在する", () => {
    const phenomena: FindingPhenomenon[] = [
      "substitution",
      "omission",
      "insertion",
      "connectedSpeech",
      "weakForm",
      "linking",
      "flap",
      "assimilation",
      "reduction",
      "epenthesis",
      "lexicalStress",
    ];
    for (const phenomenon of phenomena) {
      expect(PHENOMENON_ICONS[phenomenon]).toBeTruthy();
    }
  });
});

describe("getPhenomenonLabelJa", () => {
  it("substitution は 置換 を返す", () => {
    expect(getPhenomenonLabelJa("substitution")).toBe("置換");
  });

  it("weakForm は 弱形 を返す", () => {
    expect(getPhenomenonLabelJa("weakForm")).toBe("弱形");
  });

  it("null のとき空文字を返す", () => {
    expect(getPhenomenonLabelJa(null)).toBe("");
  });

  it("全 11 phenomenon に対して日本語ラベルが存在する", () => {
    const phenomena: FindingPhenomenon[] = [
      "substitution",
      "omission",
      "insertion",
      "connectedSpeech",
      "weakForm",
      "linking",
      "flap",
      "assimilation",
      "reduction",
      "epenthesis",
      "lexicalStress",
    ];
    for (const phenomenon of phenomena) {
      expect(PHENOMENON_LABELS_JA[phenomenon]).toBeTruthy();
    }
  });
});

describe("getPhenomenonLabelEn", () => {
  it("substitution は substitution を返す", () => {
    expect(getPhenomenonLabelEn("substitution")).toBe("substitution");
  });

  it("lexicalStress は lexical stress を返す", () => {
    expect(getPhenomenonLabelEn("lexicalStress")).toBe("lexical stress");
  });

  it("null のとき空文字を返す", () => {
    expect(getPhenomenonLabelEn(null)).toBe("");
  });

  it("全 11 phenomenon に対して英語ラベルが存在する", () => {
    const phenomena: FindingPhenomenon[] = [
      "substitution",
      "omission",
      "insertion",
      "connectedSpeech",
      "weakForm",
      "linking",
      "flap",
      "assimilation",
      "reduction",
      "epenthesis",
      "lexicalStress",
    ];
    for (const phenomenon of phenomena) {
      expect(PHENOMENON_LABELS_EN[phenomenon]).toBeTruthy();
    }
  });
});

describe("confidenceToLevel", () => {
  it("0.9 は high を返す", () => {
    expect(confidenceToLevel(0.9)).toBe("high");
  });

  it("0.75 は high を返す（境界）", () => {
    expect(confidenceToLevel(0.75)).toBe("high");
  });

  it("0.6 は mid を返す", () => {
    expect(confidenceToLevel(0.6)).toBe("mid");
  });

  it("0.5 は mid を返す（境界）", () => {
    expect(confidenceToLevel(0.5)).toBe("mid");
  });

  it("0.4 は low を返す", () => {
    expect(confidenceToLevel(0.4)).toBe("low");
  });

  it("0.0 は low を返す", () => {
    expect(confidenceToLevel(0.0)).toBe("low");
  });
});
