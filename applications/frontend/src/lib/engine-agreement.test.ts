/**
 * deriveEngineAgreement のユニットテスト。
 *
 * Done When:
 * - both: 重なる range → 両エンジン一致に入る（severity 一致/相違両方）
 * - cloudOnly: cloud のみに range がある finding
 * - ossWorkerOnly: oss のみに range がある finding
 * - 境界: 隣接（endChar==startChar）は非重複
 * - 境界: 内包（一方が他方を完全に含む）は重複
 * - 境界: 完全一致は重複
 * - 両方 undefined → 全 bucket 空
 */

import { describe, expect, it } from "vitest";
import { deriveEngineAgreement } from "./engine-agreement";
import type { EngineFindingDto, EngineResultDto } from "./api-types";

function buildFinding(
  finding: string,
  startChar: number,
  endChar: number,
  severity: EngineFindingDto["severity"],
  detectedText?: string,
): EngineFindingDto {
  return {
    finding,
    phenomenon: null,
    gop: null,
    severity,
    category: "accuracy",
    textRange: { startChar, endChar },
    audioRange: null,
    expected: { text: detectedText ?? null, ipa: null },
    detected: { text: detectedText ?? null, ipa: null },
    messageJa: "テスト",
    messageEn: null,
    scoreImpact: -5,
    confidence: 0.9,
    detectedTopCandidate: null,
    nBest: null,
    matchesL1Pattern: false,
    functionalLoad: null,
    catalogId: null,
    wordPair: null,
    expectedPronunciation: null,
    insertedVowel: null,
    feedbackLayers: null,
    dismissed: false,
  };
}

function buildEngineResult(
  engineKind: "cloud" | "oss_worker",
  findings: EngineFindingDto[],
): EngineResultDto {
  return {
    result: `result-${engineKind}`,
    engineKind,
    engineName: engineKind === "cloud" ? "OpenAI API" : "Rust OSS",
    modelName: null,
    scores: {
      overall: 80,
      accuracy: 80,
      nativeLikeness: 80,
      pronunciation: 80,
      connectedSpeech: 80,
      prosody: 80,
      intelligibility: null,
      cefrOverall: null,
      cefrSegmental: null,
      cefrProsodic: null,
    },
    counts: { critical: 0, major: 0, minor: 0, suggestion: 0 },
    findings,
    engineSummaryMessageJa: null,
    perPhonemeGop: null,
    focusSounds: null,
    prosody: null,
  };
}

describe("deriveEngineAgreement", () => {
  describe("both bucket — 重なる範囲", () => {
    it("同一範囲の finding は both に入る（severity 一致）", () => {
      const cloudResult = buildEngineResult("cloud", [buildFinding("c1", 0, 5, "major", "hello")]);
      const ossResult = buildEngineResult("oss_worker", [
        buildFinding("o1", 0, 5, "major", "hello"),
      ]);
      const result = deriveEngineAgreement(cloudResult, ossResult);
      expect(result.both).toHaveLength(1);
      expect(result.both[0].word).toBe("hello");
      expect(result.both[0].cloudSeverity).toBe("major");
      expect(result.both[0].ossSeverity).toBe("major");
      expect(result.cloudOnly).toHaveLength(0);
      expect(result.ossWorkerOnly).toHaveLength(0);
    });

    it("同一範囲の finding は both に入る（severity 相違）", () => {
      const cloudResult = buildEngineResult("cloud", [buildFinding("c1", 10, 20, "critical")]);
      const ossResult = buildEngineResult("oss_worker", [buildFinding("o1", 10, 20, "major")]);
      const result = deriveEngineAgreement(cloudResult, ossResult);
      expect(result.both).toHaveLength(1);
      expect(result.both[0].cloudSeverity).toBe("critical");
      expect(result.both[0].ossSeverity).toBe("major");
    });

    it("部分重複は both に入る", () => {
      const cloudResult = buildEngineResult("cloud", [buildFinding("c1", 5, 15, "minor")]);
      const ossResult = buildEngineResult("oss_worker", [buildFinding("o1", 10, 20, "minor")]);
      const result = deriveEngineAgreement(cloudResult, ossResult);
      expect(result.both).toHaveLength(1);
      expect(result.cloudOnly).toHaveLength(0);
      expect(result.ossWorkerOnly).toHaveLength(0);
    });
  });

  describe("cloudOnly bucket", () => {
    it("cloud にのみある finding は cloudOnly に入る", () => {
      const cloudResult = buildEngineResult("cloud", [
        buildFinding("c1", 0, 5, "minor", "honored"),
      ]);
      const ossResult = buildEngineResult("oss_worker", []);
      const result = deriveEngineAgreement(cloudResult, ossResult);
      expect(result.cloudOnly).toHaveLength(1);
      expect(result.cloudOnly[0].word).toBe("honored");
      expect(result.cloudOnly[0].severity).toBe("minor");
      expect(result.both).toHaveLength(0);
      expect(result.ossWorkerOnly).toHaveLength(0);
    });

    it("oss result undefined のとき全て cloudOnly に入る", () => {
      const cloudResult = buildEngineResult("cloud", [
        buildFinding("c1", 0, 5, "major"),
        buildFinding("c2", 10, 15, "critical"),
      ]);
      const result = deriveEngineAgreement(cloudResult, undefined);
      expect(result.cloudOnly).toHaveLength(2);
      expect(result.both).toHaveLength(0);
      expect(result.ossWorkerOnly).toHaveLength(0);
    });
  });

  describe("ossWorkerOnly bucket", () => {
    it("oss にのみある finding は ossWorkerOnly に入る", () => {
      const cloudResult = buildEngineResult("cloud", []);
      const ossResult = buildEngineResult("oss_worker", [buildFinding("o1", 30, 40, "suggestion")]);
      const result = deriveEngineAgreement(cloudResult, ossResult);
      expect(result.ossWorkerOnly).toHaveLength(1);
      expect(result.ossWorkerOnly[0].severity).toBe("suggestion");
      expect(result.both).toHaveLength(0);
      expect(result.cloudOnly).toHaveLength(0);
    });

    it("cloud result undefined のとき全て ossWorkerOnly に入る", () => {
      const ossResult = buildEngineResult("oss_worker", [
        buildFinding("o1", 0, 10, "major"),
        buildFinding("o2", 20, 30, "minor"),
      ]);
      const result = deriveEngineAgreement(undefined, ossResult);
      expect(result.ossWorkerOnly).toHaveLength(2);
      expect(result.both).toHaveLength(0);
      expect(result.cloudOnly).toHaveLength(0);
    });
  });

  describe("境界値", () => {
    it("隣接（endChar == startChar）は非重複", () => {
      // cloud: [0, 5) oss: [5, 10) — endChar==startChar は重ならない
      const cloudResult = buildEngineResult("cloud", [buildFinding("c1", 0, 5, "minor")]);
      const ossResult = buildEngineResult("oss_worker", [buildFinding("o1", 5, 10, "minor")]);
      const result = deriveEngineAgreement(cloudResult, ossResult);
      expect(result.both).toHaveLength(0);
      expect(result.cloudOnly).toHaveLength(1);
      expect(result.ossWorkerOnly).toHaveLength(1);
    });

    it("内包（一方が他方を完全に含む）は重複", () => {
      // cloud: [2, 8) oss: [3, 6) — oss は cloud に内包される
      const cloudResult = buildEngineResult("cloud", [buildFinding("c1", 2, 8, "major")]);
      const ossResult = buildEngineResult("oss_worker", [buildFinding("o1", 3, 6, "major")]);
      const result = deriveEngineAgreement(cloudResult, ossResult);
      expect(result.both).toHaveLength(1);
    });

    it("完全一致は重複", () => {
      const cloudResult = buildEngineResult("cloud", [buildFinding("c1", 7, 14, "critical")]);
      const ossResult = buildEngineResult("oss_worker", [buildFinding("o1", 7, 14, "major")]);
      const result = deriveEngineAgreement(cloudResult, ossResult);
      expect(result.both).toHaveLength(1);
    });
  });

  describe("両方 undefined / 空", () => {
    it("両方 undefined のとき全 bucket 空", () => {
      const result = deriveEngineAgreement(undefined, undefined);
      expect(result.both).toHaveLength(0);
      expect(result.cloudOnly).toHaveLength(0);
      expect(result.ossWorkerOnly).toHaveLength(0);
    });

    it("両方 findings 空のとき全 bucket 空", () => {
      const cloudResult = buildEngineResult("cloud", []);
      const ossResult = buildEngineResult("oss_worker", []);
      const result = deriveEngineAgreement(cloudResult, ossResult);
      expect(result.both).toHaveLength(0);
      expect(result.cloudOnly).toHaveLength(0);
      expect(result.ossWorkerOnly).toHaveLength(0);
    });
  });

  describe("複数 findings の混合", () => {
    it("both/cloudOnly/ossWorkerOnly が混在する場合を正しく振り分ける", () => {
      const cloudResult = buildEngineResult("cloud", [
        buildFinding("c1", 0, 10, "major", "with you"), // oss と重複 → both
        buildFinding("c2", 20, 35, "minor", "honored"), // oss と非重複 → cloudOnly
        buildFinding("c3", 40, 55, "suggestion"), // oss と非重複 → cloudOnly
      ]);
      const ossResult = buildEngineResult("oss_worker", [
        buildFinding("o1", 5, 15, "major", "with you"), // cloud c1 と重複 → both
        buildFinding("o2", 60, 75, "critical"), // cloud と非重複 → ossWorkerOnly
      ]);
      const result = deriveEngineAgreement(cloudResult, ossResult);
      expect(result.both).toHaveLength(1);
      expect(result.cloudOnly).toHaveLength(2);
      expect(result.ossWorkerOnly).toHaveLength(1);
    });
  });
});
