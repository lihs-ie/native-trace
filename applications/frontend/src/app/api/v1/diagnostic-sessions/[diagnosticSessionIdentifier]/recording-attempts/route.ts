/**
 * POST /api/v1/diagnostic-sessions/{diagnosticSessionIdentifier}/recording-attempts
 *
 * 診断プロンプトの録音を投稿し、解析を開始する。
 * M-DG-2: 既存の recording → analysis パス（worker/analyzer 契約）を再利用する。
 *
 * ADR-004: 診断専用の新採点エンドポイントを作らない。
 *          submitPracticeAttempt を診断専用 Section 経由で呼び出す。
 * OQ-2: 診断プロンプトは診断専用 fixture Section として PPC に存在する。
 *
 * Body: multipart/form-data
 *   - audio: File（録音音声）
 *   - audioSource: "browser_recording"
 *   - promptIdentifier: string（DiagnosticPrompt.identifier）
 *   - promptText: string（Section body_text として使用）
 *   - recordedDurationMs: number
 *   - startedAt: ISO 8601
 *   - endedAt: ISO 8601
 *   - browserInfo: JSON
 *
 * レスポンス: 202 Accepted { data: { recordingAttempt, analysisRun, analysisJobs } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { getContainer } from "../../../../../../registry";
import { successResponse } from "../../../_shared/response";
import { domainErrorToResponse } from "../../../_shared/errors";
import { normalizeAudioMimeType } from "../../../../../../lib/mime";
import { ensureDiagnosticSectionExists } from "../../../../../../infrastructure/training/diagnostic-section-fixture";

type RouteContext = {
  params: Promise<{ diagnosticSessionIdentifier: string }>;
};

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

const browserInfoSchema = z.object({
  browserName: z.string().min(1),
  browserVersion: z.string().optional(),
  deviceType: z.string().optional(),
});

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const { diagnosticSessionIdentifier: _diagnosticSessionIdentifier } = await context.params;

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

  const promptIdentifier = formData.get("promptIdentifier");
  if (!promptIdentifier || typeof promptIdentifier !== "string") {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "promptIdentifier",
      reason: "promptIdentifier フィールドが必須です",
    });
  }

  const promptText = formData.get("promptText");
  if (!promptText || typeof promptText !== "string") {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "promptText",
      reason: "promptText フィールドが必須です",
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

  const recordedDurationMsRaw = formData.get("recordedDurationMs");
  const recordedDurationMs =
    recordedDurationMsRaw !== null ? Number(recordedDurationMsRaw) : NaN;
  if (!Number.isInteger(recordedDurationMs) || recordedDurationMs <= 0) {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "recordedDurationMs",
      reason: "recordedDurationMs は正の整数で指定してください",
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

  // 診断プロンプト専用 Section を取得または作成
  // ADR-007: Training Context は Section 識別子のみで参照
  const sectionIdentifier = await ensureDiagnosticSectionExists(
    container.database,
    promptIdentifier,
    promptText,
  );

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
      analysisMode: "oss_worker_only",
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
          userAgent:
            browserInfoResult.data.browserVersion ?? browserInfoResult.data.browserName,
        },
      },
    });

    if (result.isErr()) {
      return domainErrorToResponse(result.error);
    }

    const output = result.value;
    return successResponse(
      {
        recordingAttempt: {
          identifier: output.recordingAttempt.identifier,
          section: sectionIdentifier,
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
  }

  return domainErrorToResponse({
    type: "validationFailed",
    field: "audioSource",
    reason: "audioSource は browser_recording を指定してください",
  });
}
