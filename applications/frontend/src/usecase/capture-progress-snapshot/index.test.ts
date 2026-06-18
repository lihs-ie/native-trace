/**
 * CaptureProgressSnapshot UseCase — contract tests (M-PG-2)
 *
 * 設計の正: docs/specs/progress-screen.md (M-PG-2)
 *
 * テスト戦略:
 *   1. baseline snapshot が正常に生成・永続化されること
 *   2. completeDiagnosticSession → captureProgressSnapshot の連鎖で
 *      ProgressSnapshot が 1 件生成されることを統合的に assert する
 *   3. viewProgress が baseline 後に 1 件返すこと
 */

import { describe, it, expect, vi } from "vitest";
import { okAsync, errAsync } from "neverthrow";
import { createCaptureProgressSnapshot, type CaptureProgressSnapshotDependencies } from "./index";
import {
  createCompleteDiagnosticSession,
  type CompleteDiagnosticSessionDependencies,
  type GopNormalizationRange,
} from "../complete-diagnostic-session/index";
import { createViewProgress } from "../view-progress/index";
import {
  type DiagnosticSession,
  type WeaknessProfile,
  createDiagnosticSessionIdentifier,
  createLearnerIdentifier,
  createWeaknessProfileIdentifier,
  createOccurrenceFrequency,
  createMastery0To1,
  createPhonemeContrast,
  createCatalogId,
  createPriorityScore,
} from "../../domain/training";
import { createSectionIdentifier } from "../../domain/section";
import { type AssessmentResult } from "../../domain/assessment-result";
import type { ProgressSnapshot } from "../../domain/training";
import { notFound } from "../../domain/shared";
import { getDiagnosticPromptSet } from "../../infrastructure/training/diagnostic-prompt-fixture";

// ---- Constants ----

const SENTINEL_LEARNER = "01JWZLEARNER0000000000001";
const SESSION_ID = "01JX0000000000000000000001";
const PROFILE_ID = "01JX0000000000000000000002";
const SNAPSHOT_ID = "01JX0000000000000000000003";

const DEFAULT_GOP_RANGE: GopNormalizationRange = { floor: -20, ceiling: -2 };

// ---- Fixture helpers ----

const makeSession = (): DiagnosticSession => {
  const identifier = createDiagnosticSessionIdentifier(SESSION_ID)!;
  const learner = createLearnerIdentifier(SENTINEL_LEARNER)!;
  return {
    type: "pending",
    identifier,
    learner,
    promptSet: getDiagnosticPromptSet(),
    startedAt: new Date("2026-06-13T00:00:00Z"),
  };
};

const makeAssessmentResult = (): AssessmentResult => ({
  identifier: "AR_1" as never,
  analysisJob: "JOB_1" as never,
  scores: {
    overall: 59 as never,
    accuracy: 55 as never,
    nativeLikeness: 50 as never,
    pronunciation: 58 as never,
    connectedSpeech: 62 as never,
    prosody: 65 as never,
    intelligibility: null,
    cefrOverall: { score: 59, band: "B1" },
    cefrSegmental: { score: 55, band: "B1" },
    cefrProsodic: { score: 65, band: "B1+" },
  },
  summary: { overallCommentJa: "テスト", overallCommentEn: null },
  findings: [
    {
      identifier: "FIND_1" as never,
      phenomenon: "substitution",
      gop: -10.4,
      category: "accuracy",
      severity: "major",
      textRange: { startOffset: 0, endOffset: 5 },
      audioRange: null,
      expected: { text: null, ipa: "h ə l oʊ w ɜː l d" },
      detected: { text: null, ipa: "f ʌ n ɔ w ɜː l d" },
      messageJa: "テスト",
      messageEn: null,
      scoreImpact: -8,
      confidence: 0.85 as never,
      detectedTopCandidate: "ɹ",
      nBest: [{ phoneme: "ɹ", confidence: 0.0005 }],
      matchesL1Pattern: false,
      functionalLoad: null,
      catalogId: null,
      wordPair: null,
      expectedPronunciation: null,
      insertedVowel: null,
      insertionPositionMs: null,
      feedbackLayers: null,
      dismissed: false,
      wordPositionLabel: null,
    },
  ],
  segments: [] as never,
  metadata: {
    engineName: "oss_worker",
    engineVersion: "1.0",
    modelName: null,
    promptVersion: null,
    schemaVersion: "1",
  },
  tokenizerVersion: "v1" as never,
  raw: { data: {} },
  engineSnapshot: { type: "oss_worker", identifier: "w1", displayName: "worker", modelName: null },
  createdAt: new Date("2026-06-13T00:00:00Z"),
  perPhonemeGop: null,
  focusSounds: null,
  prosody: null,
  engineSummaryMessageJa: null,
});

const makeWeaknessProfile = (): WeaknessProfile => {
  const identifier = createWeaknessProfileIdentifier(PROFILE_ID)!;
  const learner = createLearnerIdentifier(SENTINEL_LEARNER)!;
  const diagnosticSession = createDiagnosticSessionIdentifier(SESSION_ID)!;
  const contrast = createPhonemeContrast("/l/-/r/")!;
  const catalogId = createCatalogId("l-r-substitution")!;
  const occurrenceFrequency = createOccurrenceFrequency(0.5)._unsafeUnwrap();
  const mastery = createMastery0To1(0.4)._unsafeUnwrap();
  const priority = createPriorityScore(0.7)._unsafeUnwrap();
  return {
    identifier,
    learner,
    diagnosticSession,
    focusSounds: [
      {
        contrast,
        catalogId,
        functionalLoadRank: "max",
        occurrenceFrequency,
        mastery,
        priority,
      },
    ] as never,
    lastUpdatedAt: new Date("2026-06-13T01:00:00Z"),
    createdAt: new Date("2026-06-13T01:00:00Z"),
  };
};

// ---- Unit: CaptureProgressSnapshot ----

describe("createCaptureProgressSnapshot (M-PG-2)", () => {
  it("AssessmentResult と WeaknessProfile から baseline ProgressSnapshot を生成・永続化する", async () => {
    const savedSnapshots: ProgressSnapshot[] = [];
    const deps: CaptureProgressSnapshotDependencies = {
      progressSnapshotRepository: {
        save: vi.fn((snapshot: ProgressSnapshot) => {
          savedSnapshots.push(snapshot);
          return okAsync(undefined);
        }),
        findByLearnerOrderedByCapturedAt: () => okAsync([]),
        find: () => errAsync(notFound("ProgressSnapshot", "x")),
      },
      entropyProvider: {
        generateUlid: () => SNAPSHOT_ID,
        generateUuidV4: () => "00000000-0000-0000-0000-000000000003",
      },
      clock: {
        now: () => new Date("2026-06-13T01:00:00Z"),
      },
    };

    const learner = createLearnerIdentifier(SENTINEL_LEARNER)!;
    const section = createSectionIdentifier(SESSION_ID)!;
    const assessmentResult = makeAssessmentResult();
    const weaknessProfile = makeWeaknessProfile();

    const executor = createCaptureProgressSnapshot(deps);
    const result = await executor({
      learner,
      section,
      assessmentResult,
      weaknessProfile,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.progressSnapshotIdentifier).toBe(SNAPSHOT_ID);
    }

    // ProgressSnapshot が永続化されたことを確認
    expect(deps.progressSnapshotRepository.save as ReturnType<typeof vi.fn>).toHaveBeenCalledOnce();
    expect(savedSnapshots).toHaveLength(1);

    const snapshot = savedSnapshots[0]!;
    // CEFR スコアは AssessmentResult.scores から deriveCefrSubscalesFromScores で導出される
    expect(Number(snapshot.cefrScores.overall)).toBeGreaterThan(0);
    // focusScores は WeaknessProfile.focusSounds から生成される
    expect(snapshot.focusScores.length).toBe(weaknessProfile.focusSounds.length);
    // cumulativeTrainingMinutes = 0 (honest empty, training 未実装)
    expect(Number(snapshot.cumulativeTrainingMinutes)).toBe(0);
  });

  it("weaknessProfile.focusSounds の mastery が focusScores.score に変換される", async () => {
    const savedSnapshots: ProgressSnapshot[] = [];
    const deps: CaptureProgressSnapshotDependencies = {
      progressSnapshotRepository: {
        save: vi.fn((snapshot: ProgressSnapshot) => {
          savedSnapshots.push(snapshot);
          return okAsync(undefined);
        }),
        findByLearnerOrderedByCapturedAt: () => okAsync([]),
        find: () => errAsync(notFound("ProgressSnapshot", "x")),
      },
      entropyProvider: {
        generateUlid: () => SNAPSHOT_ID,
        generateUuidV4: () => "00000000-0000-0000-0000-000000000003",
      },
      clock: {
        now: () => new Date("2026-06-13T01:00:00Z"),
      },
    };

    const learner = createLearnerIdentifier(SENTINEL_LEARNER)!;
    const section = createSectionIdentifier(SESSION_ID)!;
    const assessmentResult = makeAssessmentResult();
    const weaknessProfile = makeWeaknessProfile();
    // mastery = 0.4 → score = round(0.4 * 100) = 40

    const executor = createCaptureProgressSnapshot(deps);
    await executor({ learner, section, assessmentResult, weaknessProfile });

    const snapshot = savedSnapshots[0]!;
    expect(snapshot.focusScores[0]?.score).toBe(40);
  });
});

// ---- Integration: completeDiagnosticSession → captureProgressSnapshot → viewProgress ----

describe("diagnostic completion → baseline snapshot → viewProgress (M-PG-2 統合)", () => {
  it("completeDiagnosticSession 後に captureProgressSnapshot を呼ぶと viewProgress が 1 件返す", async () => {
    // in-memory ProgressSnapshot store
    const snapshotStore: ProgressSnapshot[] = [];

    const assessmentResult = makeAssessmentResult();

    // completeDiagnosticSession の依存
    const completeDeps: CompleteDiagnosticSessionDependencies = {
      diagnosticSessionRepository: {
        find: () => okAsync(makeSession()),
        findLatestByLearner: () => okAsync(null),
        persist: vi.fn(() => okAsync(undefined)) as never,
      },
      weaknessProfileRepository: {
        find: () => errAsync(notFound("WeaknessProfile", "x")),
        findByLearner: () => okAsync(null),
        persist: vi.fn(() => okAsync(undefined)) as never,
      },
      assessmentResultRepository: {
        find: () => okAsync(assessmentResult),
        search: () => okAsync({ items: [assessmentResult] }),
        persist: vi.fn(() => okAsync(undefined)) as never,
      },
      entropyProvider: {
        generateUlid: () => PROFILE_ID,
        generateUuidV4: () => "00000000-0000-0000-0000-000000000002",
      },
      clock: {
        now: () => new Date("2026-06-13T01:00:00Z"),
      },
    };

    // captureProgressSnapshot の依存
    const captureDeps: CaptureProgressSnapshotDependencies = {
      progressSnapshotRepository: {
        save: vi.fn((snapshot: ProgressSnapshot) => {
          snapshotStore.push(snapshot);
          return okAsync(undefined);
        }),
        findByLearnerOrderedByCapturedAt: (learner) =>
          okAsync(snapshotStore.filter((s) => String(s.learner) === String(learner))),
        find: () => errAsync(notFound("ProgressSnapshot", "x")),
      },
      entropyProvider: {
        generateUlid: () => SNAPSHOT_ID,
        generateUuidV4: () => "00000000-0000-0000-0000-000000000003",
      },
      clock: {
        now: () => new Date("2026-06-13T01:00:00Z"),
      },
    };

    // 1. diagnostic セッションを完了させ、WeaknessProfile と AssessmentResults を取得する
    const completeExecutor = createCompleteDiagnosticSession(completeDeps);
    const completeResult = await completeExecutor({
      diagnosticSessionIdentifier: SESSION_ID,
      assessmentResultIdentifiers: ["AR_1"],
      priorityWeights: { w1: 0.5, w2: 0.3, w3: 0.2 },
      gopNormalizationRange: DEFAULT_GOP_RANGE,
    });

    expect(completeResult.isOk()).toBe(true);
    if (completeResult.isErr()) return;

    // 2. Output から WeaknessProfile と AssessmentResult を取り出して capture に渡す
    const { weaknessProfile, assessmentResults } = completeResult.value;
    const primaryAssessmentResult = assessmentResults[0]!;

    const learner = createLearnerIdentifier(SENTINEL_LEARNER)!;
    const section = createSectionIdentifier(SESSION_ID)!;

    const captureExecutor = createCaptureProgressSnapshot(captureDeps);
    const captureResult = await captureExecutor({
      learner,
      section,
      assessmentResult: primaryAssessmentResult,
      weaknessProfile,
    });

    expect(captureResult.isOk()).toBe(true);

    // 3. viewProgress が baseline 1 件を返すことを確認
    const viewProgressExecutor = createViewProgress({
      progressSnapshotRepository: captureDeps.progressSnapshotRepository,
    });

    const viewResult = await viewProgressExecutor({ learner });
    expect(viewResult.isOk()).toBe(true);
    if (viewResult.isErr()) return;

    expect(viewResult.value.snapshots).toHaveLength(1);
    expect(viewResult.value.now).not.toBeNull();
    expect(viewResult.value.prev).toBeNull(); // baseline は 1 件のみ
    expect(viewResult.value.now?.section).toBe(SESSION_ID);
    expect(viewResult.value.now?.cumulativeTrainingMinutes).toBe(0);
    expect(viewResult.value.now?.focusScores.length).toBeGreaterThan(0);
  });

  it("完了後の Output に weaknessProfile と assessmentResults が含まれる", async () => {
    const assessmentResult = makeAssessmentResult();

    const completeDeps: CompleteDiagnosticSessionDependencies = {
      diagnosticSessionRepository: {
        find: () => okAsync(makeSession()),
        findLatestByLearner: () => okAsync(null),
        persist: vi.fn(() => okAsync(undefined)) as never,
      },
      weaknessProfileRepository: {
        find: () => errAsync(notFound("WeaknessProfile", "x")),
        findByLearner: () => okAsync(null),
        persist: vi.fn(() => okAsync(undefined)) as never,
      },
      assessmentResultRepository: {
        find: () => okAsync(assessmentResult),
        search: () => okAsync({ items: [assessmentResult] }),
        persist: vi.fn(() => okAsync(undefined)) as never,
      },
      entropyProvider: {
        generateUlid: () => PROFILE_ID,
        generateUuidV4: () => "00000000-0000-0000-0000-000000000002",
      },
      clock: {
        now: () => new Date("2026-06-13T01:00:00Z"),
      },
    };

    const completeExecutor = createCompleteDiagnosticSession(completeDeps);
    const result = await completeExecutor({
      diagnosticSessionIdentifier: SESSION_ID,
      assessmentResultIdentifiers: ["AR_1"],
      priorityWeights: { w1: 0.5, w2: 0.3, w3: 0.2 },
      gopNormalizationRange: DEFAULT_GOP_RANGE,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    // weaknessProfile と assessmentResults が Output に含まれること
    expect(result.value.weaknessProfile).toBeDefined();
    expect(result.value.weaknessProfile.focusSounds.length).toBeGreaterThan(0);
    expect(result.value.assessmentResults).toHaveLength(1);
    expect(result.value.assessmentResults[0]).toBe(assessmentResult);
  });
});
