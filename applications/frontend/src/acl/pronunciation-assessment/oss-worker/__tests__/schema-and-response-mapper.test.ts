/**
 * Done When (a)(b): OSS Worker schema/response-mapper のテスト。
 * worker 実出力 fixture(phenomenon="omission",gop=-12.164,messageJa=null) が
 * schema を通り、response-mapper が draft に phenomenon/gop/messageJa=null を転写することを確認する。
 */

import { describe, it, expect } from "vitest";
import { ossWorkerSuccessResponseSchema } from "../schema";
import { mapOssWorkerResponse } from "../response-mapper";

// Worker 実出力 fixture (impact-map の実出力例)
const workerFixture = {
  assessmentSchemaVersion: "1",
  tokenizerVersion: "v1",
  scores: {
    accuracy: 70,
    connectedSpeech: 75,
    nativeLikeness: 71,
    overall: 70,
    pronunciation: 69,
    prosody: 65,
  },
  summary: {
    messageJa: "発音に改善の余地があります",
    messageEn: null,
  },
  findings: [
    {
      phenomenon: "omission",
      gop: -12.164,
      messageJa: null,
      category: "accuracy",
      severity: "major",
      textRange: { startChar: 0, endChar: 11 },
      audioRange: null,
      expected: { text: null, ipa: "h ə l oʊ w ɜː l d" },
      detected: { text: null, ipa: "f ʌ n ɔ w ɜː l d" },
      scoreImpact: -5,
      confidence: 0.9,
      messageEn: null,
    },
  ],
  segments: [
    {
      textRange: { startChar: 0, endChar: 11 },
      audioRange: { startMs: 0, endMs: 1500 },
      transcript: "Hello world",
      confidence: 0.85,
    },
  ],
  metadata: {
    workerVersion: "1.0.0",
    modelVersion: "v1",
    ruleSetVersion: "v1",
    scoringRubricVersion: "v1",
  },
};

const makeEngine = () =>
  ({
    type: "oss_worker" as const,
    identifier: "oss-worker-1" as never,
    displayName: "OSS Worker" as never,
    workerVersion: "1.0.0",
    modelName: "v1",
    rulesetVersion: "v1",
    enabled: true,
    configuration: {},
  }) as const;

describe("oss-worker schema", () => {
  // Done When (a): fixture が oss-worker schema を通る
  it("(a) accepts worker fixture with phenomenon=omission, gop=-12.164, messageJa=null", () => {
    const result = ossWorkerSuccessResponseSchema.safeParse(workerFixture);
    expect(result.success).toBe(true);
    if (result.success) {
      const finding = result.data.findings[0];
      expect(finding?.phenomenon).toBe("omission");
      expect(finding?.gop).toBeCloseTo(-12.164);
      expect(finding?.messageJa).toBeNull();
    }
  });

  it("accepts finding with phenomenon=substitution", () => {
    const fixture = {
      ...workerFixture,
      findings: [{ ...workerFixture.findings[0], phenomenon: "substitution", gop: -5.0 }],
    };
    const result = ossWorkerSuccessResponseSchema.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it("accepts finding with phenomenon=null (phenomenon is nullable string)", () => {
    const fixture = {
      ...workerFixture,
      findings: [{ ...workerFixture.findings[0], phenomenon: null, gop: null }],
    };
    const result = ossWorkerSuccessResponseSchema.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it("accepts empty segments (low_quality は response-mapper で判定するため schema では許容)", () => {
    const fixture = { ...workerFixture, segments: [] };
    const result = ossWorkerSuccessResponseSchema.safeParse(fixture);
    expect(result.success).toBe(true);
  });
});

describe("oss-worker response-mapper", () => {
  // Done When (b): response-mapper 通過後の draft が phenomenon/gop/messageJa=null を保持する
  it("(b) maps phenomenon=omission, gop=-12.164, messageJa=null into draft", () => {
    const engine = makeEngine();
    const result = mapOssWorkerResponse({
      status: 200,
      rawBody: workerFixture,
      capturedAt: new Date("2026-01-01T00:00:00Z"),
      engine,
      assessmentSchemaVersion: "1",
      tokenizerVersion: "v1",
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const draft = result.value;
      const finding = draft.findings[0];
      expect(finding?.phenomenon).toBe("omission");
      expect(finding?.gop).toBeCloseTo(-12.164);
      expect(finding?.messageJa).toBeNull();
    }
  });

  it("passes through insertedVowel and insertionPositionMs for epenthesis findings (ADR-017 D4)", () => {
    const engine = makeEngine();
    const fixture = {
      ...workerFixture,
      findings: [
        {
          ...workerFixture.findings[0],
          phenomenon: "epenthesis",
          insertedVowel: "ɯ",
          insertionPositionMs: 350,
        },
      ],
    };
    const result = mapOssWorkerResponse({
      status: 200,
      rawBody: fixture,
      capturedAt: new Date("2026-01-01T00:00:00Z"),
      engine,
      assessmentSchemaVersion: "1",
      tokenizerVersion: "v1",
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const finding = result.value.findings[0];
      expect(finding?.insertedVowel).toBe("ɯ");
      expect(finding?.insertionPositionMs).toBe(350);
    }
  });

  it("maps insertionPositionMs to null when absent (ADR-017 D4)", () => {
    const engine = makeEngine();
    const result = mapOssWorkerResponse({
      status: 200,
      rawBody: workerFixture,
      capturedAt: new Date("2026-01-01T00:00:00Z"),
      engine,
      assessmentSchemaVersion: "1",
      tokenizerVersion: "v1",
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.findings[0]?.insertionPositionMs).toBeNull();
    }
  });

  it("passes through scores correctly", () => {
    const engine = makeEngine();
    const result = mapOssWorkerResponse({
      status: 200,
      rawBody: workerFixture,
      capturedAt: new Date("2026-01-01T00:00:00Z"),
      engine,
      assessmentSchemaVersion: "1",
      tokenizerVersion: "v1",
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.scores.accuracy).toBe(70);
      expect(result.value.scores.overall).toBe(70);
    }
  });

  it("returns assessmentEngineFailed on HTTP 500", () => {
    const engine = makeEngine();
    const result = mapOssWorkerResponse({
      status: 500,
      rawBody: { error: { code: "internal_error", message: "Server error", retryable: true } },
      capturedAt: new Date("2026-01-01T00:00:00Z"),
      engine,
      assessmentSchemaVersion: "1",
      tokenizerVersion: "v1",
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("assessmentEngineFailed");
    }
  });

  // low_quality パス: worker が status:"low_quality" を返したとき low_quality_audio エンジン失敗にする
  // (schema hard fail でなく graceful。run-assessment-job が errorCode=low_quality_audio に写像し UI が再録音導線を出す)
  it("maps status=low_quality from worker response to low_quality_audio engine failure", () => {
    const engine = makeEngine();
    const lowQualityFixture = {
      ...workerFixture,
      status: "low_quality",
    };
    const result = mapOssWorkerResponse({
      status: 200,
      rawBody: lowQualityFixture,
      capturedAt: new Date("2026-01-01T00:00:00Z"),
      engine,
      assessmentSchemaVersion: "1",
      tokenizerVersion: "v1",
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("assessmentEngineFailed");
      if (result.error.type === "assessmentEngineFailed") {
        expect(result.error.reason).toBe("low_quality_audio");
        expect(result.error.failureKind).toBe("nonRetryable");
      }
    }
  });

  // 発話がほぼ検出されず segments が空のとき low_quality_audio エンジン失敗にする (再録音導線)
  it("maps empty segments to low_quality_audio engine failure", () => {
    const engine = makeEngine();
    const emptySegmentsFixture = {
      ...workerFixture,
      segments: [],
    };
    const result = mapOssWorkerResponse({
      status: 200,
      rawBody: emptySegmentsFixture,
      capturedAt: new Date("2026-01-01T00:00:00Z"),
      engine,
      assessmentSchemaVersion: "1",
      tokenizerVersion: "v1",
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("assessmentEngineFailed");
      if (result.error.type === "assessmentEngineFailed") {
        expect(result.error.reason).toBe("low_quality_audio");
      }
    }
  });

  // M-104R-b: wordPositionLabel が draft に転写されること
  it("(M-104R-b) maps wordPositionLabel=initial from worker finding into draft", () => {
    const engine = makeEngine();
    const fixtureWithPosition = {
      ...workerFixture,
      findings: [{ ...workerFixture.findings[0], wordPositionLabel: "initial" }],
    };
    const result = mapOssWorkerResponse({
      status: 200,
      rawBody: fixtureWithPosition,
      capturedAt: new Date("2026-01-01T00:00:00Z"),
      engine,
      assessmentSchemaVersion: "1",
      tokenizerVersion: "v1",
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.findings[0]?.wordPositionLabel).toBe("initial");
    }
  });

  it("(M-104R-b) maps wordPositionLabel=null when absent from worker finding", () => {
    const engine = makeEngine();
    const result = mapOssWorkerResponse({
      status: 200,
      rawBody: workerFixture,
      capturedAt: new Date("2026-01-01T00:00:00Z"),
      engine,
      assessmentSchemaVersion: "1",
      tokenizerVersion: "v1",
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.findings[0]?.wordPositionLabel).toBeNull();
    }
  });

  // M-APD-12: acousticEvidence が存在するとき draft に正しく転写されること
  it("(M-APD-12) maps acousticEvidence.rhoticity=insufficient from worker finding into draft", () => {
    const engine = makeEngine();
    const fixtureWithAcousticEvidence = {
      ...workerFixture,
      findings: [
        {
          ...workerFixture.findings[0],
          acousticEvidence: {
            rhoticity: "insufficient",
            tongueHeight: "ok",
            tongueBackness: "ok",
            sibilantPlace: "ok",
            vowelLength: "ok",
            measuredF1Hz: 300.0,
            measuredF2Hz: 900.0,
            measuredF3Hz: 2100.0,
            targetF1Hz: 270.0,
            targetF2Hz: 870.0,
            targetF3Hz: 2900.0,
          },
        },
      ],
    };
    const result = mapOssWorkerResponse({
      status: 200,
      rawBody: fixtureWithAcousticEvidence,
      capturedAt: new Date("2026-01-01T00:00:00Z"),
      engine,
      assessmentSchemaVersion: "1",
      tokenizerVersion: "v1",
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const finding = result.value.findings[0];
      expect(finding?.acousticEvidence).not.toBeNull();
      expect(finding?.acousticEvidence?.rhoticity).toBe("insufficient");
      expect(finding?.acousticEvidence?.measuredF3Hz).toBeCloseTo(2100.0);
    }
  });

  // M-APD-12: acousticEvidence キーが absent な旧フォーマット JSON も正常にパースできること（後方互換）
  it("(M-APD-12) maps acousticEvidence to null when absent from worker finding (backward compat)", () => {
    const engine = makeEngine();
    const result = mapOssWorkerResponse({
      status: 200,
      rawBody: workerFixture, // acousticEvidence キーなし
      capturedAt: new Date("2026-01-01T00:00:00Z"),
      engine,
      assessmentSchemaVersion: "1",
      tokenizerVersion: "v1",
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.findings[0]?.acousticEvidence).toBeNull();
    }
  });

  // M-APD-12: findingSchema.parse が acousticEvidence を含む JSON を直接受け付けること
  it("(M-APD-12) findingSchema.parse accepts acousticEvidence with rhoticity=insufficient", () => {
    const findingJson = {
      ...workerFixture.findings[0],
      acousticEvidence: { rhoticity: "insufficient" },
    };
    // ossWorkerSuccessResponseSchema 全体を通す
    const result = ossWorkerSuccessResponseSchema.safeParse({
      ...workerFixture,
      findings: [findingJson],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.findings[0]?.acousticEvidence?.rhoticity).toBe("insufficient");
    }
  });

  // M-APD-12: acousticEvidence キーが absent な旧フォーマットでも schema.parse が成功すること
  it("(M-APD-12) findingSchema.parse succeeds with no acousticEvidence key (legacy format)", () => {
    const result = ossWorkerSuccessResponseSchema.safeParse(workerFixture);
    expect(result.success).toBe(true);
    if (result.success) {
      // transform(v => v ?? null) により undefined → null になること
      expect(result.data.findings[0]?.acousticEvidence).toBeNull();
    }
  });

  // M-AAI-13 (ADR-019): articulatoryEstimate 存在時の round-trip テスト (ORPHAN-C 防止)
  it("(M-AAI-13) findingSchema.parse accepts articulatoryEstimate with all 6 coords + eligibility", () => {
    const findingWithEma = {
      ...workerFixture.findings[0],
      articulatoryEstimate: {
        tongueTipX: 0.12,
        tongueTipY: -0.34,
        tongueDorsumX: -0.21,
        tongueDorsumY: 0.45,
        lipApertureX: 0.01,
        lipApertureY: 0.67,
        displayEligibility: 0.72,
      },
    };
    const result = ossWorkerSuccessResponseSchema.safeParse({
      ...workerFixture,
      findings: [findingWithEma],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const ae = result.data.findings[0]?.articulatoryEstimate;
      expect(ae).not.toBeNull();
      expect(ae?.tongueTipX).toBeCloseTo(0.12);
      expect(ae?.displayEligibility).toBeCloseTo(0.72);
    }
  });

  // M-AAI-13: articulatoryEstimate キーが absent な旧フォーマット JSON でも schema.parse が成功すること（後方互換）
  it("(M-AAI-13) findingSchema.parse succeeds with no articulatoryEstimate key (backward compat)", () => {
    const result = ossWorkerSuccessResponseSchema.safeParse(workerFixture);
    expect(result.success).toBe(true);
    if (result.success) {
      // transform(v => v ?? null) により undefined → null になること (ORPHAN-C 防止)
      expect(result.data.findings[0]?.articulatoryEstimate).toBeNull();
    }
  });

  // M-AAI-13: response-mapper が articulatoryEstimate を EngineFindingDto へ転写すること
  it("(M-AAI-13) response-mapper passes through articulatoryEstimate from worker finding into draft", () => {
    const engine = makeEngine();
    const fixtureWithEma = {
      ...workerFixture,
      findings: [
        {
          ...workerFixture.findings[0],
          articulatoryEstimate: {
            tongueTipX: 0.3,
            tongueTipY: -0.5,
            tongueDorsumX: -0.1,
            tongueDorsumY: 0.6,
            lipApertureX: 0.05,
            lipApertureY: 0.8,
            displayEligibility: 0.65,
          },
        },
      ],
    };
    const result = mapOssWorkerResponse({
      status: 200,
      rawBody: fixtureWithEma,
      capturedAt: new Date("2026-01-01T00:00:00Z"),
      engine,
      assessmentSchemaVersion: "1",
      tokenizerVersion: "v1",
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const ae = result.value.findings[0]?.articulatoryEstimate;
      expect(ae).not.toBeNull();
      expect(ae?.tongueTipX).toBeCloseTo(0.3);
      expect(ae?.displayEligibility).toBeCloseTo(0.65);
    }
  });

  // M-AAI-13: articulatoryEstimate キーが absent なとき mapper が null を返すこと（ADR-017 再発防止）
  it("(M-AAI-13) response-mapper maps articulatoryEstimate to null when absent (ADR-017 regression guard)", () => {
    const engine = makeEngine();
    const result = mapOssWorkerResponse({
      status: 200,
      rawBody: workerFixture, // articulatoryEstimate キーなし
      capturedAt: new Date("2026-01-01T00:00:00Z"),
      engine,
      assessmentSchemaVersion: "1",
      tokenizerVersion: "v1",
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.findings[0]?.articulatoryEstimate).toBeNull();
    }
  });

  // normal パステスト: status フィールドがない場合は "normal" にデフォルトされること
  it("defaults draft.status to normal when status field is absent", () => {
    const engine = makeEngine();
    const result = mapOssWorkerResponse({
      status: 200,
      rawBody: workerFixture, // status フィールドなし
      capturedAt: new Date("2026-01-01T00:00:00Z"),
      engine,
      assessmentSchemaVersion: "1",
      tokenizerVersion: "v1",
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.status).toBe("normal");
    }
  });

  // M-ADVL-12 (ADR-024): 新 7 フィールドを含む acousticEvidence が schema parse を通過し AcousticEvidenceDto に転写されること
  it("(M-ADVL-12) schema parses acousticEvidence with 7 new scalar fields and round-trips to AcousticEvidenceDto", () => {
    const findingWithNewScalars = {
      ...workerFixture.findings[0],
      acousticEvidence: {
        rhoticity: "insufficient",
        tongueHeight: "tooLow",
        tongueBackness: "ok",
        sibilantPlace: null,
        vowelLength: "ok",
        measuredF1Hz: 450.0,
        measuredF2Hz: 1100.0,
        measuredF3Hz: 1800.0,
        targetF1Hz: 344.0,
        targetF2Hz: 2300.0,
        targetF3Hz: 2000.0,
        // 新 7 フィールド（Haskell ToJSON wire 形式と同名）
        spectralCentroidHz: 3600.0,
        tenseLengthRatio: 1.5,
        signedF1SdDeviation: 1.4,
        signedF2SdDeviation: -1.1,
        signedF3SdDeviation: -0.8,
        targetSpectralCentroidHz: 4500.0,
        targetTenseLengthRatio: 1.4,
      },
    };
    const result = ossWorkerSuccessResponseSchema.safeParse({
      ...workerFixture,
      findings: [findingWithNewScalars],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const ae = result.data.findings[0]?.acousticEvidence;
      expect(ae).not.toBeNull();
      expect(ae?.spectralCentroidHz).toBeCloseTo(3600.0);
      expect(ae?.tenseLengthRatio).toBeCloseTo(1.5);
      expect(ae?.signedF1SdDeviation).toBeCloseTo(1.4);
      expect(ae?.signedF2SdDeviation).toBeCloseTo(-1.1);
      expect(ae?.signedF3SdDeviation).toBeCloseTo(-0.8);
      expect(ae?.targetSpectralCentroidHz).toBeCloseTo(4500.0);
      expect(ae?.targetTenseLengthRatio).toBeCloseTo(1.4);
    }
  });

  // M-ADVL-12: response-mapper が新 7 フィールドを AcousticEvidenceDto へ転写すること
  it("(M-ADVL-12) response-mapper passes through 7 new scalar fields into AcousticEvidenceDto", () => {
    const engine = makeEngine();
    const fixtureWithNewScalars = {
      ...workerFixture,
      findings: [
        {
          ...workerFixture.findings[0],
          acousticEvidence: {
            rhoticity: "insufficient",
            tongueHeight: "tooLow",
            tongueBackness: "ok",
            sibilantPlace: null,
            vowelLength: "ok",
            measuredF1Hz: 450.0,
            measuredF2Hz: 1100.0,
            measuredF3Hz: 1800.0,
            targetF1Hz: 344.0,
            targetF2Hz: 2300.0,
            targetF3Hz: 2000.0,
            spectralCentroidHz: 3600.0,
            tenseLengthRatio: 1.5,
            signedF1SdDeviation: 1.4,
            signedF2SdDeviation: -1.1,
            signedF3SdDeviation: -0.8,
            targetSpectralCentroidHz: 4500.0,
            targetTenseLengthRatio: 1.4,
          },
        },
      ],
    };
    const result = mapOssWorkerResponse({
      status: 200,
      rawBody: fixtureWithNewScalars,
      capturedAt: new Date("2026-01-01T00:00:00Z"),
      engine,
      assessmentSchemaVersion: "1",
      tokenizerVersion: "v1",
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const ae = result.value.findings[0]?.acousticEvidence;
      expect(ae).not.toBeNull();
      expect(ae?.spectralCentroidHz).toBeCloseTo(3600.0);
      expect(ae?.tenseLengthRatio).toBeCloseTo(1.5);
      expect(ae?.signedF1SdDeviation).toBeCloseTo(1.4);
      expect(ae?.signedF2SdDeviation).toBeCloseTo(-1.1);
      expect(ae?.signedF3SdDeviation).toBeCloseTo(-0.8);
      expect(ae?.targetSpectralCentroidHz).toBeCloseTo(4500.0);
      expect(ae?.targetTenseLengthRatio).toBeCloseTo(1.4);
    }
  });

  // M-ADVL-12: 新 7 フィールドが absent な旧 worker JSON は parse 成功し null に縮退すること（後方互換）
  it("(M-ADVL-12) schema degrades 7 new fields to null when absent from acousticEvidence (backward compat)", () => {
    const findingWithOldAcousticEvidence = {
      ...workerFixture.findings[0],
      acousticEvidence: {
        // 旧フォーマット: 7 フィールドなし
        rhoticity: "insufficient",
        tongueHeight: "ok",
        tongueBackness: "ok",
        sibilantPlace: null,
        vowelLength: "ok",
        measuredF1Hz: 300.0,
        measuredF2Hz: 900.0,
        measuredF3Hz: 2100.0,
        targetF1Hz: 270.0,
        targetF2Hz: 870.0,
        targetF3Hz: 2900.0,
        // 新 7 フィールドは意図的に省略
      },
    };
    const result = ossWorkerSuccessResponseSchema.safeParse({
      ...workerFixture,
      findings: [findingWithOldAcousticEvidence],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const ae = result.data.findings[0]?.acousticEvidence;
      expect(ae).not.toBeNull();
      // 後方互換: 欠落フィールドは null に縮退
      expect(ae?.spectralCentroidHz).toBeNull();
      expect(ae?.tenseLengthRatio).toBeNull();
      expect(ae?.signedF1SdDeviation).toBeNull();
      expect(ae?.signedF2SdDeviation).toBeNull();
      expect(ae?.signedF3SdDeviation).toBeNull();
      expect(ae?.targetSpectralCentroidHz).toBeNull();
      expect(ae?.targetTenseLengthRatio).toBeNull();
    }
  });
});
