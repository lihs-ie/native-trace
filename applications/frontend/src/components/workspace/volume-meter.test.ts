import { describe, expect, it } from "vitest";
import { computeRmsLevel, rmsLevelToDisplayPercentage } from "./volume-meter";

describe("computeRmsLevel", () => {
  it("全サンプルが 128 (無音) のとき 0 を返す", () => {
    const silenceBuffer = new Uint8Array(256).fill(128);
    expect(computeRmsLevel(silenceBuffer)).toBe(0);
  });

  it("空バッファのとき 0 を返す", () => {
    expect(computeRmsLevel(new Uint8Array(0))).toBe(0);
  });

  it("全サンプルが 255 (最大正振幅) のとき約 1 を返す", () => {
    // (255 - 128) / 128 = 0.9921875 → RMS = 0.9921875
    const maxBuffer = new Uint8Array(256).fill(255);
    expect(computeRmsLevel(maxBuffer)).toBeCloseTo(0.992, 2);
  });

  it("全サンプルが 0 (最大負振幅) のとき約 1 を返す", () => {
    // (0 - 128) / 128 = -1.0 → RMS = 1.0
    const minBuffer = new Uint8Array(256).fill(0);
    expect(computeRmsLevel(minBuffer)).toBeCloseTo(1.0, 2);
  });

  it("対称な振幅（128 ± 64）のとき約 0.5 を返す", () => {
    // (192 - 128) / 128 = 0.5 → RMS = 0.5
    const symmetricBuffer = new Uint8Array(256).fill(192);
    expect(computeRmsLevel(symmetricBuffer)).toBeCloseTo(0.5, 2);
  });
});

describe("rmsLevelToDisplayPercentage", () => {
  // dBFS logarithmic scale: FLOOR_DB=-60, CEILING_DB=0, MIN_DISPLAY_PERCENTAGE=2
  // formula: ((dbfs - (-60)) / 60) * 98 + 2

  it("RMS 0 のとき最小表示パーセンテージ(2)を返す", () => {
    expect(rmsLevelToDisplayPercentage(0)).toBe(2);
  });

  it("RMS 1 のとき 100 を返す", () => {
    // 0 dBFS → 100%
    expect(rmsLevelToDisplayPercentage(1)).toBeCloseTo(100, 1);
  });

  it("RMS 0.03 のとき約 49-52% を返す(-30.5 dBFS)", () => {
    // 20*log10(0.03) ≈ -30.46 dBFS → ((29.54/60)*98)+2 ≈ 50.2%
    const result = rmsLevelToDisplayPercentage(0.03);
    expect(result).toBeGreaterThanOrEqual(49);
    expect(result).toBeLessThanOrEqual(52);
  });

  it("RMS 0.1 のとき約 69% を返す(-20 dBFS)", () => {
    // 20*log10(0.1) = -20 dBFS → ((40/60)*98)+2 ≈ 67.3%
    const result = rmsLevelToDisplayPercentage(0.1);
    expect(result).toBeGreaterThanOrEqual(66);
    expect(result).toBeLessThanOrEqual(70);
  });

  it("RMS 0.01 のとき約 35% を返す(-40 dBFS)", () => {
    // 20*log10(0.01) = -40 dBFS → ((20/60)*98)+2 ≈ 34.7%
    const result = rmsLevelToDisplayPercentage(0.01);
    expect(result).toBeGreaterThanOrEqual(33);
    expect(result).toBeLessThanOrEqual(37);
  });

  it("RMS 0.5 のとき約 90% を返す(-6 dBFS)", () => {
    // 20*log10(0.5) ≈ -6.02 dBFS → ((53.98/60)*98)+2 ≈ 90.2%
    const result = rmsLevelToDisplayPercentage(0.5);
    expect(result).toBeGreaterThanOrEqual(89);
    expect(result).toBeLessThanOrEqual(92);
  });

  it("RMS が 1 を超える場合でも 100 にクランプされる", () => {
    expect(rmsLevelToDisplayPercentage(2)).toBeCloseTo(100, 1);
  });

  it("RMS が負の場合でも最小値(2)にクランプされる", () => {
    expect(rmsLevelToDisplayPercentage(-0.5)).toBe(2);
  });
});
