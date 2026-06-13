/**
 * ComputeShadowingLag UseCase テスト (M-SHL-4/5, ORPHAN-3)
 *
 * 設計の正: docs/specs/shadowing-lag.md / adr/013-shadowing-lag-measurement.md
 * 検証: training_sessions への永続 (kind='shadowing', session_accuracy=null) と
 *       worker の lag 計測結果のパススルー。applySpacingTransition は呼ばない (ADR-011)。
 */

import { describe, it, expect, vi } from "vitest";
import { okAsync } from "neverthrow";
import { createComputeShadowingLag } from "./index";
import type { ComputeShadowingLagInput } from "./index";
import type { ShadowingLagClient, ShadowingLagResult } from "../port/shadowing-lag-client";
import type { TrainingSessionRepository } from "../port/training-session-repository";
import type { EntropyProvider } from "../port/entropy-provider";
import type { Clock } from "../port/clock";
import type { TrainingSession, SpacingSchedulerConfig, PhonemeContrast } from "../../domain/training";

const FIXED_NOW = new Date("2026-01-15T10:00:00.000Z");
const FIXED_ULID = "01JWZSHADOW0000000000000001";

const SCHEDULER_CONFIG: SpacingSchedulerConfig = {
  spacingIntervalHours: 24,
  masteryGateThreshold: 0.6,
  sessionCutoffMinutesMax: 30,
  sessionCutoffMinutesMin: 20,
  gateRetryIntervalHours: 6,
};

const LAG_RESULT: ShadowingLagResult = {
  lagMilliseconds: 620,
  perSegmentLag: [{ phoneme: "h", lagMilliseconds: 200 }],
  speechRateRatio: 1.1,
  pauseCountLearner: 2,
  pauseCountReference: 1,
  recommendSlowPlayback: true,
  thresholdMilliseconds: 500,
};

const buildInput = (): ComputeShadowingLagInput => ({
  learnerIdentifier: "01JWZLEARNER0000000000001",
  contrast: "r-l",
  referenceAudioBytes: new Uint8Array([1, 2, 3]),
  referenceAudioMimeType: "audio/wav",
  learnerAudioBytes: new Uint8Array([4, 5, 6]),
  learnerAudioMimeType: "audio/webm",
  referenceText: "Hello, world.",
  durationMilliseconds: 1000,
  durationMinutes: 22,
  schedulerConfig: SCHEDULER_CONFIG,
});

const buildDeps = () => {
  const persisted: TrainingSession[] = [];
  const trainingSessionRepository: TrainingSessionRepository = {
    find: vi.fn(),
    findByLearnerAndContrastOrderedByStartedAt: vi.fn(),
    persist: vi.fn((session: TrainingSession) => {
      persisted.push(session);
      return okAsync(undefined);
    }),
    countByLearnerAndKindSince: vi.fn(),
  };
  const shadowingLagClient: ShadowingLagClient = {
    computeLag: vi.fn(() => okAsync(LAG_RESULT)),
  };
  const entropyProvider: EntropyProvider = { generateUlid: () => FIXED_ULID };
  const clock: Clock = { now: () => FIXED_NOW };
  return { trainingSessionRepository, shadowingLagClient, entropyProvider, clock, persisted };
};

describe("createComputeShadowingLag (M-SHL-4/5, ORPHAN-3)", () => {
  it("persists in_progress then completed shadowing sessions (kind='shadowing')", async () => {
    const deps = buildDeps();
    const usecase = createComputeShadowingLag(deps);
    const result = await usecase(buildInput());

    expect(result.isOk()).toBe(true);
    // ORPHAN-3: training_sessions に2回 (InProgress -> Completed) 永続される
    expect(deps.trainingSessionRepository.persist).toHaveBeenCalledTimes(2);
    expect(deps.persisted[0]).toMatchObject({ type: "in_progress", kind: "shadowing" });
    expect(deps.persisted[1]).toMatchObject({ type: "completed", kind: "shadowing" });
  });

  it("passes through the worker lag result (lag / recommendSlowPlayback / threshold)", async () => {
    const deps = buildDeps();
    const usecase = createComputeShadowingLag(deps);
    const result = await usecase(buildInput());

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.lagMilliseconds).toBe(620);
      expect(result.value.recommendSlowPlayback).toBe(true);
      expect(result.value.thresholdMilliseconds).toBe(500);
      expect(result.value.perSegmentLag).toHaveLength(1);
    }
    expect(deps.shadowingLagClient.computeLag).toHaveBeenCalledWith(
      expect.objectContaining({ referenceText: "Hello, world." }),
    );
  });

  it("does not require a valid contrast literal beyond domain rules", async () => {
    // 不正な contrast は validationFailed で弾く (domain 健全性)
    const deps = buildDeps();
    const usecase = createComputeShadowingLag(deps);
    const result = await usecase({ ...buildInput(), contrast: "" as unknown as PhonemeContrast });
    expect(result.isErr()).toBe(true);
    expect(deps.trainingSessionRepository.persist).not.toHaveBeenCalled();
  });
});
