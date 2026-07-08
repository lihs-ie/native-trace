/**
 * API-010: POST /api/v1/sections/{sectionIdentifier}/practice-attempts — 録音投稿と解析開始
 * Content-Type: multipart/form-data
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { getContainer } from "../../../../../../registry";
import { successResponse } from "../../../_shared/response";
import { domainErrorToResponse } from "../../../_shared/errors";
import { normalizeAudioMimeType } from "../../../../../../lib/mime";
import {
  isSupportedAudioMimeType,
  type SupportedAudioMimeType,
  parseBrowserRecordingForm,
  parseRecordedDurationMilliseconds,
} from "../../../_shared/multipart";

type RouteContext = { params: Promise<{ sectionIdentifier: string }> };

const analysisModeSchema = z.enum(["cloudOnly", "ossWorkerOnly", "comparison"]);

// FormData フィールドから analysisMode を UseCase enum へ変換
const toUseCaseAnalysisMode = (
  mode: "cloudOnly" | "ossWorkerOnly" | "comparison",
): "cloud_only" | "oss_worker_only" | "comparison" => {
  switch (mode) {
    case "cloudOnly":
      return "cloud_only";
    case "ossWorkerOnly":
      return "oss_worker_only";
    case "comparison":
      return "comparison";
  }
};

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const { sectionIdentifier } = await context.params;

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

  const audioFile = formData.get("audio");
  if (!audioFile || !(audioFile instanceof File)) {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "audio",
      reason: "audio フィールドが必須です",
    });
  }

  const audioSourceType = formData.get("audioSource");
  if (!audioSourceType || typeof audioSourceType !== "string") {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "audioSource",
      reason: "audioSource フィールドが必須です",
    });
  }

  const analysisModeRaw = formData.get("analysisMode");
  if (!analysisModeRaw || typeof analysisModeRaw !== "string") {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "analysisMode",
      reason: "analysisMode フィールドが必須です",
    });
  }

  const analysisModeParseResult = analysisModeSchema.safeParse(analysisModeRaw);
  if (!analysisModeParseResult.success) {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "analysisMode",
      reason: "analysisMode は cloudOnly / ossWorkerOnly / comparison のいずれかを指定してください",
    });
  }

  const useCaseAnalysisMode = toUseCaseAnalysisMode(analysisModeParseResult.data);

  const recordedDurationMsResult = parseRecordedDurationMilliseconds(
    formData,
    "recordedDurationMs は正の整数で指定してください（最大10分）",
  );
  if (recordedDurationMsResult.isErr()) {
    return domainErrorToResponse({
      type: "validationFailed",
      field: recordedDurationMsResult.error.field,
      reason: recordedDurationMsResult.error.reason,
    });
  }
  const recordedDurationMs = recordedDurationMsResult.value;

  const mimeType = normalizeAudioMimeType(audioFile.type || "audio/webm");
  if (!isSupportedAudioMimeType(mimeType)) {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "audio",
      reason: `サポートされていない音声形式です: ${mimeType}`,
    });
  }

  const audioBuffer = Buffer.from(await audioFile.arrayBuffer());

  const container = getContainer();

  if (audioSourceType === "browser_recording") {
    const browserRecordingFormResult = parseBrowserRecordingForm(formData);
    if (browserRecordingFormResult.isErr()) {
      return domainErrorToResponse({
        type: "validationFailed",
        field: browserRecordingFormResult.error.field,
        reason: browserRecordingFormResult.error.reason,
      });
    }
    const { startedAt, endedAt, browserEnvironment } = browserRecordingFormResult.value;

    const result = await container.usecases.submitPracticeAttempt({
      section: sectionIdentifier,
      analysisMode: useCaseAnalysisMode,
      audioSource: {
        type: "browser_recording",
        data: audioBuffer,
        mimeType: mimeType as SupportedAudioMimeType,
        durationMilliseconds: recordedDurationMs,
        startedAt,
        endedAt,
        browserEnvironment,
      },
    });

    if (result.isErr()) {
      return domainErrorToResponse(result.error);
    }

    return buildSubmitResponse(result.value);
  }

  if (audioSourceType === "uploaded_file") {
    const originalFileName = formData.get("originalFileName");
    if (!originalFileName || typeof originalFileName !== "string") {
      return domainErrorToResponse({
        type: "validationFailed",
        field: "originalFileName",
        reason: "uploaded_file では originalFileName が必須です",
      });
    }

    const result = await container.usecases.submitPracticeAttempt({
      section: sectionIdentifier,
      analysisMode: useCaseAnalysisMode,
      audioSource: {
        type: "uploaded_file",
        data: audioBuffer,
        mimeType: mimeType as SupportedAudioMimeType,
        durationMilliseconds: recordedDurationMs,
        originalFileName,
      },
    });

    if (result.isErr()) {
      return domainErrorToResponse(result.error);
    }

    return buildSubmitResponse(result.value);
  }

  return domainErrorToResponse({
    type: "validationFailed",
    field: "audioSource",
    reason: "audioSource は browser_recording または uploaded_file を指定してください",
  });
}

import type { SubmitPracticeAttemptOutput } from "../../../../../../usecase/submit-practice-attempt/index";

const buildSubmitResponse = (output: SubmitPracticeAttemptOutput): Response => {
  return successResponse(
    {
      recordingAttempt: {
        identifier: output.recordingAttempt.identifier,
        section: null,
        status: output.recordingAttempt.state,
        recordedDurationMs: output.audioFile.durationMilliseconds,
        createdAt: output.recordingAttempt.createdAt,
      },
      analysisRun: {
        identifier: output.analysisRun.identifier,
        recordingAttempt: output.recordingAttempt.identifier,
        status: "queued",
        createdAt: output.analysisRun.createdAt,
      },
      analysisJobs: output.analysisJobs.map((job) => ({
        identifier: job.identifier,
        analysisRun: output.analysisRun.identifier,
        engine: job.engine,
        status: job.state,
        attemptCount: 0,
      })),
    },
    202,
  );
};
