/**
 * deriveWorkspaceState のユニットテスト。
 *
 * Done When:
 * - runStatus==="failed" かつ resultsByEngine が空のとき "failed" を返す
 * - runStatus==="failed" かつ resultsByEngine が非空のとき "result" を返す
 * - runStatus==="succeeded" かつ resultsByEngine が空のとき "failed" を返す
 * - runStatus==="succeeded" かつ resultsByEngine が非空のとき "result" を返す
 * - isRecording=true のとき "recording" を返す
 * - submitting=true のとき "analyzing" を返す
 */
import { describe, expect, it } from "vitest";

import type { WorkspaceDto } from "@/lib/api-types";

import { deriveWorkspaceState } from "./page";

const buildWorkspace = (runStatus: string | null, resultsByEngineCount: number): WorkspaceDto => ({
  section: {
    identifier: "section-1",
    sectionSeries: "series-1",
    bodyText: "Hello, world.",
    version: 1,
    createdAt: "2024-01-01T00:00:00.000Z",
  },
  sectionTokens: [],
  recordingAttempts: [],
  latestAnalysisRun: runStatus ? { identifier: "run-1", status: runStatus } : null,
  resultsByEngine: Array.from({ length: resultsByEngineCount }, (_, index) => ({
    result: `result-${String(index)}`,
    engineKind: "oss_worker" as const,
    engineName: "OSS Worker",
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
    findings: [],
    engineSummaryMessageJa: null,
    perPhonemeGop: null,
    focusSounds: null,
    prosody: null,
  })),
  highlightRangesByEngine: [],
});

describe("deriveWorkspaceState", () => {
  describe("failed 状態の遷移", () => {
    it("runStatus=failed かつ resultsByEngine が空のとき failed を返す", () => {
      const workspace = buildWorkspace("failed", 0);
      expect(deriveWorkspaceState(workspace, false, false)).toBe("failed");
    });

    it("runStatus=failed かつ resultsByEngine が非空のとき result を返す", () => {
      const workspace = buildWorkspace("failed", 1);
      expect(deriveWorkspaceState(workspace, false, false)).toBe("result");
    });
  });

  describe("succeeded 状態の遷移", () => {
    it("runStatus=succeeded かつ resultsByEngine が非空のとき result を返す", () => {
      const workspace = buildWorkspace("succeeded", 2);
      expect(deriveWorkspaceState(workspace, false, false)).toBe("result");
    });

    it("runStatus=succeeded かつ resultsByEngine が空のとき failed を返す", () => {
      const workspace = buildWorkspace("succeeded", 0);
      expect(deriveWorkspaceState(workspace, false, false)).toBe("failed");
    });
  });

  describe("partial_succeeded 状態の遷移", () => {
    it("runStatus=partial_succeeded かつ resultsByEngine が非空のとき result を返す", () => {
      const workspace = buildWorkspace("partial_succeeded", 1);
      expect(deriveWorkspaceState(workspace, false, false)).toBe("result");
    });

    it("runStatus=partial_succeeded かつ resultsByEngine が空のとき failed を返す", () => {
      const workspace = buildWorkspace("partial_succeeded", 0);
      expect(deriveWorkspaceState(workspace, false, false)).toBe("failed");
    });
  });

  describe("録音・解析中の遷移", () => {
    it("isRecording=true のとき recording を返す", () => {
      const workspace = buildWorkspace("failed", 0);
      expect(deriveWorkspaceState(workspace, true, false)).toBe("recording");
    });

    it("submitting=true のとき analyzing を返す", () => {
      const workspace = buildWorkspace("failed", 0);
      expect(deriveWorkspaceState(workspace, false, true)).toBe("analyzing");
    });
  });

  describe("idle 状態", () => {
    it("workspace が null のとき idle を返す", () => {
      expect(deriveWorkspaceState(null, false, false)).toBe("idle");
    });

    it("latestAnalysisRun が null のとき idle を返す", () => {
      const workspace = buildWorkspace(null, 0);
      expect(deriveWorkspaceState(workspace, false, false)).toBe("idle");
    });

    it("runStatus=queued のとき analyzing を返す", () => {
      const workspace = buildWorkspace("queued", 0);
      expect(deriveWorkspaceState(workspace, false, false)).toBe("analyzing");
    });

    it("runStatus=running のとき analyzing を返す", () => {
      const workspace = buildWorkspace("running", 0);
      expect(deriveWorkspaceState(workspace, false, false)).toBe("analyzing");
    });
  });
});
