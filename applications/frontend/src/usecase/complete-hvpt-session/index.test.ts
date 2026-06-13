/**
 * CompleteHvptSession UseCase テスト
 *
 * 設計の正: docs/specs/training-screen.md (M-TR-2/3/6, サブ(3b))
 *          adr/011-spacing-scheduler-fixed-interval-mastery-gate.md (60% ゲート)
 * テスト方針: Port fake を使い、以下を検証する:
 *   - 60% 以上正答で rest（done 遷移後 rest）、SpacingSchedule 永続
 *   - 60% 未満正答で gate 遷移、SpacingSchedule 永続
 *   - captureProgressSnapshot（progress 接続）が呼ばれること（M-TR-3）
 *   - SpacingSchedule が存在しない場合は新規作成されること
 */

import { describe, it, expect, vi } from "vitest";
import { okAsync, errAsync } from "neverthrow";
import { createCompleteHvptSession } from "./index";
import type { CompleteHvptSessionInput } from "./index";
import type { TrainingSessionRepository } from "../port/training-session-repository";
import type { HvptTrialRepository } from "../port/hvpt-trial-repository";
import type { SpacingScheduleRepository } from "../port/spacing-schedule-repository";
import type { WeaknessProfileRepository } from "../port/weakness-profile-repository";
import type { ProgressSnapshotRepository } from "../port/progress-snapshot-repository";
import type { EntropyProvider } from "../port/entropy-provider";
import type { Clock } from "../port/clock";
import type { TransactionManager } from "../port/transaction-manager";
import type {
  TrainingSession,
  InProgressTrainingSession,
  TrainingSessionIdentifier,
  LearnerIdentifier,
  PhonemeContrast,
  HvptTrial,
  HvptTrialIdentifier,
  StimulusIdentifier,
  ReactionTime,
  SpacingSchedule,
  SpacingScheduleIdentifier,
  WeaknessProfile,
  WeaknessProfileIdentifier,
  DiagnosticSessionIdentifier,
  CatalogId,
  OccurrenceFrequency,
  Mastery0To1,
  PriorityScore,
  SpacingSchedulerConfig,
} from "../../domain/training";
import type { FunctionalLoadRank } from "../../domain/error-catalog";

// ---- テスト用 fixture ----

const LEARNER_IDENTIFIER = "01JWZLEARNER0000000000001" as LearnerIdentifier;
const SESSION_IDENTIFIER = "01JWZSESSION00000000000001" as TrainingSessionIdentifier;
const WEAKNESS_PROFILE_IDENTIFIER = "01TEST_WEAKNESS_PROFILE_001" as WeaknessProfileIdentifier;
const FIXED_NOW = new Date("2026-01-15T10:00:00.000Z");
const FIXED_ULID = "01JWZTEST00000000000000001";

const SCHEDULER_CONFIG: SpacingSchedulerConfig = {
  spacingIntervalHours: 24,
  masteryGateThreshold: 0.6,
  sessionCutoffMinutesMax: 30,
  sessionCutoffMinutesMin: 20,
  gateRetryIntervalHours: 6,
};

const buildInProgressHvptSession = (): InProgressTrainingSession => ({
  type: "in_progress",
  identifier: SESSION_IDENTIFIER,
  learner: LEARNER_IDENTIFIER,
  kind: "hvpt_identification",
  contrast: "r-l" as PhonemeContrast,
  startedAt: new Date("2026-01-15T09:35:00.000Z"),
});

const buildWeaknessProfile = (): WeaknessProfile => ({
  identifier: WEAKNESS_PROFILE_IDENTIFIER,
  learner: LEARNER_IDENTIFIER,
  diagnosticSession: "01TEST_DIAG_SESSION_001" as DiagnosticSessionIdentifier,
  focusSounds: [
    {
      contrast: "r-l" as PhonemeContrast,
      catalogId: "r-l-substitution" as CatalogId,
      functionalLoadRank: "max" as FunctionalLoadRank,
      occurrenceFrequency: 0.8 as unknown as OccurrenceFrequency,
      mastery: 0.3 as unknown as Mastery0To1,
      priority: 0.9 as unknown as PriorityScore,
    },
  ],
  lastUpdatedAt: FIXED_NOW,
  createdAt: FIXED_NOW,
});

/** 正答 6/10 (60%) の試行セット — 60% ゲート境界テスト */
const buildTrials = (correctCount: number, totalCount: number): HvptTrial[] =>
  Array.from({ length: totalCount }, (_, index) => ({
    identifier: `01TRIAL${String(index).padStart(16, "0")}` as HvptTrialIdentifier,
    trainingSession: SESSION_IDENTIFIER,
    stimulus: `stim-${index}` as StimulusIdentifier,
    contrast: "r-l" as PhonemeContrast,
    correctLabel: { type: "spelling" as const, value: "right" },
    response: {
      type: "spelling" as const,
      value: index < correctCount ? "right" : "light",
    },
    correct: index < correctCount,
    reactionTimeMilliseconds: 800 as ReactionTime,
    presentedAt: new Date("2026-01-15T09:40:00.000Z"),
  }));

// ---- Port fakes ----

const buildTrainingSessionRepositoryFake = (
  session: TrainingSession,
): TrainingSessionRepository => ({
  find: vi.fn((_identifier) => okAsync(session)),
  findByLearnerAndContrastOrderedByStartedAt: vi.fn((_learner, _contrast) => okAsync([])),
  persist: vi.fn((_session) => okAsync(undefined)),
  countByLearnerAndKindSince: vi.fn((_learner, _kind, _since) => okAsync(0)),
});

const buildHvptTrialRepositoryFake = (trials: HvptTrial[]): HvptTrialRepository => ({
  find: vi.fn((_identifier) =>
    errAsync({ type: "notFound" as const, resource: "HvptTrial", identifier: "not-found" }),
  ),
  findByTrainingSessionOrderedByPresentedAt: vi.fn((_trainingSession) => okAsync(trials)),
  save: vi.fn((_trial) => okAsync(undefined)),
});

const buildSpacingScheduleRepositoryFake = (
  existingSchedule: SpacingSchedule | null = null,
): SpacingScheduleRepository => ({
  find: vi.fn((_identifier) =>
    errAsync({
      type: "notFound" as const,
      resource: "SpacingSchedule",
      identifier: "not-found",
    }),
  ),
  findByLearnerAndContrast: vi.fn((_learner, _contrast) => okAsync(existingSchedule)),
  findDueByLearner: vi.fn((_learner) => okAsync([])),
  findAllByLearner: vi.fn((_learner) => okAsync([])),
  persist: vi.fn((_schedule) => okAsync(undefined)),
});

const buildWeaknessProfileRepositoryFake = (
  profile: WeaknessProfile,
): WeaknessProfileRepository => ({
  find: vi.fn((_identifier) => okAsync(profile)),
  findByLearner: vi.fn((_learner) => okAsync(profile)),
  persist: vi.fn((_profile) => okAsync(undefined)),
});

const buildProgressSnapshotRepositoryFake = (): ProgressSnapshotRepository => ({
  save: vi.fn((_snapshot) => okAsync(undefined)),
  findByLearnerOrderedByCapturedAt: vi.fn((_learner) => okAsync([])),
  find: vi.fn((_identifier) =>
    errAsync({
      type: "notFound" as const,
      resource: "ProgressSnapshot",
      identifier: "not-found",
    }),
  ),
});

const buildEntropyProviderFake = (): EntropyProvider => ({
  generateUlid: vi.fn(() => FIXED_ULID),
  generateUuidV4: vi.fn(() => "00000000-0000-4000-0000-000000000001"),
});

const buildClockFake = (): Clock => ({
  now: vi.fn(() => FIXED_NOW),
});

const buildTransactionManagerFake = (): TransactionManager => ({
  // Plain passthrough (not vi.fn): vi.fn cannot preserve the generic <T> signature
  // the TransactionManager interface requires, which breaks type assignability.
  execute: (work) => work(),
});

const buildBaseInput = (
  override?: Partial<CompleteHvptSessionInput>,
): CompleteHvptSessionInput => ({
  trainingSessionIdentifier: String(SESSION_IDENTIFIER),
  learnerIdentifier: String(LEARNER_IDENTIFIER),
  durationMinutes: 25,
  weaknessProfileIdentifier: String(WEAKNESS_PROFILE_IDENTIFIER),
  schedulerConfig: SCHEDULER_CONFIG,
  ...override,
});

// ---- テスト ----

describe("createCompleteHvptSession", () => {
  describe("SpacingSchedule 遷移: 60% ゲート（ADR-011）", () => {
    it("正答率 0.6 ちょうどで rest に遷移する（60% ゲート達成）", async () => {
      const trials = buildTrials(6, 10); // 60% 正答
      const spacingScheduleRepository = buildSpacingScheduleRepositoryFake();

      const usecase = createCompleteHvptSession({
        trainingSessionRepository: buildTrainingSessionRepositoryFake(buildInProgressHvptSession()),
        hvptTrialRepository: buildHvptTrialRepositoryFake(trials),
        spacingScheduleRepository,
        weaknessProfileRepository: buildWeaknessProfileRepositoryFake(buildWeaknessProfile()),
        progressSnapshotRepository: buildProgressSnapshotRepositoryFake(),
        transactionManager: buildTransactionManagerFake(),
        entropyProvider: buildEntropyProviderFake(),
        clock: buildClockFake(),
      });

      const result = await usecase(buildBaseInput());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // accuracy = 0.6 >= masteryGateThreshold(0.6) → rest
        expect(result.value.spacingState).toBe("rest");
        expect(result.value.sessionAccuracy).toBeCloseTo(0.6);
      }
    });

    it("正答率 0.59 で gate に遷移する（60% 未達）", async () => {
      const trials = buildTrials(59, 100); // 59% 正答
      const spacingScheduleRepository = buildSpacingScheduleRepositoryFake();

      const usecase = createCompleteHvptSession({
        trainingSessionRepository: buildTrainingSessionRepositoryFake(buildInProgressHvptSession()),
        hvptTrialRepository: buildHvptTrialRepositoryFake(trials),
        spacingScheduleRepository,
        weaknessProfileRepository: buildWeaknessProfileRepositoryFake(buildWeaknessProfile()),
        progressSnapshotRepository: buildProgressSnapshotRepositoryFake(),
        transactionManager: buildTransactionManagerFake(),
        entropyProvider: buildEntropyProviderFake(),
        clock: buildClockFake(),
      });

      const result = await usecase(buildBaseInput());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // accuracy = 0.59 < masteryGateThreshold(0.6) → gate
        expect(result.value.spacingState).toBe("gate");
        expect(result.value.sessionAccuracy).toBeCloseTo(0.59);
      }
    });

    it("SpacingSchedule が永続化される（DD-204 不変条件 4）", async () => {
      const trials = buildTrials(7, 10);
      const spacingScheduleRepository = buildSpacingScheduleRepositoryFake();

      const usecase = createCompleteHvptSession({
        trainingSessionRepository: buildTrainingSessionRepositoryFake(buildInProgressHvptSession()),
        hvptTrialRepository: buildHvptTrialRepositoryFake(trials),
        spacingScheduleRepository,
        weaknessProfileRepository: buildWeaknessProfileRepositoryFake(buildWeaknessProfile()),
        progressSnapshotRepository: buildProgressSnapshotRepositoryFake(),
        transactionManager: buildTransactionManagerFake(),
        entropyProvider: buildEntropyProviderFake(),
        clock: buildClockFake(),
      });

      await usecase(buildBaseInput());

      expect(spacingScheduleRepository.persist).toHaveBeenCalledOnce();
    });

    it("SpacingSchedule が存在しない場合（初回）は新規作成して永続化する", async () => {
      const trials = buildTrials(8, 10);
      const spacingScheduleRepository = buildSpacingScheduleRepositoryFake(null);

      const usecase = createCompleteHvptSession({
        trainingSessionRepository: buildTrainingSessionRepositoryFake(buildInProgressHvptSession()),
        hvptTrialRepository: buildHvptTrialRepositoryFake(trials),
        spacingScheduleRepository,
        weaknessProfileRepository: buildWeaknessProfileRepositoryFake(buildWeaknessProfile()),
        progressSnapshotRepository: buildProgressSnapshotRepositoryFake(),
        transactionManager: buildTransactionManagerFake(),
        entropyProvider: buildEntropyProviderFake(),
        clock: buildClockFake(),
      });

      const result = await usecase(buildBaseInput());

      expect(result.isOk()).toBe(true);
      expect(spacingScheduleRepository.persist).toHaveBeenCalledOnce();
      const persistedSchedule = vi.mocked(spacingScheduleRepository.persist).mock.calls[0]?.[0];
      // 初回は新規作成した SpacingSchedule が persist される
      expect(String(persistedSchedule?.identifier)).toBe(FIXED_ULID);
    });

    it("既存 SpacingSchedule がある場合は更新して永続化する", async () => {
      const existingSchedule: SpacingSchedule = {
        identifier: "01EXISTING_SCHED_001" as SpacingScheduleIdentifier,
        learner: LEARNER_IDENTIFIER,
        focusSound: WEAKNESS_PROFILE_IDENTIFIER,
        contrast: "r-l" as PhonemeContrast,
        state: "due",
        nextPresentationAt: FIXED_NOW,
        recentAccuracy: null,
        updatedAt: FIXED_NOW,
      };
      const trials = buildTrials(7, 10);
      const spacingScheduleRepository = buildSpacingScheduleRepositoryFake(existingSchedule);

      const usecase = createCompleteHvptSession({
        trainingSessionRepository: buildTrainingSessionRepositoryFake(buildInProgressHvptSession()),
        hvptTrialRepository: buildHvptTrialRepositoryFake(trials),
        spacingScheduleRepository,
        weaknessProfileRepository: buildWeaknessProfileRepositoryFake(buildWeaknessProfile()),
        progressSnapshotRepository: buildProgressSnapshotRepositoryFake(),
        transactionManager: buildTransactionManagerFake(),
        entropyProvider: buildEntropyProviderFake(),
        clock: buildClockFake(),
      });

      await usecase(buildBaseInput());

      const persistedSchedule = vi.mocked(spacingScheduleRepository.persist).mock.calls[0]?.[0];
      // 既存の識別子が保たれる
      expect(String(persistedSchedule?.identifier)).toBe("01EXISTING_SCHED_001");
    });
  });

  describe("progress 接続（M-TR-3）", () => {
    it("progressSnapshotRepository.save が呼ばれる（task_kind=drill）", async () => {
      const trials = buildTrials(8, 10);
      const progressSnapshotRepository = buildProgressSnapshotRepositoryFake();

      const usecase = createCompleteHvptSession({
        trainingSessionRepository: buildTrainingSessionRepositoryFake(buildInProgressHvptSession()),
        hvptTrialRepository: buildHvptTrialRepositoryFake(trials),
        spacingScheduleRepository: buildSpacingScheduleRepositoryFake(),
        weaknessProfileRepository: buildWeaknessProfileRepositoryFake(buildWeaknessProfile()),
        progressSnapshotRepository,
        transactionManager: buildTransactionManagerFake(),
        entropyProvider: buildEntropyProviderFake(),
        clock: buildClockFake(),
      });

      await usecase(buildBaseInput());

      expect(progressSnapshotRepository.save).toHaveBeenCalledOnce();
      const savedSnapshot = vi.mocked(progressSnapshotRepository.save).mock.calls[0]?.[0];
      expect(savedSnapshot?.taskKind).toBe("drill");
      expect(Number(savedSnapshot?.cumulativeTrainingMinutes)).toBe(25);
    });
  });

  describe("異常系", () => {
    it("in_progress でないセッションは validationFailed を返す", async () => {
      const completedSession: TrainingSession = {
        type: "completed",
        identifier: SESSION_IDENTIFIER,
        learner: LEARNER_IDENTIFIER,
        kind: "hvpt_identification",
        contrast: "r-l" as PhonemeContrast,
        startedAt: new Date("2026-01-15T09:35:00.000Z"),
        endedAt: FIXED_NOW,
        durationMinutes: 25 as import("../../domain/training").TrainingDurationMinutes,
        sessionAccuracy: 0.7 as import("../../domain/training").Accuracy0To1,
      };

      const usecase = createCompleteHvptSession({
        trainingSessionRepository: buildTrainingSessionRepositoryFake(completedSession),
        hvptTrialRepository: buildHvptTrialRepositoryFake([]),
        spacingScheduleRepository: buildSpacingScheduleRepositoryFake(),
        weaknessProfileRepository: buildWeaknessProfileRepositoryFake(buildWeaknessProfile()),
        progressSnapshotRepository: buildProgressSnapshotRepositoryFake(),
        transactionManager: buildTransactionManagerFake(),
        entropyProvider: buildEntropyProviderFake(),
        clock: buildClockFake(),
      });

      const result = await usecase(buildBaseInput());

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe("validationFailed");
      }
    });
  });
});
