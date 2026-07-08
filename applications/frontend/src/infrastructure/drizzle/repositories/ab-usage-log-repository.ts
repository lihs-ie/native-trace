/**
 * Drizzle 実装: AbUsageLogRepository (M-GRV-8, ORPHAN-5)。
 * ab_usage_logs テーブルへの append-only な記録を担う。
 */

import { randomUUID } from "crypto";
import { type DrizzleDatabase } from "../client";
import { abUsageLogs } from "../schema";
import type {
  AbUsageLogRepository,
  AbUsageLog,
} from "../../../usecase/port/ab-usage-log-repository";
import { tryPersistence } from "./try-persistence";

export const createDrizzleAbUsageLogRepository = (
  database: DrizzleDatabase,
): AbUsageLogRepository => ({
  record: (log: Omit<AbUsageLog, "identifier">) => {
    return tryPersistence(() => {
      const identifier = randomUUID();
      database
        .insert(abUsageLogs)
        .values({
          identifier,
          learner: log.learner,
          source: log.source,
          playedAt: log.playedAt.toISOString(),
          qualityGatePassed: log.qualityGatePassed === null ? null : log.qualityGatePassed ? 1 : 0,
        })
        .run();
      return undefined;
    });
  },
});
