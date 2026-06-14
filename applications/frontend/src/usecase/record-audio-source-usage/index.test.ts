/**
 * record-audio-source-usage usecase テスト (M-GRV-8)。
 * self / model / golden の再生が ab_usage_logs に timestamp + 品質ゲート結果付きで記録されることを検証する。
 */

import { describe, it, expect, vi } from "vitest";
import { okAsync } from "neverthrow";
import { createRecordAudioSourceUsage } from "./index";
import type { AbUsageLogRepository } from "../port/ab-usage-log-repository";
import type { Clock } from "../port/clock";

const FIXED_NOW = new Date("2026-01-15T10:00:00.000Z");

describe("createRecordAudioSourceUsage (M-GRV-8)", () => {
  it("records a golden play with timestamp and quality gate result", async () => {
    const recorded: Array<Record<string, unknown>> = [];
    const abUsageLogRepository: AbUsageLogRepository = {
      record: vi.fn((entry) => {
        recorded.push(entry as Record<string, unknown>);
        return okAsync(undefined);
      }),
    };
    const clock: Clock = { now: () => FIXED_NOW };
    const usecase = createRecordAudioSourceUsage({ abUsageLogRepository, clock });

    const result = await usecase({
      learner: "01JWZLEARNER0000000000001",
      source: "golden",
      qualityGatePassed: true,
    });

    expect(result.isOk()).toBe(true);
    expect(abUsageLogRepository.record).toHaveBeenCalledTimes(1);
    expect(recorded[0]).toMatchObject({
      learner: "01JWZLEARNER0000000000001",
      source: "golden",
      playedAt: FIXED_NOW,
      qualityGatePassed: true,
    });
  });

  it("records self/model plays with a null quality gate", async () => {
    const abUsageLogRepository: AbUsageLogRepository = {
      record: vi.fn(() => okAsync(undefined)),
    };
    const clock: Clock = { now: () => FIXED_NOW };
    const usecase = createRecordAudioSourceUsage({ abUsageLogRepository, clock });

    await usecase({ learner: "01JWZLEARNER0000000000001", source: "self", qualityGatePassed: null });

    expect(abUsageLogRepository.record).toHaveBeenCalledWith(
      expect.objectContaining({ source: "self", qualityGatePassed: null }),
    );
  });
});
