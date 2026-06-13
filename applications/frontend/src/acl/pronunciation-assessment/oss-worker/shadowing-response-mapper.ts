/**
 * シャドーイングラグレスポンスマッパー。
 * Worker JSON → ShadowingLagResult 変換。
 * ADR-013: 閾値判定は worker 済 (recommendSlowPlayback を信頼し frontend で再判定しない)。
 */

import { ok, err, type Result } from "neverthrow";
import { type DomainError } from "../../../domain/shared";
import { type ShadowingLagResult } from "../../../usecase/port/shadowing-lag-client";
import { shadowingLagResponseSchema, type ShadowingLagResponse } from "./shadowing-schema";
import {
  assessmentEngineFailed,
  classifyHttpStatus,
  AssessmentEngineFailureKind,
} from "../shared/errors";

export const mapShadowingLagResponse = (input: {
  status: number;
  rawBody: unknown;
}): Result<ShadowingLagResult, DomainError> => {
  if (input.status !== 200) {
    const failureKind = classifyHttpStatus(input.status);
    return err(assessmentEngineFailed("oss_worker_shadowing", `HTTP ${input.status}`, failureKind));
  }

  const parsed = shadowingLagResponseSchema.safeParse(input.rawBody);
  if (!parsed.success) {
    return err(
      assessmentEngineFailed(
        "oss_worker_shadowing",
        `shadowing-lag response schema validation failed: ${parsed.error.message}`,
        AssessmentEngineFailureKind.NON_RETRYABLE,
      ),
    );
  }

  const data: ShadowingLagResponse = parsed.data;

  return ok({
    lagMilliseconds: data.lagMilliseconds,
    perSegmentLag: data.perSegmentLag.map((entry) => ({
      phoneme: entry.phoneme,
      lagMilliseconds: entry.lagMilliseconds,
    })),
    speechRateRatio: data.speechRateRatio,
    pauseCountLearner: data.pauseCountLearner,
    pauseCountReference: data.pauseCountReference,
    recommendSlowPlayback: data.recommendSlowPlayback,
    thresholdMilliseconds: data.thresholdMilliseconds,
  });
};
