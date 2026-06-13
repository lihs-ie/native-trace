/**
 * ShadowingLagDto — OSS Worker `POST /v1/pronunciation-assessments/shadowing` レスポンス Zod スキーマ。
 * ADR-013: DTW over phoneme boundaries。閾値判定は worker 済。
 * worker 契約 (確定): { lagMilliseconds, perSegmentLag, speechRateRatio, pauseCountLearner,
 *                       pauseCountReference, recommendSlowPlayback, thresholdMilliseconds }
 */

import { z } from "zod";

const perSegmentLagEntrySchema = z.object({
  phoneme: z.string(),
  lagMilliseconds: z.number(),
});

export const shadowingLagResponseSchema = z.object({
  lagMilliseconds: z.number(),
  perSegmentLag: z.array(perSegmentLagEntrySchema),
  speechRateRatio: z.number().nullable(),
  pauseCountLearner: z.number().nullable(),
  pauseCountReference: z.number().nullable(),
  recommendSlowPlayback: z.boolean(),
  thresholdMilliseconds: z.number(),
});

export type ShadowingLagResponse = z.infer<typeof shadowingLagResponseSchema>;
