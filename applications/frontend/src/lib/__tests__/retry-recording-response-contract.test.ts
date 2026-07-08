/**
 * RetryRecordingResponse 型契約テスト (M-CRL-6)
 *
 * 仕様: docs/specs/closed-remediation-loop.md M-CRL-6
 * - 8 フィールド（findingIdentifier / phoneme / originalGop / retryGop / gopDelta /
 *   deltaSignal / boundarySignal / qualityStatus）が存在する
 * - deltaSignal が 'improved' | 'unchanged' | 'regressed' の 3 値 enum
 * - boundarySignal が 'crossedMajor' | 'crossedMinor' | 'none' の 3 値 enum
 * - qualityStatus が 'normal' | 'low_quality' の 2 値 enum
 * - 各 enum が単一 enum で混在していない（3 フィールド独立）
 */

import { describe, it, expect, expectTypeOf } from "vitest";
import type { RetryRecordingResponse } from "../api-types";

describe("RetryRecordingResponse 型契約 (M-CRL-6)", () => {
  it("11 フィールドすべてが型として存在する (M-CRL-11/13 追加後)", () => {
    // compile-time assertion: 型構造のみ検証
    expectTypeOf<RetryRecordingResponse>().toHaveProperty("findingIdentifier");
    expectTypeOf<RetryRecordingResponse>().toHaveProperty("phoneme");
    expectTypeOf<RetryRecordingResponse>().toHaveProperty("originalGop");
    expectTypeOf<RetryRecordingResponse>().toHaveProperty("retryGop");
    expectTypeOf<RetryRecordingResponse>().toHaveProperty("gopDelta");
    expectTypeOf<RetryRecordingResponse>().toHaveProperty("deltaSignal");
    expectTypeOf<RetryRecordingResponse>().toHaveProperty("boundarySignal");
    expectTypeOf<RetryRecordingResponse>().toHaveProperty("qualityStatus");
    // M-CRL-11
    expectTypeOf<RetryRecordingResponse>().toHaveProperty("retrySeverity");
    expectTypeOf<RetryRecordingResponse>().toHaveProperty("retryConfidence");
    // M-CRL-13
    expectTypeOf<RetryRecordingResponse>().toHaveProperty("retryRecordingAttemptIdentifier");
  });

  it("deltaSignal が 'improved' | 'unchanged' | 'regressed' の 3 値 enum", () => {
    expectTypeOf<RetryRecordingResponse["deltaSignal"]>().toEqualTypeOf<
      "improved" | "unchanged" | "regressed"
    >();
  });

  it("boundarySignal が 'crossedMajor' | 'crossedMinor' | 'none' の 3 値 enum", () => {
    expectTypeOf<RetryRecordingResponse["boundarySignal"]>().toEqualTypeOf<
      "crossedMajor" | "crossedMinor" | "none"
    >();
  });

  it("qualityStatus が 'normal' | 'low_quality' の 2 値 enum", () => {
    expectTypeOf<RetryRecordingResponse["qualityStatus"]>().toEqualTypeOf<
      "normal" | "low_quality"
    >();
  });

  it("gop フィールドは number 型（worker 内部スケール）", () => {
    expectTypeOf<RetryRecordingResponse["originalGop"]>().toEqualTypeOf<number>();
    expectTypeOf<RetryRecordingResponse["retryGop"]>().toEqualTypeOf<number>();
    expectTypeOf<RetryRecordingResponse["gopDelta"]>().toEqualTypeOf<number>();
  });

  it("文字列フィールドは string 型", () => {
    expectTypeOf<RetryRecordingResponse["findingIdentifier"]>().toEqualTypeOf<string>();
    expectTypeOf<RetryRecordingResponse["phoneme"]>().toEqualTypeOf<string>();
  });

  it("runtime: 正常な RetryRecordingResponse オブジェクトを構築できる", () => {
    const response: RetryRecordingResponse = {
      findingIdentifier: "finding-01",
      phoneme: "/l/",
      originalGop: -15.3,
      retryGop: -9.8,
      gopDelta: 5.5,
      deltaSignal: "improved",
      boundarySignal: "crossedMajor",
      qualityStatus: "normal",
      retrySeverity: "major",
      retryConfidence: 0.87,
      retryRecordingAttemptIdentifier: "01ATTEMPT000001",
    };

    expect(response.findingIdentifier).toBe("finding-01");
    expect(response.phoneme).toBe("/l/");
    expect(response.originalGop).toBe(-15.3);
    expect(response.retryGop).toBe(-9.8);
    expect(response.gopDelta).toBe(5.5);
    expect(response.deltaSignal).toBe("improved");
    expect(response.boundarySignal).toBe("crossedMajor");
    expect(response.qualityStatus).toBe("normal");
    expect(response.retrySeverity).toBe("major");
    expect(response.retryConfidence).toBe(0.87);
    expect(response.retryRecordingAttemptIdentifier).toBe("01ATTEMPT000001");
  });

  it("deltaSignal と boundarySignal が別フィールドで同時表示可能", () => {
    const response: RetryRecordingResponse = {
      findingIdentifier: "finding-02",
      phoneme: "/θ/",
      originalGop: -10.5,
      retryGop: -5.2,
      gopDelta: 5.3,
      deltaSignal: "improved",
      boundarySignal: "crossedMinor",
      qualityStatus: "normal",
      retrySeverity: "minor",
      retryConfidence: 0.75,
      retryRecordingAttemptIdentifier: "01ATTEMPT000002",
    };
    // 両 signal が同時に非 'none' / 非 'unchanged' になれる（独立した 3 enum）
    expect(response.deltaSignal).toBe("improved");
    expect(response.boundarySignal).toBe("crossedMinor");
  });
});
