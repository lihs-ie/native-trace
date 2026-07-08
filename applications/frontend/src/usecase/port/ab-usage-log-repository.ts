/**
 * AbUsageLogRepository port (M-GRV-8, ORPHAN-5)。
 * A/B audio source 使用ログの永続化インターフェース。
 */

import type { ResultAsync } from "neverthrow";
import type { DomainError } from "../../domain/shared";

export type AudioSource = "self" | "model" | "golden";

export type AbUsageLog = {
  identifier: string;
  learner: string;
  source: AudioSource;
  playedAt: Date;
  qualityGatePassed: boolean | null;
};

export type AbUsageLogRepository = {
  record: (log: Omit<AbUsageLog, "identifier">) => ResultAsync<void, DomainError>;
};
