import { describe, it, expect } from "vitest";
import { okAsync, errAsync } from "neverthrow";
import { createViewDiagnosticResult, type ViewDiagnosticResultDependencies } from "./index";
import {
  createDiagnosticSessionIdentifier,
  createLearnerIdentifier,
  createWeaknessProfileIdentifier,
  createOccurrenceFrequency,
  createMastery0To1,
  createPriorityScore,
  createPhonemeContrast,
  createCatalogId,
} from "../../domain/training";
import { getDiagnosticPromptSet } from "../../infrastructure/training/diagnostic-prompt-fixture";
import { notFound } from "../../domain/shared";
import type { AssessmentResult } from "../../domain/assessment-result";

/**
 * M-DG-3/4/5: viewDiagnosticResult usecase contract test
 *
 * - 完了セッションの Stage / CEFR / focus sounds を正しく組み立てること
 * - pending セッションはエラーを返すこと
 */

const SESSION_ID = "01JX_DIAG_SESSION_00000001";
const PROFILE_ID = "01JX_WEAKNESS_PROFILE_0001";
const LEARNER_ID = "01JWZLEARNER0000000000001";

const makeCompletedSession = () => ({
  type: "completed" as const,
  identifier: createDiagnosticSessionIdentifier(SESSION_ID)!,
  learner: createLearnerIdentifier(LEARNER_ID)!,
  promptSet: getDiagnosticPromptSet(),
  assessmentResults: ["AR_1"] as never,
  weaknessProfile: createWeaknessProfileIdentifier(PROFILE_ID)!,
  startedAt: new Date("2026-06-13T00:00:00Z"),
  completedAt: new Date("2026-06-13T01:00:00Z"),
});

const makeWeaknessProfile = () => ({
  identifier: createWeaknessProfileIdentifier(PROFILE_ID)!,
  learner: createLearnerIdentifier(LEARNER_ID)!,
  diagnosticSession: createDiagnosticSessionIdentifier(SESSION_ID)!,
  focusSounds: [
    {
      contrast: createPhonemeContrast("/l/-/r/")!,
      catalogId: createCatalogId("l-r-substitution")!,
      functionalLoadRank: "max" as const,
      occurrenceFrequency: createOccurrenceFrequency(0.5)._unsafeUnwrap(),
      mastery: createMastery0To1(0.3)._unsafeUnwrap(),
      priority: createPriorityScore(0.75)._unsafeUnwrap(),
    },
  ] as never,
  lastUpdatedAt: new Date("2026-06-13T01:00:00Z"),
  createdAt: new Date("2026-06-13T01:00:00Z"),
});

const makeAssessmentResult = (): AssessmentResult => ({
  identifier: "AR_1" as never,
  analysisJob: "JOB_1" as never,
  scores: {
    overall: 60 as never,
    accuracy: 55 as never,
    nativeLikeness: 50 as never,
    pronunciation: 58 as never,
    connectedSpeech: 62 as never,
    prosody: 65 as never,
    intelligibility: null,
    cefrOverall: { score: 50, band: "B1" },
    cefrSegmental: { score: 48, band: "B1" },
    cefrProsodic: { score: 52, band: "B1" },
  },
  summary: { overallCommentJa: "テスト", overallCommentEn: null },
  findings: [],
  segments: [{ textRange: { startOffset: 0, endOffset: 10 }, audioRange: null, transcript: null, confidence: 0.9 }] as never,
  metadata: { engineName: "oss_worker", engineVersion: "1.0", modelName: null, promptVersion: null, schemaVersion: "1" },
  tokenizerVersion: "v1" as never,
  raw: { data: {} },
  engineSnapshot: { type: "oss_worker", identifier: "w1", displayName: "worker", modelName: null },
  createdAt: new Date("2026-06-13T00:00:00Z"),
  perPhonemeGop: null,
  focusSounds: null,
  prosody: null,
  engineSummaryMessageJa: null,
});

const makeDeps = (
  overrides: Partial<ViewDiagnosticResultDependencies> = {},
): ViewDiagnosticResultDependencies => ({
  diagnosticSessionRepository: {
    find: () => okAsync(makeCompletedSession()),
    findLatestByLearner: () => okAsync(null),
    persist: () => okAsync(undefined),
  },
  weaknessProfileRepository: {
    find: () => okAsync(makeWeaknessProfile()),
    findByLearner: () => okAsync(null),
    persist: () => okAsync(undefined),
  },
  assessmentResultRepository: {
    find: () => okAsync(makeAssessmentResult()),
    search: () => okAsync({ items: [makeAssessmentResult()] }),
    persist: () => okAsync(undefined),
  },
  ...overrides,
});

describe("createViewDiagnosticResult", () => {
  it("完了セッションの診断結果を正しく組み立てて返す", async () => {
    const executor = createViewDiagnosticResult(makeDeps());

    const result = await executor({ diagnosticSessionIdentifier: SESSION_ID });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const value = result.value;
      expect(value.diagnosticSessionIdentifier).toBe(SESSION_ID);
      expect(value.weaknessProfileIdentifier).toBe(PROFILE_ID);
      expect(value.stage).toBe("stageI"); // overall=60 < 75 → stageI
      expect(value.focusSounds.length).toBe(1);
      expect(value.focusSounds[0]!.catalogId).toBe("l-r-substitution");
      expect(value.focusSounds[0]!.functionalLoadRank).toBe("max");
      expect(value.completedAt).toBe("2026-06-13T01:00:00.000Z");

      // CEFR 下位尺度
      expect(value.cefrSubscales.overall?.band).toBe("B1");
      expect(value.cefrSubscales.segmental?.band).toBe("B1");
      expect(value.cefrSubscales.prosodic?.band).toBe("B1");
    }
  });

  it("overall スコアが 75 以上なら stageII を返す", async () => {
    const highScoreResult = makeAssessmentResult();
    const deps = makeDeps({
      assessmentResultRepository: {
        find: () =>
          okAsync({
            ...highScoreResult,
            scores: { ...highScoreResult.scores, overall: 80 as never },
          }),
        search: () => okAsync({ items: [] }),
        persist: () => okAsync(undefined),
      },
    });
    const executor = createViewDiagnosticResult(deps);

    const result = await executor({ diagnosticSessionIdentifier: SESSION_ID });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.stage).toBe("stageII");
    }
  });

  it("pending セッションはエラーを返す（reason に pending が含まれる）", async () => {
    const pendingSession = {
      type: "pending" as const,
      identifier: createDiagnosticSessionIdentifier(SESSION_ID)!,
      learner: createLearnerIdentifier(LEARNER_ID)!,
      promptSet: getDiagnosticPromptSet(),
      startedAt: new Date("2026-06-13T00:00:00Z"),
    };

    const deps = makeDeps({
      diagnosticSessionRepository: {
        find: () => okAsync(pendingSession),
        findLatestByLearner: () => okAsync(null),
        persist: () => okAsync(undefined),
      },
    });
    const executor = createViewDiagnosticResult(deps);

    const result = await executor({ diagnosticSessionIdentifier: SESSION_ID });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("validationFailed");
      expect(
        "reason" in result.error && result.error.reason.includes("pending"),
      ).toBe(true);
    }
  });

  it("セッションが存在しない場合は notFound エラーを返す", async () => {
    const deps = makeDeps({
      diagnosticSessionRepository: {
        find: () => errAsync(notFound("DiagnosticSession", SESSION_ID)),
        findLatestByLearner: () => okAsync(null),
        persist: () => okAsync(undefined),
      },
    });
    const executor = createViewDiagnosticResult(deps);

    const result = await executor({ diagnosticSessionIdentifier: SESSION_ID });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("notFound");
    }
  });
});
