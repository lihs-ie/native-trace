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

type RouteContext = { params: Promise<{ sectionIdentifier: string }> };

const SUPPORTED_MIME_TYPES = [
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
] as const;

type SupportedMimeType = (typeof SUPPORTED_MIME_TYPES)[number];

const isSupportedMimeType = (value: string): value is SupportedMimeType =>
  (SUPPORTED_MIME_TYPES as ReadonlyArray<string>).includes(value);

const analysisModeSchema = z.enum(["cloudOnly", "ossWorkerOnly", "comparison"]);

// FormData フィールドから analysisMode を UseCase enum へ変換
const toUseCaseAnalysisMode = (
  mode: string,
): "cloud_only" | "oss_worker_only" | "comparison" | null => {
  switch (mode) {
    case "cloudOnly":
      return "cloud_only";
    case "ossWorkerOnly":
      return "oss_worker_only";
    case "comparison":
      return "comparison";
    default:
      return null;
  }
};

const browserInfoSchema = z.object({
  browserName: z.string().min(1),
  browserVersion: z.string().optional(),
  deviceType: z.string().optional(),
});

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
  if (!useCaseAnalysisMode) {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "analysisMode",
      reason: "analysisMode の変換に失敗しました",
    });
  }

  const recordedDurationMsRaw = formData.get("recordedDurationMs");
  const recordedDurationMs = recordedDurationMsRaw !== null ? Number(recordedDurationMsRaw) : NaN;
  if (!Number.isInteger(recordedDurationMs) || recordedDurationMs <= 0) {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "recordedDurationMs",
      reason: "recordedDurationMs は正の整数で指定してください（最大10分）",
    });
  }

  const mimeType = normalizeAudioMimeType(audioFile.type || "audio/webm");
  if (!isSupportedMimeType(mimeType)) {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "audio",
      reason: `サポートされていない音声形式です: ${mimeType}`,
    });
  }

  const audioBuffer = Buffer.from(await audioFile.arrayBuffer());

  const container = getContainer();

  if (audioSourceType === "browser_recording") {
    const startedAtRaw = formData.get("startedAt");
    const endedAtRaw = formData.get("endedAt");
    const browserInfoRaw = formData.get("browserInfo");

    if (!startedAtRaw || typeof startedAtRaw !== "string") {
      return domainErrorToResponse({
        type: "validationFailed",
        field: "startedAt",
        reason: "browser_recording では startedAt が必須です",
      });
    }
    if (!endedAtRaw || typeof endedAtRaw !== "string") {
      return domainErrorToResponse({
        type: "validationFailed",
        field: "endedAt",
        reason: "browser_recording では endedAt が必須です",
      });
    }
    if (!browserInfoRaw || typeof browserInfoRaw !== "string") {
      return domainErrorToResponse({
        type: "validationFailed",
        field: "browserInfo",
        reason: "browser_recording では browserInfo が必須です",
      });
    }

    let browserInfoParsed: unknown;
    try {
      browserInfoParsed = JSON.parse(browserInfoRaw);
    } catch {
      return domainErrorToResponse({
        type: "validationFailed",
        field: "browserInfo",
        reason: "browserInfo は JSON 文字列で指定してください",
      });
    }

    const browserInfoResult = browserInfoSchema.safeParse(browserInfoParsed);
    if (!browserInfoResult.success) {
      return domainErrorToResponse({
        type: "validationFailed",
        field: "browserInfo",
        reason: browserInfoResult.error.errors.map((e) => e.message).join(", "),
      });
    }

    const startedAt = new Date(startedAtRaw);
    const endedAt = new Date(endedAtRaw);
    if (isNaN(startedAt.getTime()) || isNaN(endedAt.getTime())) {
      return domainErrorToResponse({
        type: "validationFailed",
        field: "startedAt",
        reason: "startedAt / endedAt は ISO 8601 形式で指定してください",
      });
    }

    const result = await container.usecases.submitPracticeAttempt({
      section: sectionIdentifier,
      analysisMode: useCaseAnalysisMode,
      audioSource: {
        type: "browser_recording",
        data: audioBuffer,
        mimeType: mimeType as SupportedMimeType,
        durationMilliseconds: recordedDurationMs,
        startedAt,
        endedAt,
        browserInfo: {
          browserName: browserInfoResult.data.browserName,
          deviceType: browserInfoResult.data.deviceType === "mobile" ? "mobile" : "pc",
          recordingApiType: "MediaRecorder",
          userAgent: browserInfoResult.data.browserVersion ?? browserInfoResult.data.browserName,
        },
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
        mimeType: mimeType as SupportedMimeType,
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
