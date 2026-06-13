/**
 * POST /api/v1/training/drills/{trainingSessionIdentifier}/attempts
 *
 * ドリル録音を提出し、target 音素に絞った即時評価を返す。(REQ-123 / M-TR-4)
 *
 * 録音は既存 recording→analysis パス（submitPracticeAttempt + runAssessmentJob）で
 * 採点し、AssessmentResult を取得してから target 音素に絞って即時 verdict を返す。
 *
 * Body: multipart/form-data
 *   - audio: File（録音音声）
 *   - audioSource: "browser_recording"
 *   - catalogId: string（ドリル対立の catalogId）
 *   - exampleSentence: string（例文テキスト、Section body_text として使用）
 *   - producedWord: string（産出したミニマルペア語）
 *   - expectedWord: string（期待する正解語）
 *   - recordedDurationMs: number
 *   - startedAt: ISO 8601
 *   - endedAt: ISO 8601
 *   - browserInfo: JSON
 *
 * Response: 201 Created { data: DrillVerdictDto }
 *
 * ADR-004: 採点は既存 worker 契約再利用。新採点経路を作らない。
 * ADR-007: Training Context は識別符のみで他 BC を参照。
 *
 * 処理フロー:
 *   1. audio を submitPracticeAttempt usecase 経由で analysis キューに投入（既存パス）
 *   2. runAssessmentJob を polling して analysis 完了 → AssessmentResult 識別子取得
 *   3. submitDrillAttempt usecase で target 音素評価→verdict→HvptTrial 永続化
 *   4. verdict 即時返却
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { getContainer } from "../../../../../../../registry";
import { successResponse } from "../../../../_shared/response";
import { domainErrorToResponse } from "../../../../_shared/errors";
import { normalizeAudioMimeType } from "../../../../../../../lib/mime";
import { ensureDrillSectionExists } from "../../../../../../../infrastructure/training/drill-section-fixture";
import type { DrillVerdictDto } from "../../../../../../../lib/api-types";

type RouteContext = {
  params: Promise<{ trainingSessionIdentifier: string }>;
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

/** assessment job 完了まで polling する最大待機時間（ミリ秒） */
const ANALYSIS_POLL_MAX_WAIT_MS = 30_000;
/** polling 間隔（ミリ秒） */
const ANALYSIS_POLL_INTERVAL_MS = 1_000;

/**
 * waitForAssessmentResult — analysis job の完了を polling して AssessmentResult 識別子を取得する。
 * 既存の runAssessmentJob usecase を再利用（ADR-004）。
 * result.identifier が返ったら完了。
 */
const waitForAssessmentResult = async (
  container: ReturnType<typeof getContainer>,
): Promise<string | null> => {
  const deadline = Date.now() + ANALYSIS_POLL_MAX_WAIT_MS;

  while (Date.now() < deadline) {
    const tickResult = await container.usecases.runAssessmentJob({
      leaseOwner: "drill-attempt-poller",
      leaseDurationSeconds: 60,
      maxAttempts: 3,
    });

    if (tickResult.isOk() && tickResult.value.result !== null) {
      return tickResult.value.result.identifier;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, ANALYSIS_POLL_INTERVAL_MS));
  }

  return null;
};

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const { trainingSessionIdentifier } = await context.params;

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

  const catalogIdValue = formData.get("catalogId");
  if (!catalogIdValue || typeof catalogIdValue !== "string") {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "catalogId",
      reason: "catalogId フィールドが必須です",
    });
  }

  const exampleSentence = formData.get("exampleSentence");
  if (!exampleSentence || typeof exampleSentence !== "string") {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "exampleSentence",
      reason: "exampleSentence フィールドが必須です",
    });
  }

  const producedWord = formData.get("producedWord");
  if (!producedWord || typeof producedWord !== "string") {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "producedWord",
      reason: "producedWord フィールドが必須です",
    });
  }

  const expectedWord = formData.get("expectedWord");
  if (!expectedWord || typeof expectedWord !== "string") {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "expectedWord",
      reason: "expectedWord フィールドが必須です",
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

  // ドリル例文専用 Section を取得または作成（診断パターンと同じ）
  // ADR-007: Training Context は Section 識別子のみで参照
  const sectionIdentifier = await ensureDrillSectionExists(
    container.database,
    trainingSessionIdentifier,
    exampleSentence,
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

    // Step 1: 既存 recording→analysis パスで録音を投入する（ADR-004）
    const submitResult = await container.usecases.submitPracticeAttempt({
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

    if (submitResult.isErr()) {
      return domainErrorToResponse(submitResult.error);
    }

    // Step 2: analysis job 完了を polling して AssessmentResult 識別子を取得する
    const assessmentResultIdentifier = await waitForAssessmentResult(container);

    if (!assessmentResultIdentifier) {
      return domainErrorToResponse({
        type: "persistenceFailed",
        reason: "産出ドリル採点がタイムアウトしました（30秒以内に完了しませんでした）",
      });
    }

    // Step 3: submitDrillAttempt usecase で target 音素評価→verdict→HvptTrial 永続化
    const drillAttemptResult = await container.usecases.submitDrillAttempt({
      trainingSessionIdentifier,
      assessmentResultIdentifier,
      catalogId: catalogIdValue,
      producedWord: String(producedWord),
      expectedWord: String(expectedWord),
      reactionTimeMilliseconds: recordedDurationMs,
      presentedAt: startedAt,
      scoringConfig: {
        gopSuccessThreshold: container.config.drillGopSuccessThreshold,
        maxSeverityForSuccess: container.config.drillMaxSeverityForSuccess,
      },
    });

    if (drillAttemptResult.isErr()) {
      return domainErrorToResponse(drillAttemptResult.error);
    }

    const output = drillAttemptResult.value;

    const responseDto: DrillVerdictDto = {
      verdict: output.verdict,
      hvptTrialIdentifier: output.hvptTrialIdentifier,
      targetPhonemeEvaluations: output.targetPhonemeEvaluations.map((evaluation) => ({
        targetPhonemeIpa: evaluation.targetPhonemeIpa,
        gop: evaluation.gop,
        nBest: evaluation.nBest ? [...evaluation.nBest] : null,
        severity: evaluation.severity,
      })),
      verdictReasonJa: output.verdictReasonJa,
    };

    return successResponse(responseDto, 201);
  }

  return domainErrorToResponse({
    type: "validationFailed",
    field: "audioSource",
    reason: "audioSource は browser_recording を指定してください",
  });
}
