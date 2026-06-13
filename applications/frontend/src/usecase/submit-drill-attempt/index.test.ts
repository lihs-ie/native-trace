/**
 * SubmitDrillAttempt UseCase テスト
 *
 * 設計の正: docs/specs/training-screen.md (M-TR-4, サブ(2))
 *          adr/004-oss-worker-gop-nBest-diff.md
 *
 * unit テストの finding fixture は実 worker 出力形で書く（agent-policy）:
 *   - gop: 負値（worker スケール: floor=-20, ceiling=-2）
 *   - phenomenon: 文字列（"substitution" 等）
 *   - catalogId: null（worker は catalogId を出力しない場合が多い）
 *     または対象 catalogId 直接マッチの場合は catalogId あり
 *
 * 合成正値（gop=100 等）で偽 green にしない。
 */

import { describe, it, expect, vi } from "vitest";
import { okAsync, errAsync } from "neverthrow";
import { createSubmitDrillAttempt } from "./index";
import type { SubmitDrillAttemptInput, DrillScoringConfig } from "./index";
import type { TrainingSessionRepository } from "../port/training-session-repository";
import type { HvptTrialRepository } from "../port/hvpt-trial-repository";
import type { AssessmentResultRepository } from "../port/assessment-result-repository";
import type { EntropyProvider } from "../port/entropy-provider";
import type { Clock } from "../port/clock";
import type {
  TrainingSessionIdentifier,
  LearnerIdentifier,
  PhonemeContrast,
  TrainingSession,
} from "../../domain/training";
import type {
  AssessmentResult,
  AssessmentResultIdentifier,
  AssessmentFindingIdentifier,
  AssessmentFinding,
  Score0To100,
  Confidence0To1,
  TokenizerVersion,
} from "../../domain/assessment-result";
import { FindingCategory, FindingSeverity } from "../../domain/assessment-result";
import type { AnalysisJobIdentifier } from "../../domain/analysis-job";

// ---- テスト用 fixture ----

const LEARNER_IDENTIFIER = "01JWZLEARNER0000000000001" as LearnerIdentifier;
const SESSION_IDENTIFIER = "01TEST_TRAINING_SESSION_001" as TrainingSessionIdentifier;
const ASSESSMENT_RESULT_IDENTIFIER = "01TEST_ASSESSMENT_RESULT_001" as AssessmentResultIdentifier;
const FIXED_NOW = new Date("2026-01-15T10:00:00.000Z");
const FIXED_ULID = "01JWZTEST00000000000000002";

const DEFAULT_SCORING_CONFIG: DrillScoringConfig = {
  gopSuccessThreshold: -8.0,
  maxSeverityForSuccess: "minor",
};

/** in_progress production_drill TrainingSession */
const buildInProgressSession = (): TrainingSession => ({
  type: "in_progress",
  identifier: SESSION_IDENTIFIER,
  learner: LEARNER_IDENTIFIER,
  kind: "production_drill",
  contrast: "/l/-/r/" as PhonemeContrast,
  startedAt: FIXED_NOW,
});

/**
 * 実 worker 形状の finding を構築するヘルパー。
 *
 * agent-policy: unit テスト fixture は実 worker 出力形（負 GOP / phenomenon 文字列 / catalogId null）。
 * 合成正値（gop=100 等）で偽 green にしない。
 */
const buildFinding = (overrides: Partial<AssessmentFinding>): AssessmentFinding => ({
  identifier: "01TEST_FINDING_001" as AssessmentFindingIdentifier,
  phenomenon: "substitution", // 実 worker は phenomenon 文字列を出力する
  gop: -12.5, // 実 worker の GOP は負値スケール（floor=-20, ceiling=-2）
  category: FindingCategory.ACCURACY,
  severity: FindingSeverity.MAJOR,
  textRange: { startOffset: 0, endOffset: 4 },
  audioRange: null,
  expected: { text: "lake", ipa: "l" },
  detected: { text: "rake", ipa: "r" },
  messageJa: "/l/ を /r/ と置換しています",
  messageEn: null,
  scoreImpact: -5,
  confidence: 0.85 as Confidence0To1,
  detectedTopCandidate: "r", // 実 worker の NBest top candidate
  nBest: [
    { phoneme: "r", confidence: 0.85 },
    { phoneme: "l", confidence: 0.1 },
    { phoneme: "w", confidence: 0.05 },
  ],
  matchesL1Pattern: true,
  functionalLoad: "max",
  catalogId: null, // 実 worker は catalogId を null で出力することが多い
  wordPair: null,
  expectedPronunciation: null,
  insertedVowel: null,
  feedbackLayers: null,
  dismissed: false,
  wordPositionLabel: "initial",
  ...overrides,
});

/**
 * catalogId が直接マッチする finding（real worker 形状の catalogId あり）
 */
const buildFindingWithCatalogId = (catalogId: string): AssessmentFinding =>
  buildFinding({
    catalogId,
    gop: -15.0, // 実 worker の GOP は負値（-15.0 < -8.0 閾値 → failure 判定）
  });

/**
 * 軽微な finding（severity=minor、GOP が成功閾値以上）
 */
const buildMinorFinding = (): AssessmentFinding =>
  buildFinding({
    severity: FindingSeverity.MINOR,
    gop: -5.0, // -5.0 > -8.0 閾値 → success 判定
    phenomenon: "substitution",
    catalogId: "l-r-substitution",
  });

/** AssessmentResult fixture（実 worker 形状） */
const buildAssessmentResult = (findings: ReadonlyArray<AssessmentFinding>): AssessmentResult => ({
  identifier: ASSESSMENT_RESULT_IDENTIFIER,
  analysisJob: "01TEST_ANALYSIS_JOB_001" as AnalysisJobIdentifier,
  scores: {
    overall: 65 as Score0To100,
    accuracy: 60 as Score0To100,
    nativeLikeness: 55 as Score0To100,
    pronunciation: 62 as Score0To100,
    connectedSpeech: 70 as Score0To100,
    prosody: 68 as Score0To100,
    intelligibility: null,
    cefrOverall: null,
    cefrSegmental: null,
    cefrProsodic: null,
  },
  summary: {
    overallCommentJa: "発音に改善の余地があります",
    overallCommentEn: null,
  },
  findings,
  segments: [
    {
      textRange: { startOffset: 0, endOffset: 4 },
      audioRange: null,
      transcript: "lake",
      confidence: 0.9,
    },
  ],
  metadata: {
    engineName: "oss-worker",
    engineVersion: "1.0.0",
    modelName: null,
    promptVersion: null,
    schemaVersion: "1",
  },
  tokenizerVersion: "v1" as TokenizerVersion,
  raw: { data: {} },
  engineSnapshot: {
    type: "oss_worker",
    identifier: "oss-worker-v1",
    displayName: "OSS Worker",
    modelName: null,
  },
  createdAt: FIXED_NOW,
  perPhonemeGop: null,
  focusSounds: null,
  prosody: null,
  engineSummaryMessageJa: null,
});

// ---- Port fakes ----

const buildTrainingSessionRepositoryFake = (
  session: TrainingSession,
): TrainingSessionRepository => ({
  find: vi.fn((_identifier) => okAsync(session)),
  findByLearnerAndContrastOrderedByStartedAt: vi.fn((_learner, _contrast) => okAsync([session])),
  persist: vi.fn((_session) => okAsync(undefined)),
});

const buildHvptTrialRepositoryFake = (): HvptTrialRepository => ({
  find: vi.fn((_identifier) =>
    errAsync({ type: "notFound" as const, resource: "HvptTrial", identifier: "not-found" }),
  ),
  findByTrainingSessionOrderedByPresentedAt: vi.fn((_session) => okAsync([])),
  save: vi.fn((_trial) => okAsync(undefined)),
});

const buildAssessmentResultRepositoryFake = (
  result: AssessmentResult,
): AssessmentResultRepository => ({
  find: vi.fn((_identifier) => okAsync(result)),
  search: vi.fn((_criteria) => okAsync({ items: [result] })),
  persist: vi.fn((_result) => okAsync(undefined)),
});

const buildEntropyProviderFake = (): EntropyProvider => ({
  generateUlid: vi.fn(() => FIXED_ULID),
  generateUuidV4: vi.fn(() => "00000000-0000-4000-0000-000000000002"),
});

const buildClockFake = (): Clock => ({
  now: vi.fn(() => FIXED_NOW),
});

const buildInput = (overrides?: Partial<SubmitDrillAttemptInput>): SubmitDrillAttemptInput => ({
  trainingSessionIdentifier: String(SESSION_IDENTIFIER),
  assessmentResultIdentifier: String(ASSESSMENT_RESULT_IDENTIFIER),
  catalogId: "l-r-substitution",
  producedWord: "lake",
  expectedWord: "lake",
  reactionTimeMilliseconds: 1500,
  presentedAt: FIXED_NOW,
  scoringConfig: DEFAULT_SCORING_CONFIG,
  ...overrides,
});

// ---- テスト ----

describe("createSubmitDrillAttempt", () => {
  describe("正常系: findings がない場合（worker が問題を検出しない）", () => {
    it("target findings が空の場合は success を返す", async () => {
      const session = buildInProgressSession();
      // findings が空 = worker が対象音素の問題を検出しなかった
      const assessmentResult = buildAssessmentResult([]);

      const usecase = createSubmitDrillAttempt({
        trainingSessionRepository: buildTrainingSessionRepositoryFake(session),
        hvptTrialRepository: buildHvptTrialRepositoryFake(),
        assessmentResultRepository: buildAssessmentResultRepositoryFake(assessmentResult),
        entropyProvider: buildEntropyProviderFake(),
        clock: buildClockFake(),
      });

      const result = await usecase(buildInput());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.verdict).toBe("success");
        expect(result.value.targetPhonemeEvaluations).toHaveLength(1);
        expect(result.value.targetPhonemeEvaluations[0]?.gop).toBeNull();
        expect(result.value.targetPhonemeEvaluations[0]?.severity).toBeNull();
      }
    });
  });

  describe("正常系: catalogId が直接マッチする finding がある場合", () => {
    it("GOP が閾値より深い負値（低い = 悪い）の場合は failure を返す", async () => {
      const session = buildInProgressSession();
      // 実 worker 形状: catalogId 直接マッチ, GOP=-15.0 < -8.0 閾値
      const findingWithCatalogId = buildFindingWithCatalogId("l-r-substitution");
      const assessmentResult = buildAssessmentResult([findingWithCatalogId]);

      const usecase = createSubmitDrillAttempt({
        trainingSessionRepository: buildTrainingSessionRepositoryFake(session),
        hvptTrialRepository: buildHvptTrialRepositoryFake(),
        assessmentResultRepository: buildAssessmentResultRepositoryFake(assessmentResult),
        entropyProvider: buildEntropyProviderFake(),
        clock: buildClockFake(),
      });

      const result = await usecase(buildInput({ catalogId: "l-r-substitution" }));

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.verdict).toBe("failure");
        expect(result.value.targetPhonemeEvaluations[0]?.gop).toBe(-15.0);
        // NBest は実 worker 形状（候補あり）
        expect(result.value.targetPhonemeEvaluations[0]?.nBest).not.toBeNull();
      }
    });

    it("severity=minor の finding は success（maxSeverityForSuccess=minor）", async () => {
      const session = buildInProgressSession();
      // 実 worker 形状: catalogId 直接マッチ, severity=minor
      const minorFinding = buildMinorFinding();
      const assessmentResult = buildAssessmentResult([minorFinding]);

      const usecase = createSubmitDrillAttempt({
        trainingSessionRepository: buildTrainingSessionRepositoryFake(session),
        hvptTrialRepository: buildHvptTrialRepositoryFake(),
        assessmentResultRepository: buildAssessmentResultRepositoryFake(assessmentResult),
        entropyProvider: buildEntropyProviderFake(),
        clock: buildClockFake(),
      });

      const result = await usecase(
        buildInput({
          catalogId: "l-r-substitution",
          scoringConfig: { gopSuccessThreshold: -8.0, maxSeverityForSuccess: "minor" },
        }),
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.verdict).toBe("success");
      }
    });

    it("severity=major の finding は failure（major > minor 閾値）", async () => {
      const session = buildInProgressSession();
      // 実 worker 形状: catalogId 直接マッチ, severity=major, GOP=-12.5 < -8.0
      const majorFinding = buildFinding({
        catalogId: "l-r-substitution",
        severity: FindingSeverity.MAJOR,
        gop: -12.5,
      });
      const assessmentResult = buildAssessmentResult([majorFinding]);

      const usecase = createSubmitDrillAttempt({
        trainingSessionRepository: buildTrainingSessionRepositoryFake(session),
        hvptTrialRepository: buildHvptTrialRepositoryFake(),
        assessmentResultRepository: buildAssessmentResultRepositoryFake(assessmentResult),
        entropyProvider: buildEntropyProviderFake(),
        clock: buildClockFake(),
      });

      const result = await usecase(buildInput({ catalogId: "l-r-substitution" }));

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.verdict).toBe("failure");
      }
    });
  });

  describe("正常系: HvptTrial 永続化", () => {
    it("HvptTrial が hvptTrialRepository.save で永続化される", async () => {
      const session = buildInProgressSession();
      const assessmentResult = buildAssessmentResult([]);
      const hvptTrialRepository = buildHvptTrialRepositoryFake();

      const usecase = createSubmitDrillAttempt({
        trainingSessionRepository: buildTrainingSessionRepositoryFake(session),
        hvptTrialRepository,
        assessmentResultRepository: buildAssessmentResultRepositoryFake(assessmentResult),
        entropyProvider: buildEntropyProviderFake(),
        clock: buildClockFake(),
      });

      const result = await usecase(buildInput({ producedWord: "lake", expectedWord: "lake" }));

      expect(result.isOk()).toBe(true);
      expect(hvptTrialRepository.save).toHaveBeenCalledOnce();

      const savedTrial = vi.mocked(hvptTrialRepository.save).mock.calls[0]?.[0];
      expect(savedTrial?.trainingSession).toBe(SESSION_IDENTIFIER);
      // 同じ語 = correct=true
      expect(savedTrial?.correct).toBe(true);
      expect(String(savedTrial?.identifier)).toBe(FIXED_ULID);
    });

    it("producedWord != expectedWord の場合は correct=false", async () => {
      const session = buildInProgressSession();
      const assessmentResult = buildAssessmentResult([]);
      const hvptTrialRepository = buildHvptTrialRepositoryFake();

      const usecase = createSubmitDrillAttempt({
        trainingSessionRepository: buildTrainingSessionRepositoryFake(session),
        hvptTrialRepository,
        assessmentResultRepository: buildAssessmentResultRepositoryFake(assessmentResult),
        entropyProvider: buildEntropyProviderFake(),
        clock: buildClockFake(),
      });

      await usecase(buildInput({ producedWord: "rake", expectedWord: "lake" }));

      const savedTrial = vi.mocked(hvptTrialRepository.save).mock.calls[0]?.[0];
      expect(savedTrial?.correct).toBe(false);
    });

    it("返却値の hvptTrialIdentifier は生成した ULID に一致する", async () => {
      const session = buildInProgressSession();
      const assessmentResult = buildAssessmentResult([]);

      const usecase = createSubmitDrillAttempt({
        trainingSessionRepository: buildTrainingSessionRepositoryFake(session),
        hvptTrialRepository: buildHvptTrialRepositoryFake(),
        assessmentResultRepository: buildAssessmentResultRepositoryFake(assessmentResult),
        entropyProvider: buildEntropyProviderFake(),
        clock: buildClockFake(),
      });

      const result = await usecase(buildInput());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.hvptTrialIdentifier).toBe(FIXED_ULID);
      }
    });
  });

  describe("異常系", () => {
    it("TrainingSession が in_progress でない場合は validationFailed を返す", async () => {
      const completedSession: TrainingSession = {
        type: "completed",
        identifier: SESSION_IDENTIFIER,
        learner: LEARNER_IDENTIFIER,
        kind: "production_drill",
        contrast: "/l/-/r/" as PhonemeContrast,
        startedAt: FIXED_NOW,
        endedAt: FIXED_NOW,
        durationMinutes: 5 as unknown as import("../../domain/training").TrainingDurationMinutes,
        sessionAccuracy: null,
      };

      const usecase = createSubmitDrillAttempt({
        trainingSessionRepository: buildTrainingSessionRepositoryFake(completedSession),
        hvptTrialRepository: buildHvptTrialRepositoryFake(),
        assessmentResultRepository: buildAssessmentResultRepositoryFake(buildAssessmentResult([])),
        entropyProvider: buildEntropyProviderFake(),
        clock: buildClockFake(),
      });

      const result = await usecase(buildInput());

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe("validationFailed");
      }
    });

    it("不正な trainingSessionIdentifier は validationFailed を返す", async () => {
      const session = buildInProgressSession();

      const usecase = createSubmitDrillAttempt({
        trainingSessionRepository: buildTrainingSessionRepositoryFake(session),
        hvptTrialRepository: buildHvptTrialRepositoryFake(),
        assessmentResultRepository: buildAssessmentResultRepositoryFake(buildAssessmentResult([])),
        entropyProvider: buildEntropyProviderFake(),
        clock: buildClockFake(),
      });

      const result = await usecase(buildInput({ trainingSessionIdentifier: "" }));

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe("validationFailed");
      }
    });
  });
});
