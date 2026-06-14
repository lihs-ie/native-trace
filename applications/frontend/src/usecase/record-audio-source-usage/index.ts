/**
 * record-audio-source-usage usecase (M-GRV-8)。
 * self / model / golden いずれかの音源を再生した操作を ab_usage_logs に記録する。
 */

import type { ResultAsync } from "neverthrow";
import type { DomainError } from "../../domain/shared";
import type { AbUsageLogRepository, AudioSource } from "../port/ab-usage-log-repository";
import type { Clock } from "../port/clock";

export type RecordAudioSourceUsageInput = {
  learner: string;
  source: AudioSource;
  qualityGatePassed: boolean | null;
};

export type RecordAudioSourceUsageOutput = void;

export type RecordAudioSourceUsageDependencies = {
  abUsageLogRepository: AbUsageLogRepository;
  clock: Clock;
};

export const createRecordAudioSourceUsage =
  (dependencies: RecordAudioSourceUsageDependencies) =>
  (input: RecordAudioSourceUsageInput): ResultAsync<RecordAudioSourceUsageOutput, DomainError> => {
    const { abUsageLogRepository, clock } = dependencies;

    return abUsageLogRepository.record({
      learner: input.learner,
      source: input.source,
      playedAt: clock.now(),
      qualityGatePassed: input.qualityGatePassed,
    });
  };
