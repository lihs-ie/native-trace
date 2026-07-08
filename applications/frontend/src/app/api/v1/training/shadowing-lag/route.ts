/**
 * POST /api/v1/training/shadowing-lag
 *
 * シャドーイングセッションのラグ計測と training_sessions 永続。(REQ-125 / M-SHL-4/5/6)
 *
 * Body: multipart/form-data
 *   - reference_audio: Blob (Kokoro TTS お手本音声)
 *   - learner_audio: Blob (マイク録音)
 *   - reference_text: string
 *   - contrast: string (音素対立 — 診断なしの場合は "general")
 *   - duration_minutes: number
 *   - duration_milliseconds: number
 *
 * Response: 200 OK { data: ShadowingLagResultDto }
 *
 * ADR-013: worker /v1/pronunciation-assessments/shadowing へ中継。
 * M-SHL-5: 完了時 training_sessions に kind='shadowing', session_accuracy=null を永続。
 * M-SHL-6: recommendSlowPlayback は worker 判定済み (frontend で再判定しない)。
 */

import { type NextRequest } from "next/server";
import { getContainer } from "../../../../../registry";
import { successResponse } from "../../_shared/response";
import { domainErrorToResponse } from "../../_shared/errors";
import { createLearnerIdentifier } from "../../../../../domain/training";
import type { ShadowingLagResultDto } from "../../../../../lib/api-types";

export async function POST(request: NextRequest): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "body",
      reason: "multipart/form-data のパースに失敗しました",
    });
  }

  const referenceText = formData.get("reference_text");
  if (typeof referenceText !== "string" || referenceText.trim() === "") {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "reference_text",
      reason: "reference_text は必須です",
    });
  }

  const contrast = formData.get("contrast");
  if (typeof contrast !== "string" || contrast.trim() === "") {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "contrast",
      reason: "contrast は必須です",
    });
  }

  const durationMinutesRaw = formData.get("duration_minutes");
  const durationMinutes = durationMinutesRaw !== null ? Number(durationMinutesRaw) : NaN;
  if (!Number.isFinite(durationMinutes) || durationMinutes < 1) {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "duration_minutes",
      reason: "duration_minutes は 1 以上の数値が必要です",
    });
  }

  const durationMillisecondsRaw = formData.get("duration_milliseconds");
  const durationMilliseconds =
    durationMillisecondsRaw !== null ? Number(durationMillisecondsRaw) : NaN;
  if (!Number.isFinite(durationMilliseconds) || durationMilliseconds < 0) {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "duration_milliseconds",
      reason: "duration_milliseconds は 0 以上の数値が必要です",
    });
  }

  const referenceAudioEntry = formData.get("reference_audio");
  if (!(referenceAudioEntry instanceof Blob)) {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "reference_audio",
      reason: "reference_audio は必須です",
    });
  }

  const learnerAudioEntry = formData.get("learner_audio");
  if (!(learnerAudioEntry instanceof Blob)) {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "learner_audio",
      reason: "learner_audio は必須です",
    });
  }

  const referenceAudioBuffer = await referenceAudioEntry.arrayBuffer();
  const learnerAudioBuffer = await learnerAudioEntry.arrayBuffer();

  const referenceAudioBytes = new Uint8Array(referenceAudioBuffer);
  const learnerAudioBytes = new Uint8Array(learnerAudioBuffer);

  const container = getContainer();

  const result = await container.usecases.computeShadowingLag({
    learnerIdentifier: container.config.diagnosticSentinelLearnerIdentifier,
    contrast,
    referenceAudioBytes,
    referenceAudioMimeType: referenceAudioEntry.type || "audio/wav",
    learnerAudioBytes,
    learnerAudioMimeType: learnerAudioEntry.type || "audio/webm",
    referenceText,
    durationMilliseconds,
    durationMinutes: Math.min(30, Math.max(1, Math.floor(durationMinutes))),
    schedulerConfig: {
      spacingIntervalHours: container.config.spacingIntervalHours,
      masteryGateThreshold: container.config.masteryGateThreshold,
      sessionCutoffMinutesMax: container.config.sessionCutoffMinutesMax,
      sessionCutoffMinutesMin: container.config.sessionCutoffMinutesMin,
      gateRetryIntervalHours: container.config.gateRetryIntervalHours,
    },
  });

  if (result.isErr()) {
    return domainErrorToResponse(result.error);
  }

  const output = result.value;

  // 週次実施回数 (M-SHL-4 .scope-note): 過去7日間の shadowing completed 件数
  const learnerIdentifier = createLearnerIdentifier(
    container.config.diagnosticSentinelLearnerIdentifier,
  );
  let weeklySessionCount = 0;
  if (learnerIdentifier) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const countResult = await container.repositories.trainingSession.countByLearnerAndKindSince(
      learnerIdentifier,
      "shadowing",
      sevenDaysAgo,
    );
    if (countResult.isOk()) {
      weeklySessionCount = countResult.value;
    }
  }

  const responseDto: ShadowingLagResultDto = {
    trainingSessionIdentifier: output.trainingSessionIdentifier,
    lagMilliseconds: output.lagMilliseconds,
    perSegmentLag: output.perSegmentLag.map((entry) => ({
      phoneme: entry.phoneme,
      lagMilliseconds: entry.lagMilliseconds,
    })),
    speechRateRatio: output.speechRateRatio,
    pauseCountLearner: output.pauseCountLearner,
    pauseCountReference: output.pauseCountReference,
    recommendSlowPlayback: output.recommendSlowPlayback,
    thresholdMilliseconds: output.thresholdMilliseconds,
    weeklySessionCount,
  };

  return successResponse(responseDto, 200);
}
