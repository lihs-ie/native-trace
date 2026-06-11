import { describe, expect, it } from "vitest";
import { calcGaugeDashOffset } from "./Gauge";

describe("calcGaugeDashOffset", () => {
  it("overall=100 のとき dashOffset は 0", () => {
    expect(calcGaugeDashOffset(100)).toBeCloseTo(0, 1);
  });

  it("overall=0 のとき dashOffset は circumference (326.7)", () => {
    expect(calcGaugeDashOffset(0)).toBeCloseTo(326.7, 1);
  });

  it("overall=82 のとき正しい dashOffset を計算する", () => {
    // 326.7 * (1 - 82/100) = 326.7 * 0.18 = 58.806
    expect(calcGaugeDashOffset(82)).toBeCloseTo(58.8, 1);
  });
});
