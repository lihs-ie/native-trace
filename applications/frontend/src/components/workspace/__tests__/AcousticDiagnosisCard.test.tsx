/**
 * AcousticDiagnosisCard — 音響音声学診断カード テスト (ADR-024)
 *
 * 仕様: docs/specs/acoustic-diagnosis-visual-layer.md M-ADVL-2〜M-ADVL-9
 *
 * - M-ADVL-2: null → .acoustic なし、非 null → .acoustic あり
 * - M-ADVL-3: .adr-badge--accepted + .layer-tag--enrich + IPA テキスト存在
 * - M-ADVL-4: measured/target 点の left/top が座標式に合致 (±0.5% 許容)
 * - M-ADVL-5: vp-vec の width/rotate が measured→target ベクトルに合致
 * - M-ADVL-6: .dir-k テキスト + 非空 .dir-hz
 * - M-ADVL-7: rhoticity チップに F3 数値が含まれること
 * - M-ADVL-8: mb-val/mb-target 位置がスカラーから算出、null 時はバー非表示
 * - M-ADVL-9: .disclaimer が 1 件、Lobanov/正規化・3・減点を含む
 */

import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import type { AcousticEvidenceDto } from "@/lib/api-types";
import { AcousticDiagnosisCard } from "../AcousticDiagnosisCard";

// ---- テスト用 fixture ----

const buildAcousticEvidence = (
  overrides: Partial<AcousticEvidenceDto> = {},
): AcousticEvidenceDto => ({
  tongueHeight: "tooLow",
  tongueBackness: "tooBack",
  rhoticity: "insufficient",
  sibilantPlace: null,
  vowelLength: "ok",
  measuredF1Hz: 450,
  measuredF2Hz: 1100,
  measuredF3Hz: 1800,
  targetF1Hz: 344,
  targetF2Hz: 2300,
  targetF3Hz: 2000,
  spectralCentroidHz: 3600,
  tenseLengthRatio: 1.5,
  signedF1SdDeviation: 1.4,
  signedF2SdDeviation: -1.1,
  signedF3SdDeviation: -0.8,
  targetSpectralCentroidHz: 4500,
  targetTenseLengthRatio: 1.4,
  ...overrides,
});

// ---- M-ADVL-2: null 制御 ----

describe("AcousticDiagnosisCard (M-ADVL-2) null 制御", () => {
  it("acousticEvidence=null のとき .acoustic が DOM に存在しない", () => {
    const { container } = render(<AcousticDiagnosisCard acousticEvidence={null} />);
    expect(container.querySelector(".acoustic")).toBeNull();
  });

  it("acousticEvidence が非 null のとき .acoustic が存在する", () => {
    const { container } = render(
      <AcousticDiagnosisCard acousticEvidence={buildAcousticEvidence()} />,
    );
    expect(container.querySelector(".acoustic")).not.toBeNull();
  });
});

// ---- M-ADVL-3: ヘッダ構成 ----

describe("AcousticDiagnosisCard (M-ADVL-3) ヘッダ構成", () => {
  it(".adr-badge--accepted が存在する", () => {
    const { container } = render(
      <AcousticDiagnosisCard acousticEvidence={buildAcousticEvidence()} phonemeLabel="/iː/" />,
    );
    expect(container.querySelector(".adr-badge--accepted")).not.toBeNull();
  });

  it(".layer-tag--enrich が存在する", () => {
    const { container } = render(
      <AcousticDiagnosisCard acousticEvidence={buildAcousticEvidence()} phonemeLabel="/iː/" />,
    );
    expect(container.querySelector(".layer-tag--enrich")).not.toBeNull();
  });

  it("phonemeLabel テキストが DOM 内に存在する", () => {
    const { container } = render(
      <AcousticDiagnosisCard acousticEvidence={buildAcousticEvidence()} phonemeLabel="/iː/" />,
    );
    expect(container.textContent).toContain("/iː/");
  });
});

// ---- M-ADVL-4: 母音プロット座標写像 ----

describe("AcousticDiagnosisCard (M-ADVL-4) 母音プロット座標", () => {
  /**
   * F2=1100Hz: left = clamp((1100-700)/2000, 0,1) * 100 = 20%
   * F1=450Hz:  top  = clamp((450-200)/800,   0,1) * 100 = 31.25%
   */
  it("measured 点が期待 left/top に配置される (±0.5%)", () => {
    const ae = buildAcousticEvidence({
      measuredF1Hz: 450,
      measuredF2Hz: 1100,
    });
    const { container } = render(<AcousticDiagnosisCard acousticEvidence={ae} />);
    const measuredPt = container.querySelector(".vp-pt--measured") as HTMLElement | null;
    expect(measuredPt).not.toBeNull();
    const leftStr = measuredPt?.style.left ?? "";
    const topStr = measuredPt?.style.top ?? "";
    const leftValue = parseFloat(leftStr);
    const topValue = parseFloat(topStr);
    expect(Math.abs(leftValue - 20)).toBeLessThan(0.5);
    expect(Math.abs(topValue - 31.25)).toBeLessThan(0.5);
  });

  /**
   * target F2=2300Hz: left = clamp((2300-700)/2000, 0,1)*100 = 80%
   * target F1=344Hz:  top  = clamp((344-200)/800, 0,1)*100 = 18%
   */
  it("target 点が期待 left/top に配置される (±0.5%)", () => {
    const ae = buildAcousticEvidence({
      targetF1Hz: 344,
      targetF2Hz: 2300,
    });
    const { container } = render(<AcousticDiagnosisCard acousticEvidence={ae} />);
    const targetPt = container.querySelector(".vp-pt--target") as HTMLElement | null;
    expect(targetPt).not.toBeNull();
    const leftValue = parseFloat(targetPt?.style.left ?? "0");
    const topValue = parseFloat(targetPt?.style.top ?? "0");
    expect(Math.abs(leftValue - 80)).toBeLessThan(0.5);
    expect(Math.abs(topValue - 18)).toBeLessThan(0.5);
  });

  it("F1/F2 が null のとき measured 点が描画されない", () => {
    const ae = buildAcousticEvidence({
      measuredF1Hz: null,
      measuredF2Hz: null,
    });
    const { container } = render(<AcousticDiagnosisCard acousticEvidence={ae} />);
    expect(container.querySelector(".vp-pt--measured")).toBeNull();
  });
});

// ---- M-ADVL-5: 偏差ベクトル ----

describe("AcousticDiagnosisCard (M-ADVL-5) 偏差ベクトル", () => {
  /**
   * measured: left=20%, top=31.25%  (F2=1100, F1=450)
   * target:   left=80%, top=18%     (F2=2300, F1=344)
   * プロット 320×240px
   * dxPx = (80-20)/100 * 320 = 192px
   * dyPx = (18-31.25)/100 * 240 = -31.8px
   * width = Math.hypot(192, -31.8) ≈ 194.6px
   * angle = atan2(-31.8, 192) ≈ -0.164 rad
   */
  it(".vp-vec の width が measured→target 距離に近い (±2px)", () => {
    const ae = buildAcousticEvidence({
      measuredF1Hz: 450,
      measuredF2Hz: 1100,
      targetF1Hz: 344,
      targetF2Hz: 2300,
    });
    const { container } = render(<AcousticDiagnosisCard acousticEvidence={ae} />);
    const vec = container.querySelector(".vp-vec") as HTMLElement | null;
    expect(vec).not.toBeNull();
    const widthPx = parseFloat(vec?.style.width ?? "0");
    const expectedWidth = Math.hypot(192, -31.8);
    expect(Math.abs(widthPx - expectedWidth)).toBeLessThan(2);
  });

  it(".vp-vec の transform に rotate が含まれる", () => {
    const ae = buildAcousticEvidence({
      measuredF1Hz: 450,
      measuredF2Hz: 1100,
      targetF1Hz: 344,
      targetF2Hz: 2300,
    });
    const { container } = render(<AcousticDiagnosisCard acousticEvidence={ae} />);
    const vec = container.querySelector(".vp-vec") as HTMLElement | null;
    expect(vec?.style.transform).toContain("rotate(");
  });

  it("片方の点が null のとき .vp-vec が描画されない", () => {
    const ae = buildAcousticEvidence({
      targetF1Hz: null,
      targetF2Hz: null,
    });
    const { container } = render(<AcousticDiagnosisCard acousticEvidence={ae} />);
    expect(container.querySelector(".vp-vec")).toBeNull();
  });
});

// ---- M-ADVL-6: 方向チップ ----

describe("AcousticDiagnosisCard (M-ADVL-6) 方向チップ", () => {
  it("tongueHeight=tooLow のとき .dir-k に 'tongueHeight' が含まれる", () => {
    const ae = buildAcousticEvidence({ tongueHeight: "tooLow" });
    const { container } = render(<AcousticDiagnosisCard acousticEvidence={ae} />);
    const dirKeys = Array.from(container.querySelectorAll(".dir-k")).map(
      (el) => el.textContent ?? "",
    );
    expect(dirKeys.some((key) => key.includes("tongueHeight"))).toBe(true);
  });

  it("tongueHeight チップの .dir-hz が空でない (signedF1SdDeviation あり)", () => {
    const ae = buildAcousticEvidence({
      tongueHeight: "tooLow",
      signedF1SdDeviation: 1.4,
    });
    const { container } = render(<AcousticDiagnosisCard acousticEvidence={ae} />);
    const chips = container.querySelectorAll(".dir-chip");
    let found = false;
    chips.forEach((chip) => {
      const keyEl = chip.querySelector(".dir-k");
      if (keyEl?.textContent?.includes("tongueHeight")) {
        const hzEl = chip.querySelector(".dir-hz");
        expect(hzEl?.textContent?.trim()).not.toBe("");
        found = true;
      }
    });
    expect(found).toBe(true);
  });

  it("tongueHeight=ok のとき is-ok クラスが付く", () => {
    const ae = buildAcousticEvidence({ tongueHeight: "ok" });
    const { container } = render(<AcousticDiagnosisCard acousticEvidence={ae} />);
    const okChip = Array.from(container.querySelectorAll(".dir-chip.is-ok")).find((el) =>
      el.querySelector(".dir-k")?.textContent?.includes("tongueHeight"),
    );
    expect(okChip).not.toBeUndefined();
  });

  it("tongueHeight=null のときそのチップが描画されない", () => {
    const ae = buildAcousticEvidence({ tongueHeight: null });
    const { container } = render(<AcousticDiagnosisCard acousticEvidence={ae} />);
    const dirKeys = Array.from(container.querySelectorAll(".dir-k")).map(
      (el) => el.textContent ?? "",
    );
    expect(dirKeys.some((key) => key.includes("tongueHeight"))).toBe(false);
  });
});

// ---- M-ADVL-7: rhoticity チップ必須 + F3 数値 ----

describe("AcousticDiagnosisCard (M-ADVL-7) rhoticity チップ F3 数値", () => {
  it("rhoticity=insufficient のとき rhoticity チップの .dir-hz に F3 数値が含まれる", () => {
    const ae = buildAcousticEvidence({
      rhoticity: "insufficient",
      measuredF3Hz: 1800,
      targetF3Hz: 2000,
    });
    const { container } = render(<AcousticDiagnosisCard acousticEvidence={ae} />);
    const chips = container.querySelectorAll(".dir-chip");
    let rhChip: Element | undefined;
    chips.forEach((chip) => {
      if (chip.querySelector(".dir-k")?.textContent?.includes("rhoticity")) {
        rhChip = chip;
      }
    });
    expect(rhChip).not.toBeUndefined();
    const hzText = rhChip?.querySelector(".dir-hz")?.textContent ?? "";
    // F3 数値 1800 か 2000 のいずれかが含まれること（M-ADVL-7）
    expect(hzText.includes("1800") || hzText.includes("2000")).toBe(true);
  });

  it("rhoticity=insufficient の .dir-hz に categorical 文字列のみが表示されていない", () => {
    const ae = buildAcousticEvidence({
      rhoticity: "insufficient",
      measuredF3Hz: 1800,
      targetF3Hz: 2000,
    });
    const { container } = render(<AcousticDiagnosisCard acousticEvidence={ae} />);
    const chips = container.querySelectorAll(".dir-chip");
    let hzText = "";
    chips.forEach((chip) => {
      if (chip.querySelector(".dir-k")?.textContent?.includes("rhoticity")) {
        hzText = chip.querySelector(".dir-hz")?.textContent ?? "";
      }
    });
    expect(hzText).not.toBe("insufficient");
    expect(hzText).not.toBe("overRetroflex");
    expect(hzText).not.toBe("ok");
  });
});

// ---- M-ADVL-8: measure-bar ----

describe("AcousticDiagnosisCard (M-ADVL-8) measure-bar", () => {
  /**
   * spectralCentroidHz=3600: left = clamp((3600-1000)/7000, 0,1)*100 ≈ 37.14%
   * targetSpectralCentroidHz=4500: left = clamp((4500-1000)/7000, 0,1)*100 = 50%
   */
  it("spectralCentroidHz=3600 のとき mb-val の left が約 37.14% (±1%)", () => {
    const ae = buildAcousticEvidence({
      spectralCentroidHz: 3600,
      targetSpectralCentroidHz: 4500,
    });
    const { container } = render(<AcousticDiagnosisCard acousticEvidence={ae} />);
    const measureBars = container.querySelectorAll(".measure-bar");
    let spectralBar: Element | undefined;
    measureBars.forEach((bar) => {
      if (bar.textContent?.includes("/s/ 重心")) {
        spectralBar = bar;
      }
    });
    expect(spectralBar).not.toBeUndefined();
    const mbVal = spectralBar?.querySelector(".mb-val") as HTMLElement | null;
    expect(mbVal).not.toBeNull();
    const leftValue = parseFloat(mbVal?.style.left ?? "0");
    expect(Math.abs(leftValue - 37.14)).toBeLessThan(1);
  });

  it("targetSpectralCentroidHz=4500 のとき mb-target の left が 50% (±1%)", () => {
    const ae = buildAcousticEvidence({
      spectralCentroidHz: 3600,
      targetSpectralCentroidHz: 4500,
    });
    const { container } = render(<AcousticDiagnosisCard acousticEvidence={ae} />);
    const measureBars = container.querySelectorAll(".measure-bar");
    let spectralBar: Element | undefined;
    measureBars.forEach((bar) => {
      if (bar.textContent?.includes("/s/ 重心")) {
        spectralBar = bar;
      }
    });
    const mbTarget = spectralBar?.querySelector(".mb-target") as HTMLElement | null;
    expect(mbTarget).not.toBeNull();
    const leftValue = parseFloat(mbTarget?.style.left ?? "0");
    expect(Math.abs(leftValue - 50)).toBeLessThan(1);
  });

  it("spectralCentroidHz=null のとき spectral centroid measure-bar が存在しない", () => {
    const ae = buildAcousticEvidence({ spectralCentroidHz: null });
    const { container } = render(<AcousticDiagnosisCard acousticEvidence={ae} />);
    const measureBars = container.querySelectorAll(".measure-bar");
    const spectralBarFound = Array.from(measureBars).some((bar) =>
      bar.textContent?.includes("/s/ 重心"),
    );
    expect(spectralBarFound).toBe(false);
  });

  it("tenseLengthRatio=null のとき tense 長さ比 measure-bar が存在しない", () => {
    const ae = buildAcousticEvidence({ tenseLengthRatio: null });
    const { container } = render(<AcousticDiagnosisCard acousticEvidence={ae} />);
    const measureBars = container.querySelectorAll(".measure-bar");
    const tenseBarFound = Array.from(measureBars).some((bar) =>
      bar.textContent?.includes("tense 長さ比"),
    );
    expect(tenseBarFound).toBe(false);
  });
});

// ---- M-ADVL-9: disclaimer ----

describe("AcousticDiagnosisCard (M-ADVL-9) disclaimer", () => {
  it(".disclaimer が 1 件のみ存在する", () => {
    const { container } = render(
      <AcousticDiagnosisCard acousticEvidence={buildAcousticEvidence()} />,
    );
    expect(container.querySelectorAll(".disclaimer").length).toBe(1);
  });

  it("disclaimer テキストに Lobanov または 正規化 が含まれる", () => {
    const { container } = render(
      <AcousticDiagnosisCard acousticEvidence={buildAcousticEvidence()} />,
    );
    const text = container.querySelector(".disclaimer")?.textContent ?? "";
    expect(text.includes("Lobanov") || text.includes("正規化")).toBe(true);
  });

  it("disclaimer テキストに母音3個またはスキップに関する記述が含まれる", () => {
    const { container } = render(
      <AcousticDiagnosisCard acousticEvidence={buildAcousticEvidence()} />,
    );
    const text = container.querySelector(".disclaimer")?.textContent ?? "";
    // "3" が含まれること（母音3個未満でスキップ）
    expect(text).toMatch(/3/);
  });

  it("disclaimer テキストに 減点 が含まれる（二重減点回避）", () => {
    const { container } = render(
      <AcousticDiagnosisCard acousticEvidence={buildAcousticEvidence()} />,
    );
    const text = container.querySelector(".disclaimer")?.textContent ?? "";
    expect(text).toContain("減点");
  });
});
