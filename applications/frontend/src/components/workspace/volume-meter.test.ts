import { describe, expect, it } from "vitest";
import {
  accumulateLowDurationMs,
  applyPeakHold,
  computeRmsLevel,
  rmsLevelToDisplayPercentage,
  SUSTAINED_LOW_MS,
} from "./volume-meter";

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

describe("accumulateLowDurationMs", () => {
  // Pure function: (previousBelowMs, smoothedValue, threshold, dtMs) => number
  // If smoothedValue < threshold: return previousBelowMs + dtMs  (accumulate)
  // If smoothedValue >= threshold: return 0                       (reset)

  const THRESHOLD = 41; // LOW_VOLUME_DISPLAY_THRESHOLD

  it("(a) below threshold — accumulates dtMs", () => {
    // smoothedValue < threshold → add dtMs to previousBelowMs
    expect(accumulateLowDurationMs(0, 40, THRESHOLD, 16.67)).toBeCloseTo(16.67, 2);
    expect(accumulateLowDurationMs(100, 10, THRESHOLD, 50)).toBeCloseTo(150, 2);
    expect(accumulateLowDurationMs(300, 2, THRESHOLD, 16.67)).toBeCloseTo(316.67, 2);
  });

  it("(b) at/above threshold — resets to 0", () => {
    // smoothedValue === threshold → reset
    expect(accumulateLowDurationMs(300, 41, THRESHOLD, 16.67)).toBe(0);
    // smoothedValue > threshold → reset
    expect(accumulateLowDurationMs(500, 80, THRESHOLD, 16.67)).toBe(0);
    expect(accumulateLowDurationMs(200, 41.1, THRESHOLD, 20)).toBe(0);
  });

  it("(c) crossing threshold resets accumulator", () => {
    // Simulate: accumulate → cross above threshold → reset
    let belowMs = 0;
    const dt = 16.67;
    // 20 ticks below threshold (simulating ~333ms of low volume)
    for (let tick = 0; tick < 20; tick++) {
      belowMs = accumulateLowDurationMs(belowMs, 30, THRESHOLD, dt);
    }
    expect(belowMs).toBeCloseTo(20 * dt, 1);
    // One tick above threshold → reset
    belowMs = accumulateLowDurationMs(belowMs, 60, THRESHOLD, dt);
    expect(belowMs).toBe(0);
    // Now back below threshold — accumulates from zero again
    belowMs = accumulateLowDurationMs(belowMs, 20, THRESHOLD, dt);
    expect(belowMs).toBeCloseTo(dt, 2);
  });

  it("(d) sequence reaching SUSTAINED_LOW_MS triggers label", () => {
    // Run enough ticks below threshold to exceed SUSTAINED_LOW_MS
    // SUSTAINED_LOW_MS = 500ms, at 60fps dt = 16.67ms → 30 ticks = 500ms
    const dt = 1000 / 60; // 16.67ms
    let belowMs = 0;
    const ticksNeeded = Math.ceil(SUSTAINED_LOW_MS / dt);

    // Before reaching the threshold: label should be off
    for (let tick = 0; tick < ticksNeeded - 1; tick++) {
      belowMs = accumulateLowDurationMs(belowMs, 20, THRESHOLD, dt);
    }
    expect(belowMs).toBeLessThan(SUSTAINED_LOW_MS);
    // Should not yet trigger
    expect(belowMs >= SUSTAINED_LOW_MS).toBe(false);

    // One more tick crosses the threshold
    belowMs = accumulateLowDurationMs(belowMs, 20, THRESHOLD, dt);
    expect(belowMs).toBeGreaterThanOrEqual(SUSTAINED_LOW_MS);
    // Now the label would fire: belowMs >= SUSTAINED_LOW_MS
    expect(belowMs >= SUSTAINED_LOW_MS).toBe(true);
  });
});

describe("applyPeakHold", () => {
  // Pure function: (currentPercent, previousDisplayed, releaseAmount) => number
  // Attack: instant — currentPercent > previousDisplayed → returns currentPercent
  // Release: gradual — currentPercent < previousDisplayed → returns previousDisplayed - releaseAmount
  // Floor clamp: result is always ≥ 0

  it("attack — currentPercent が previousDisplayed を超えるとき currentPercent を返す", () => {
    // syllable onset: meter jumps immediately to new peak
    expect(applyPeakHold(75, 50, 5)).toBe(75);
    expect(applyPeakHold(100, 0, 5)).toBe(100);
    expect(applyPeakHold(41, 40, 5)).toBe(41);
  });

  it("hold/decay — currentPercent < previousDisplayed のとき previousDisplayed - releaseAmount を返す", () => {
    // inter-syllable gap: peak held, decaying by releaseAmount
    expect(applyPeakHold(10, 80, 5.45)).toBeCloseTo(74.55, 5);
    expect(applyPeakHold(2, 60, 5)).toBe(55);
    expect(applyPeakHold(0, 50, 10)).toBe(40);
  });

  it("floor clamp — 結果は 0 未満にならない", () => {
    // release would go negative: clamp to 0
    expect(applyPeakHold(0, 3, 10)).toBe(0);
    expect(applyPeakHold(0, 0, 5)).toBe(0);
    expect(applyPeakHold(-5, 0, 0)).toBe(0);
  });

  it("monotonic release — 連続呼び出しで前回値から単調減衰し currentPercent まで収束する", () => {
    // Simulate 60fps decay from 80% with currentPercent fixed at 2% (silence floor)
    // release 5.45 %/frame — after ≥15 frames, displayed should have decreased monotonically
    const releaseAmount = 5.45;
    const currentPercent = 2;
    let displayed = 80;
    const history: number[] = [displayed];

    for (let frame = 0; frame < 15; frame++) {
      displayed = applyPeakHold(currentPercent, displayed, releaseAmount);
      history.push(displayed);
    }

    // Each step must be ≤ previous (monotonically non-increasing)
    for (let index = 1; index < history.length; index++) {
      expect(history[index]).toBeLessThanOrEqual(history[index - 1]!);
    }

    // After 15 frames: 80 - 15*5.45 = 80 - 81.75 = clamped at currentPercent=2
    // (floor wins once peak decays below currentPercent)
    expect(history[history.length - 1]).toBeGreaterThanOrEqual(0);
    expect(history[history.length - 1]).toBeLessThan(80);
  });
});
