/**
 * SubmitHvptTrial UseCase テスト (ORPHAN-5)
 *
 * 設計の正: docs/specs/training-screen.md (M-TR-6, サブ(3b))
 * テスト方針: Port fake を使い、正誤導出・HvptTrial 永続（ORPHAN-5）を検証する。
 *
 * ORPHAN-5 検証: hvptTrialRepository.save が 1 回呼ばれること（配線確認）。
 * correct 導出: correctLabel と response の一致から domain が計算すること。
 */

import { describe, it, expect, vi } from "vitest";
import { okAsync, errAsync } from "neverthrow";
import { createSubmitHvptTrial } from "./index";
import type { SubmitHvptTrialInput } from "./index";
import type { TrainingSessionRepository } from "../port/training-session-repository";
import type { HvptTrialRepository } from "../port/hvpt-trial-repository";
import type { EntropyProvider } from "../port/entropy-provider";
import type { Clock } from "../port/clock";
import type {
  TrainingSession,
  InProgressTrainingSession,
  TrainingSessionIdentifier,
  LearnerIdentifier,
  PhonemeContrast,
} from "../../domain/training";

// ---- テスト用 fixture ----

const LEARNER_IDENTIFIER = "01JWZLEARNER0000000000001" as LearnerIdentifier;
const SESSION_IDENTIFIER = "01JWZSESSION00000000000001" as TrainingSessionIdentifier;
const FIXED_NOW = new Date("2026-01-15T10:00:00.000Z");
const FIXED_ULID = "01JWZTRIAL000000000000001";

const buildInProgressHvptSession = (): InProgressTrainingSession => ({
  type: "in_progress",
  identifier: SESSION_IDENTIFIER,
  learner: LEARNER_IDENTIFIER,
  kind: "hvpt_identification",
  contrast: "r-l" as PhonemeContrast,
  startedAt: FIXED_NOW,
});

// ---- Port fakes ----

const buildTrainingSessionRepositoryFake = (
  session: TrainingSession,
): TrainingSessionRepository => ({
  find: vi.fn((_identifier) => okAsync(session)),
  findByLearnerAndContrastOrderedByStartedAt: vi.fn((_learner, _contrast) => okAsync([])),
  persist: vi.fn((_session) => okAsync(undefined)),
  countByLearnerAndKindSince: vi.fn((_learner, _kind, _since) => okAsync(0)),
});

const buildHvptTrialRepositoryFake = (): HvptTrialRepository => ({
  find: vi.fn((_identifier) =>
    errAsync({ type: "notFound" as const, resource: "HvptTrial", identifier: "not-found" }),
  ),
  findByTrainingSessionOrderedByPresentedAt: vi.fn((_trainingSession) => okAsync([])),
  save: vi.fn((_trial) => okAsync(undefined)),
});

const buildEntropyProviderFake = (): EntropyProvider => ({
  generateUlid: vi.fn(() => FIXED_ULID),
  generateUuidV4: vi.fn(() => "00000000-0000-4000-0000-000000000001"),
});

const buildClockFake = (): Clock => ({
  now: vi.fn(() => FIXED_NOW),
});

const buildBaseInput = (override?: Partial<SubmitHvptTrialInput>): SubmitHvptTrialInput => ({
  trainingSessionIdentifier: String(SESSION_IDENTIFIER),
  stimulusIdentifier: "stim-right-001",
  correctLabelType: "spelling",
  correctLabelValue: "right",
  responseLabelType: "spelling",
  responseLabelValue: "right",
  reactionTimeMilliseconds: 850,
  presentedAt: FIXED_NOW.toISOString(),
  correctStimulusWavBase64: "UklGRiQAAABXQVZFZm10IBAAAA==",
  ...override,
});

// ---- テスト ----

describe("createSubmitHvptTrial", () => {
  describe("正常系: 識別試行を記録し正誤フィードバックを返す", () => {
    it("正解応答（correctLabel と response が一致）で correct=true を返す", async () => {
      const hvptTrialRepository = buildHvptTrialRepositoryFake();
      const usecase = createSubmitHvptTrial({
        trainingSessionRepository: buildTrainingSessionRepositoryFake(buildInProgressHvptSession()),
        hvptTrialRepository,
        entropyProvider: buildEntropyProviderFake(),
        clock: buildClockFake(),
      });

      const result = await usecase(
        buildBaseInput({
          correctLabelValue: "right",
          responseLabelValue: "right", // 正解と一致
        }),
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.correct).toBe(true);
        expect(result.value.hvptTrialIdentifier).toBe(FIXED_ULID);
        expect(result.value.correctLabel.value).toBe("right");
      }
    });

    it("誤答（correctLabel と response が不一致）で correct=false を返す", async () => {
      const hvptTrialRepository = buildHvptTrialRepositoryFake();
      const usecase = createSubmitHvptTrial({
        trainingSessionRepository: buildTrainingSessionRepositoryFake(buildInProgressHvptSession()),
        hvptTrialRepository,
        entropyProvider: buildEntropyProviderFake(),
        clock: buildClockFake(),
      });

      const result = await usecase(
        buildBaseInput({
          correctLabelValue: "right",
          responseLabelValue: "light", // 誤答
        }),
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.correct).toBe(false);
      }
    });

    it("ORPHAN-5: hvptTrialRepository.save が 1 回呼ばれる（配線確認）", async () => {
      const hvptTrialRepository = buildHvptTrialRepositoryFake();
      const usecase = createSubmitHvptTrial({
        trainingSessionRepository: buildTrainingSessionRepositoryFake(buildInProgressHvptSession()),
        hvptTrialRepository,
        entropyProvider: buildEntropyProviderFake(),
        clock: buildClockFake(),
      });

      await usecase(buildBaseInput());

      expect(hvptTrialRepository.save).toHaveBeenCalledOnce();
      const savedTrial = vi.mocked(hvptTrialRepository.save).mock.calls[0]?.[0];
      expect(String(savedTrial?.trainingSession)).toBe(String(SESSION_IDENTIFIER));
      expect(String(savedTrial?.stimulus)).toBe("stim-right-001");
    });

    it("correct は domain の recordHvptTrial が導出する（不変条件 1）", async () => {
      // type が同じでも value が異なれば false
      const hvptTrialRepository = buildHvptTrialRepositoryFake();
      const usecase = createSubmitHvptTrial({
        trainingSessionRepository: buildTrainingSessionRepositoryFake(buildInProgressHvptSession()),
        hvptTrialRepository,
        entropyProvider: buildEntropyProviderFake(),
        clock: buildClockFake(),
      });

      const result = await usecase(
        buildBaseInput({
          correctLabelType: "spelling",
          correctLabelValue: "right",
          responseLabelType: "spelling",
          responseLabelValue: "light",
        }),
      );

      if (result.isOk()) {
        const savedTrial = vi.mocked(hvptTrialRepository.save).mock.calls[0]?.[0];
        // correct は domain が correctLabel と response の一致から導出
        expect(savedTrial?.correct).toBe(false);
      }
    });

    it("correctStimulusWavBase64 が null の場合は null を返す", async () => {
      const usecase = createSubmitHvptTrial({
        trainingSessionRepository: buildTrainingSessionRepositoryFake(buildInProgressHvptSession()),
        hvptTrialRepository: buildHvptTrialRepositoryFake(),
        entropyProvider: buildEntropyProviderFake(),
        clock: buildClockFake(),
      });

      const result = await usecase(buildBaseInput({ correctStimulusWavBase64: null }));

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.correctStimulusWavBase64).toBeNull();
      }
    });
  });

  describe("異常系", () => {
    it("in_progress でないセッション（completed）は validationFailed を返す", async () => {
      const completedSession: TrainingSession = {
        type: "completed",
        identifier: SESSION_IDENTIFIER,
        learner: LEARNER_IDENTIFIER,
        kind: "hvpt_identification",
        contrast: "r-l" as PhonemeContrast,
        startedAt: FIXED_NOW,
        endedAt: new Date("2026-01-15T10:25:00.000Z"),
        durationMinutes: 25 as import("../../domain/training").TrainingDurationMinutes,
        sessionAccuracy: 0.7 as import("../../domain/training").Accuracy0To1,
      };

      const usecase = createSubmitHvptTrial({
        trainingSessionRepository: buildTrainingSessionRepositoryFake(completedSession),
        hvptTrialRepository: buildHvptTrialRepositoryFake(),
        entropyProvider: buildEntropyProviderFake(),
        clock: buildClockFake(),
      });

      const result = await usecase(buildBaseInput());

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe("validationFailed");
      }
    });

    it("不正な responseLabelType は validationFailed を返す", async () => {
      const usecase = createSubmitHvptTrial({
        trainingSessionRepository: buildTrainingSessionRepositoryFake(buildInProgressHvptSession()),
        hvptTrialRepository: buildHvptTrialRepositoryFake(),
        entropyProvider: buildEntropyProviderFake(),
        clock: buildClockFake(),
      });

      const result = await usecase(
        buildBaseInput({
          responseLabelType: "image", // 画像ラベルは不可（DD-295）
        }),
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe("validationFailed");
      }
    });

    it("不正な presentedAt（ISO 8601 でない）は validationFailed を返す", async () => {
      const usecase = createSubmitHvptTrial({
        trainingSessionRepository: buildTrainingSessionRepositoryFake(buildInProgressHvptSession()),
        hvptTrialRepository: buildHvptTrialRepositoryFake(),
        entropyProvider: buildEntropyProviderFake(),
        clock: buildClockFake(),
      });

      const result = await usecase(buildBaseInput({ presentedAt: "not-a-date" }));

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe("validationFailed");
      }
    });
  });
});
