/**
 * Golden Speaker ACL schema テスト (M-GRV-7 / ORPHAN-4)。
 * qualityGatePassed=false 時に壊れた音声 (audioBase64) を再生しないことを検証する。
 */

import { describe, it, expect } from "vitest";
import { parseGoldenConversionResponse } from "../schema";

describe("parseGoldenConversionResponse (M-GRV-7 / ORPHAN-4)", () => {
  it("preserves audioBase64 when the quality gate passed", () => {
    const result = parseGoldenConversionResponse({
      audioBase64: "UklGRg==",
      qualityGatePassed: true,
      withholdReason: null,
      targetVoice: "p225",
    });
    expect(result).not.toBeNull();
    expect(result?.audioBase64).toBe("UklGRg==");
    expect(result?.targetVoice).toBe("p225");
  });

  it("forces audioBase64 to null when the quality gate failed (ORPHAN-4)", () => {
    // audioBase64 が来ても qualityGatePassed=false なら壊れた音声を再生させない
    const result = parseGoldenConversionResponse({
      audioBase64: "UklGRg==",
      qualityGatePassed: false,
      withholdReason: "quality_gate_failed",
      targetVoice: "p225",
    });
    expect(result).not.toBeNull();
    expect(result?.audioBase64).toBeNull();
    expect(result?.withholdReason).toBe("quality_gate_failed");
  });

  it("returns null for malformed input", () => {
    expect(parseGoldenConversionResponse({ foo: "bar" })).toBeNull();
    expect(parseGoldenConversionResponse(null)).toBeNull();
  });
});
