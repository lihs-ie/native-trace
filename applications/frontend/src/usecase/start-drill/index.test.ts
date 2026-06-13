/**
 * StartDrill UseCase テスト
 *
 * 設計の正: docs/specs/training-screen.md (M-TR-4, サブ(2))
 * テスト方針: Port fake を使い、WeaknessProfile から対立選択・TrainingSession 永続を検証する。
 *
 * unit テストの fixture は実 worker 形状に準じる（agent-policy）。
 * WeaknessProfile.focusSounds は priority 降順ソート済みを前提とする（domain 不変条件）。
 */

import { describe, it, expect, vi } from "vitest";
import { okAsync, errAsync } from "neverthrow";
import { createStartDrill } from "./index";
import type { StartDrillInput } from "./index";
import type { WeaknessProfileRepository } from "../port/weakness-profile-repository";
import type { TrainingSessionRepository } from "../port/training-session-repository";
import type { DrillContentRepository } from "../port/drill-content-repository";
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
} from "../../domain/training";
import type { FunctionalLoadRank } from "../../domain/error-catalog";
import type { DrillContent } from "../port/drill-content-repository";

// ---- テスト用 fixture ----

const LEARNER_IDENTIFIER = "01JWZLEARNER0000000000001" as LearnerIdentifier;
const WEAKNESS_PROFILE_IDENTIFIER = "01TEST_WEAKNESS_PROFILE_001" as WeaknessProfileIdentifier;
const FIXED_NOW = new Date("2026-01-15T10:00:00.000Z");
const FIXED_ULID = "01JWZTEST00000000000000001";

/** /l/-/r/ 対立に対応する l-r-substitution catalogId を持つ WeaknessProfile */
const buildWeaknessProfileWithLrContrast = (): WeaknessProfile => ({
  identifier: WEAKNESS_PROFILE_IDENTIFIER,
  learner: LEARNER_IDENTIFIER,
  diagnosticSession: "01TEST_DIAG_SESSION_001" as DiagnosticSessionIdentifier,
  focusSounds: [
    {
      contrast: "/l/-/r/" as PhonemeContrast,
      catalogId: "l-r-substitution" as CatalogId,
      functionalLoadRank: "max" as FunctionalLoadRank,
      occurrenceFrequency: 0.8 as unknown as OccurrenceFrequency,
      mastery: 0.2 as unknown as Mastery0To1,
      priority: 0.9 as unknown as PriorityScore,
    },
    {
      contrast: "/v/-/b/" as PhonemeContrast,
      catalogId: "v-b-substitution" as CatalogId,
      functionalLoadRank: "high" as FunctionalLoadRank,
      occurrenceFrequency: 0.5 as unknown as OccurrenceFrequency,
      mastery: 0.4 as unknown as Mastery0To1,
      priority: 0.6 as unknown as PriorityScore,
    },
  ],
  lastUpdatedAt: FIXED_NOW,
  createdAt: FIXED_NOW,
});

/** l-r-substitution ドリルコンテンツ */
const LR_DRILL_CONTENT: DrillContent = {
  catalogId: "l-r-substitution",
  contrast: "/l/-/r/",
  targetPhonemes: ["/l/"],
  minimalPairs: [
    {
      targetWord: "lake",
      contrastWord: "rake",
      targetPhonemeIpa: "l",
      contrastPhonemeIpa: "r",
    },
  ],
  exampleSentence: "Please collect all the blue leaves.",
  exampleTargetPhonemeIpas: ["l", "l", "l", "l"],
  hintJa: "舌先を歯茎に当て、舌の左右から息を流してください。",
};

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
});

const buildDrillContentRepositoryFake = (content: DrillContent | null): DrillContentRepository => ({
  findByCatalogId: vi.fn((_catalogId) => content),
  findByContrast: vi.fn((_contrast) => content),
  getAll: vi.fn(() => (content ? [content] : [])),
});

const buildEntropyProviderFake = (): EntropyProvider => ({
  generateUlid: vi.fn(() => FIXED_ULID),
  generateUuidV4: vi.fn(() => "00000000-0000-4000-0000-000000000001"),
});

const buildClockFake = (): Clock => ({
  now: vi.fn(() => FIXED_NOW),
});

// ---- テスト ----

describe("createStartDrill", () => {
  describe("正常系: WeaknessProfile から対立を選択して TrainingSession を開始する", () => {
    it("priority 最高の focus sound に対応するドリルコンテンツで TrainingSession を開始する", async () => {
      const weaknessProfile = buildWeaknessProfileWithLrContrast();
      const drillContentRepository = buildDrillContentRepositoryFake(LR_DRILL_CONTENT);
      const trainingSessionRepository = buildTrainingSessionRepositoryFake();

      const usecase = createStartDrill({
        weaknessProfileRepository: buildWeaknessProfileRepositoryFake(weaknessProfile),
        trainingSessionRepository,
        drillContentRepository,
        entropyProvider: buildEntropyProviderFake(),
        clock: buildClockFake(),
      });

      const input: StartDrillInput = {
        learnerIdentifier: String(LEARNER_IDENTIFIER),
        weaknessProfileIdentifier: String(WEAKNESS_PROFILE_IDENTIFIER),
      };

      const result = await usecase(input);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const output = result.value;
        expect(output.contrast).toBe("/l/-/r/");
        expect(output.drillContent.catalogId).toBe("l-r-substitution");
        expect(output.drillContent.minimalPairs).toHaveLength(1);
        expect(output.trainingSession.type).toBe("in_progress");
        expect(output.trainingSession.kind).toBe("production_drill");
        expect(String(output.trainingSession.identifier)).toBe(FIXED_ULID);
        expect(String(output.trainingSession.learner)).toBe(String(LEARNER_IDENTIFIER));
      }
    });

    it("TrainingSession が trainingSessionRepository.persist で永続化される", async () => {
      const weaknessProfile = buildWeaknessProfileWithLrContrast();
      const trainingSessionRepository = buildTrainingSessionRepositoryFake();

      const usecase = createStartDrill({
        weaknessProfileRepository: buildWeaknessProfileRepositoryFake(weaknessProfile),
        trainingSessionRepository,
        drillContentRepository: buildDrillContentRepositoryFake(LR_DRILL_CONTENT),
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
      expect(persistedSession?.kind).toBe("production_drill");
    });

    it("第 1 対立にドリルコンテンツがない場合、第 2 対立を選択する", async () => {
      const weaknessProfile = buildWeaknessProfileWithLrContrast();

      // l-r-substitution にはコンテンツなし、v-b-substitution にはコンテンツあり
      const vbDrillContent: DrillContent = {
        catalogId: "v-b-substitution",
        contrast: "/v/-/b/",
        targetPhonemes: ["/v/"],
        minimalPairs: [
          {
            targetWord: "van",
            contrastWord: "ban",
            targetPhonemeIpa: "v",
            contrastPhonemeIpa: "b",
          },
        ],
        exampleSentence: "Very brave volunteers visited the village.",
        exampleTargetPhonemeIpas: ["v", "v", "v"],
        hintJa: "上前歯を下唇に当てて息を流します。",
      };

      const drillContentRepository: DrillContentRepository = {
        findByCatalogId: vi.fn((catalogId: string) => {
          if (catalogId === "v-b-substitution") return vbDrillContent;
          return null;
        }),
        findByContrast: vi.fn((_contrast: string) => null),
        getAll: vi.fn(() => [vbDrillContent]),
      };

      const usecase = createStartDrill({
        weaknessProfileRepository: buildWeaknessProfileRepositoryFake(weaknessProfile),
        trainingSessionRepository: buildTrainingSessionRepositoryFake(),
        drillContentRepository,
        entropyProvider: buildEntropyProviderFake(),
        clock: buildClockFake(),
      });

      const result = await usecase({
        learnerIdentifier: String(LEARNER_IDENTIFIER),
        weaknessProfileIdentifier: String(WEAKNESS_PROFILE_IDENTIFIER),
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.contrast).toBe("/v/-/b/");
        expect(result.value.drillContent.catalogId).toBe("v-b-substitution");
      }
    });
  });

  describe("異常系", () => {
    it("全 focus sound にドリルコンテンツがない場合は validationFailed を返す", async () => {
      const weaknessProfile = buildWeaknessProfileWithLrContrast();

      const usecase = createStartDrill({
        weaknessProfileRepository: buildWeaknessProfileRepositoryFake(weaknessProfile),
        trainingSessionRepository: buildTrainingSessionRepositoryFake(),
        drillContentRepository: buildDrillContentRepositoryFake(null),
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
      const weaknessProfile = buildWeaknessProfileWithLrContrast();

      const usecase = createStartDrill({
        weaknessProfileRepository: buildWeaknessProfileRepositoryFake(weaknessProfile),
        trainingSessionRepository: buildTrainingSessionRepositoryFake(),
        drillContentRepository: buildDrillContentRepositoryFake(LR_DRILL_CONTENT),
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
