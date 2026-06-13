/**
 * StartHvptSession UseCase テスト
 *
 * 設計の正: docs/specs/training-screen.md (M-TR-5/6, サブ(3b))
 * テスト方針: Port fake (AnalyzerStimulusClient は Port fake) を使い、
 *   対立選択・刺激取得・TrainingSession 永続を検証する。
 *
 * agent-policy: 本番コードに mock/stub 禁止。テストダブルはこのファイルのみ。
 */

import { describe, it, expect, vi } from "vitest";
import { okAsync, errAsync } from "neverthrow";
import { createStartHvptSession } from "./index";
import type { StartHvptSessionInput } from "./index";
import type { WeaknessProfileRepository } from "../port/weakness-profile-repository";
import type { TrainingSessionRepository } from "../port/training-session-repository";
import type { SpacingScheduleRepository } from "../port/spacing-schedule-repository";
import type { AnalyzerStimulusClient, StimulusRecord } from "../port/analyzer-stimulus-client";
import type { EntropyProvider } from "../port/entropy-provider";
import type { Clock } from "../port/clock";
import type {
  WeaknessProfile,
  WeaknessProfileIdentifier,
  LearnerIdentifier,
  DiagnosticSessionIdentifier,
  PhonemeContrast,
  CatalogId,
  OccurrenceFrequency,
  Mastery0To1,
  PriorityScore,
  SpacingSchedule,
  SpacingScheduleIdentifier,
} from "../../domain/training";
import type { FunctionalLoadRank } from "../../domain/error-catalog";

// ---- テスト用 fixture ----

const LEARNER_IDENTIFIER = "01JWZLEARNER0000000000001" as LearnerIdentifier;
const WEAKNESS_PROFILE_IDENTIFIER = "01TEST_WEAKNESS_PROFILE_001" as WeaknessProfileIdentifier;
const FIXED_NOW = new Date("2026-01-15T10:00:00.000Z");
const FIXED_ULID = "01JWZTEST00000000000000001";

const buildWeaknessProfileWithRlContrast = (): WeaknessProfile => ({
  identifier: WEAKNESS_PROFILE_IDENTIFIER,
  learner: LEARNER_IDENTIFIER,
  diagnosticSession: "01TEST_DIAG_SESSION_001" as DiagnosticSessionIdentifier,
  focusSounds: [
    {
      contrast: "r-l" as PhonemeContrast,
      catalogId: "r-l-substitution" as CatalogId,
      functionalLoadRank: "max" as FunctionalLoadRank,
      occurrenceFrequency: 0.8 as unknown as OccurrenceFrequency,
      mastery: 0.2 as unknown as Mastery0To1,
      priority: 0.9 as unknown as PriorityScore,
    },
  ],
  lastUpdatedAt: FIXED_NOW,
  createdAt: FIXED_NOW,
});

/** analyzer /v1/stimuli の実形状に準拠した刺激 fixture */
const buildRlStimulusRecords = (): StimulusRecord[] => [
  {
    stimulusIdentifier: "stim-right-001",
    contrast: "r-l",
    word: "right",
    speakerIdentifier: "spk-1234",
    speakerSex: "M",
    context: "word-initial",
    sourceCorpus: "LibriTTS train-clean-100",
    licenseIdentifier: "CC-BY-4.0",
    wavBase64: "UklGRiQAAABXQVZFZm10IBAAAA==",
  },
  {
    stimulusIdentifier: "stim-light-001",
    contrast: "r-l",
    word: "light",
    speakerIdentifier: "spk-5678",
    speakerSex: "F",
    context: "word-initial",
    sourceCorpus: "LibriTTS train-clean-100",
    licenseIdentifier: "CC-BY-4.0",
    wavBase64: "UklGRiQAAABXQVZFZm10IBAAAA==",
  },
];

// ---- Port fakes ----

const buildWeaknessProfileRepositoryFake = (
  profile: WeaknessProfile,
): WeaknessProfileRepository => ({
  find: vi.fn((_identifier) => okAsync(profile)),
  findByLearner: vi.fn((_learner) => okAsync(profile)),
  persist: vi.fn((_profile) => okAsync(undefined)),
});

const buildTrainingSessionRepositoryFake = (): TrainingSessionRepository => ({
  find: vi.fn((_identifier) =>
    errAsync({ type: "notFound" as const, resource: "TrainingSession", identifier: "not-found" }),
  ),
  findByLearnerAndContrastOrderedByStartedAt: vi.fn((_learner, _contrast) => okAsync([])),
  persist: vi.fn((_session) => okAsync(undefined)),
  countByLearnerAndKindSince: vi.fn((_learner, _kind, _since) => okAsync(0)),
});

const buildSpacingScheduleRepositoryFake = (
  dueSchedules: SpacingSchedule[] = [],
): SpacingScheduleRepository => ({
  find: vi.fn((_identifier) =>
    errAsync({
      type: "notFound" as const,
      resource: "SpacingSchedule",
      identifier: "not-found",
    }),
  ),
  findByLearnerAndContrast: vi.fn((_learner, _contrast) => okAsync(null)),
  findDueByLearner: vi.fn((_learner) => okAsync(dueSchedules)),
  findAllByLearner: vi.fn((_learner) => okAsync([])),
  persist: vi.fn((_schedule) => okAsync(undefined)),
});

const buildAnalyzerStimulusClientFake = (records: StimulusRecord[]): AnalyzerStimulusClient => ({
  fetchStimuli: vi.fn((_contrast, _context, _limit) => okAsync(records)),
});

const buildAnalyzerStimulusClientNotFoundFake = (): AnalyzerStimulusClient => ({
  fetchStimuli: vi.fn((_contrast, _context, _limit) =>
    errAsync({ type: "notFound" as const, resource: "Stimulus", identifier: "r-l" }),
  ),
});

const buildEntropyProviderFake = (): EntropyProvider => ({
  generateUlid: vi.fn(() => FIXED_ULID),
  generateUuidV4: vi.fn(() => "00000000-0000-4000-0000-000000000001"),
});

const buildClockFake = (): Clock => ({
  now: vi.fn(() => FIXED_NOW),
});

// ---- テスト ----

describe("createStartHvptSession", () => {
  describe("正常系: WeaknessProfile の focus 対立で刺激セットを取得し TrainingSession を開始する", () => {
    it("WeaknessProfile の最優先対立から刺激を取得して hvpt_identification セッションを開始する", async () => {
      const weaknessProfile = buildWeaknessProfileWithRlContrast();
      const stimuliRecords = buildRlStimulusRecords();
      const trainingSessionRepository = buildTrainingSessionRepositoryFake();
      const analyzerStimulusClient = buildAnalyzerStimulusClientFake(stimuliRecords);

      const usecase = createStartHvptSession({
        weaknessProfileRepository: buildWeaknessProfileRepositoryFake(weaknessProfile),
        trainingSessionRepository,
        spacingScheduleRepository: buildSpacingScheduleRepositoryFake(),
        analyzerStimulusClient,
        entropyProvider: buildEntropyProviderFake(),
        clock: buildClockFake(),
      });

      const input: StartHvptSessionInput = {
        learnerIdentifier: String(LEARNER_IDENTIFIER),
        weaknessProfileIdentifier: String(WEAKNESS_PROFILE_IDENTIFIER),
      };

      const result = await usecase(input);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const output = result.value;
        expect(output.contrast).toBe("r-l");
        expect(output.trainingSession.type).toBe("in_progress");
        expect(output.trainingSession.kind).toBe("hvpt_identification");
        expect(String(output.trainingSession.identifier)).toBe(FIXED_ULID);
        expect(output.stimuli).toHaveLength(2);
        // 各刺激に choices が付与されていること
        expect(output.stimuli[0].choices.length).toBeGreaterThanOrEqual(2);
        expect(output.stimuli[0].correctLabel.type).toBe("spelling");
      }
    });

    it("analyzer が対立の刺激を返す: fetchStimuli が contrast='r-l' で呼ばれる", async () => {
      const weaknessProfile = buildWeaknessProfileWithRlContrast();
      const stimuliRecords = buildRlStimulusRecords();
      const analyzerStimulusClient = buildAnalyzerStimulusClientFake(stimuliRecords);

      const usecase = createStartHvptSession({
        weaknessProfileRepository: buildWeaknessProfileRepositoryFake(weaknessProfile),
        trainingSessionRepository: buildTrainingSessionRepositoryFake(),
        spacingScheduleRepository: buildSpacingScheduleRepositoryFake(),
        analyzerStimulusClient,
        entropyProvider: buildEntropyProviderFake(),
        clock: buildClockFake(),
      });

      await usecase({
        learnerIdentifier: String(LEARNER_IDENTIFIER),
        weaknessProfileIdentifier: String(WEAKNESS_PROFILE_IDENTIFIER),
      });

      expect(analyzerStimulusClient.fetchStimuli).toHaveBeenCalledOnce();
      expect(vi.mocked(analyzerStimulusClient.fetchStimuli).mock.calls[0]?.[0]).toBe("r-l");
    });

    it("TrainingSession が trainingSessionRepository.persist で永続化される", async () => {
      const weaknessProfile = buildWeaknessProfileWithRlContrast();
      const trainingSessionRepository = buildTrainingSessionRepositoryFake();

      const usecase = createStartHvptSession({
        weaknessProfileRepository: buildWeaknessProfileRepositoryFake(weaknessProfile),
        trainingSessionRepository,
        spacingScheduleRepository: buildSpacingScheduleRepositoryFake(),
        analyzerStimulusClient: buildAnalyzerStimulusClientFake(buildRlStimulusRecords()),
        entropyProvider: buildEntropyProviderFake(),
        clock: buildClockFake(),
      });

      await usecase({
        learnerIdentifier: String(LEARNER_IDENTIFIER),
        weaknessProfileIdentifier: String(WEAKNESS_PROFILE_IDENTIFIER),
      });

      expect(trainingSessionRepository.persist).toHaveBeenCalledOnce();
      const persistedSession = vi.mocked(trainingSessionRepository.persist).mock.calls[0]?.[0];
      expect(persistedSession?.type).toBe("in_progress");
      expect(persistedSession?.kind).toBe("hvpt_identification");
    });

    it("SpacingSchedule に due 対立がある場合、due 対立を優先して選択する", async () => {
      const weaknessProfile = buildWeaknessProfileWithRlContrast();

      // due 状態のスケジュール（ae-ah 対立）
      const dueSchedule: SpacingSchedule = {
        identifier: "01TEST_SCHED_001" as SpacingScheduleIdentifier,
        learner: LEARNER_IDENTIFIER,
        focusSound: WEAKNESS_PROFILE_IDENTIFIER,
        contrast: "ae-ah" as PhonemeContrast,
        state: "due",
        nextPresentationAt: new Date("2026-01-14T10:00:00.000Z"),
        recentAccuracy: null,
        updatedAt: FIXED_NOW,
      };

      const analyzerStimulusClient = buildAnalyzerStimulusClientFake([
        {
          stimulusIdentifier: "stim-cat-001",
          contrast: "ae-ah",
          word: "cat",
          speakerIdentifier: "spk-9999",
          speakerSex: "F",
          context: "word-initial",
          sourceCorpus: "LibriTTS train-clean-100",
          licenseIdentifier: "CC-BY-4.0",
          wavBase64: "UklGRiQAAABXQVZFZm10IBAAAA==",
        },
        {
          stimulusIdentifier: "stim-cot-001",
          contrast: "ae-ah",
          word: "cot",
          speakerIdentifier: "spk-8888",
          speakerSex: "M",
          context: "word-initial",
          sourceCorpus: "LibriTTS train-clean-100",
          licenseIdentifier: "CC-BY-4.0",
          wavBase64: "UklGRiQAAABXQVZFZm10IBAAAA==",
        },
      ]);

      const usecase = createStartHvptSession({
        weaknessProfileRepository: buildWeaknessProfileRepositoryFake(weaknessProfile),
        trainingSessionRepository: buildTrainingSessionRepositoryFake(),
        spacingScheduleRepository: buildSpacingScheduleRepositoryFake([dueSchedule]),
        analyzerStimulusClient,
        entropyProvider: buildEntropyProviderFake(),
        clock: buildClockFake(),
      });

      const result = await usecase({
        learnerIdentifier: String(LEARNER_IDENTIFIER),
        weaknessProfileIdentifier: String(WEAKNESS_PROFILE_IDENTIFIER),
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // due の ae-ah が WeaknessProfile の r-l より優先される
        expect(result.value.contrast).toBe("ae-ah");
      }
    });
  });

  describe("異常系", () => {
    it("analyzer が 404 を返した場合（刺激なし）は notFound エラーを返す", async () => {
      const weaknessProfile = buildWeaknessProfileWithRlContrast();

      const usecase = createStartHvptSession({
        weaknessProfileRepository: buildWeaknessProfileRepositoryFake(weaknessProfile),
        trainingSessionRepository: buildTrainingSessionRepositoryFake(),
        spacingScheduleRepository: buildSpacingScheduleRepositoryFake(),
        analyzerStimulusClient: buildAnalyzerStimulusClientNotFoundFake(),
        entropyProvider: buildEntropyProviderFake(),
        clock: buildClockFake(),
      });

      const result = await usecase({
        learnerIdentifier: String(LEARNER_IDENTIFIER),
        weaknessProfileIdentifier: String(WEAKNESS_PROFILE_IDENTIFIER),
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe("notFound");
      }
    });

    it("analyzer が空配列を返した場合は validationFailed を返す", async () => {
      const weaknessProfile = buildWeaknessProfileWithRlContrast();

      const usecase = createStartHvptSession({
        weaknessProfileRepository: buildWeaknessProfileRepositoryFake(weaknessProfile),
        trainingSessionRepository: buildTrainingSessionRepositoryFake(),
        spacingScheduleRepository: buildSpacingScheduleRepositoryFake(),
        analyzerStimulusClient: buildAnalyzerStimulusClientFake([]),
        entropyProvider: buildEntropyProviderFake(),
        clock: buildClockFake(),
      });

      const result = await usecase({
        learnerIdentifier: String(LEARNER_IDENTIFIER),
        weaknessProfileIdentifier: String(WEAKNESS_PROFILE_IDENTIFIER),
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe("validationFailed");
      }
    });

    it("不正な learnerIdentifier（空文字）は validationFailed を返す", async () => {
      const weaknessProfile = buildWeaknessProfileWithRlContrast();

      const usecase = createStartHvptSession({
        weaknessProfileRepository: buildWeaknessProfileRepositoryFake(weaknessProfile),
        trainingSessionRepository: buildTrainingSessionRepositoryFake(),
        spacingScheduleRepository: buildSpacingScheduleRepositoryFake(),
        analyzerStimulusClient: buildAnalyzerStimulusClientFake(buildRlStimulusRecords()),
        entropyProvider: buildEntropyProviderFake(),
        clock: buildClockFake(),
      });

      const result = await usecase({
        learnerIdentifier: "",
        weaknessProfileIdentifier: String(WEAKNESS_PROFILE_IDENTIFIER),
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe("validationFailed");
      }
    });
  });
});
