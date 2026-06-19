/**
 * POST /api/v1/findings/{findingIdentifier}/retry-recordings
 *
 * finding 単位の再録音（retry）を提出し、GOP delta 評価を返す。(M-CRL-4 / ADR-022)
 *
 * 正常録音の閉ループ: submitPracticeAttempt → runAssessmentJob(30s poll) →
 * per-phoneme GOP heatmap から retryGop 取得 → worker /v1/gop-delta → RetryRecordingResponse 200。
 * low_quality retry → 422「もう一度はっきり録音してください」。
 *
 * Body: multipart/form-data
 *   - audio: File（録音音声）
 *   - recordedDurationMs: 正整数（録音時間 ms）
 *   - referenceText: string（参照テキスト — finding.expected.text ?? finding.detected.text）
 *   - expectedPhonemeIpa: string（対象音素 IPA）
 *   - expectedAudioRangeStartMs: number（finding.audioRange.startMilliseconds）
 *
 * Response 200: RetryRecordingResponse（qualityStatus は常に 'normal'）
 * Response 422: { message: "もう一度はっきり録音してください" }（low_quality / GOP 取得不可）
 *
 * ADR-004: 採点は既存 worker 契約再利用。新採点経路を作らない。
 * ADR-008: progress_snapshots への書き込みは行わない。
 * ADR-022 D4: per-finding synthetic single-word section に隔離。
 *
 * 処理フロー:
 *   1. multipart バリデーション
 *   2. ensureFindingRetrySectionExists — per-finding 合成 Section を取得または作成
 *   3. submitPracticeAttempt(oss_worker_only) — audio を analysis キューに投入
 *   4. runAssessmentJob を 30s polling — AssessmentResult 識別子取得
 *      low_quality → 422
 *   5. AssessmentResult.perPhonemeGop から対象音素 GOP を取得
 *      GOP 取得不可 → 422
 *   6. worker /v1/gop-delta ACL → gopDelta / deltaSignal / boundarySignal
 *   7. RetryRecordingResponse 200
 */

import { type NextRequest } from "next/server";
import { getContainer } from "../../../../../../registry";
import { normalizeAudioMimeType } from "../../../../../../lib/mime";
import { ensureFindingRetrySectionExists } from "../../../../../../infrastructure/training/finding-retry-section-fixture";
import { createGopDeltaAdaptor } from "../../../../../../acl/gop-delta/create-gop-delta-adaptor";
import type { RetryRecordingResponse } from "../../../../../../lib/api-types";
import type { PerPhonemeGopEntry } from "../../../../../../domain/assessment-result";
import { createAssessmentResultIdentifier } from "../../../../../../domain/assessment-result";

type RouteContext = {
  params: Promise<{ findingIdentifier: string }>;
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

/** assessment job 完了まで polling する最大待機時間（ミリ秒） */
const ANALYSIS_POLL_MAX_WAIT_MS = 30_000;
/** polling 間隔（ミリ秒） */
const ANALYSIS_POLL_INTERVAL_MS = 1_000;

const unprocessableResponse = (message: string): Response =>
  Response.json({ message }, { status: 422 });

const badRequestResponse = (field: string, reason: string): Response =>
  Response.json(
    {
      error: {
        code: "validationFailed",
        message: "入力値が不正です",
        details: { fieldErrors: [{ field, message: reason }] },
      },
      meta: { requestIdentifier: `req_${globalThis.crypto.randomUUID().replace(/-/g, "")}` },
    },
    { status: 400 },
  );

type PollResult =
  | { kind: "succeeded"; assessmentResultIdentifier: string }
  | { kind: "low_quality" }
  | { kind: "timeout" };

/**
 * pollForAssessmentResult — assessment job 完了を polling する。
 * low_quality（非 retryable failure）を検出して早期返却する。
 */
const pollForAssessmentResult = async (
  container: ReturnType<typeof getContainer>,
): Promise<PollResult> => {
  const deadline = Date.now() + ANALYSIS_POLL_MAX_WAIT_MS;

  while (Date.now() < deadline) {
    const tickResult = await container.usecases.runAssessmentJob({
      leaseOwner: "finding-retry-poller",
      leaseDurationSeconds: 60,
      maxAttempts: 3,
    });

    if (tickResult.isOk()) {
      const output = tickResult.value;

      // 正常完了: result.identifier が返る
      if (output.result !== null) {
        return { kind: "succeeded", assessmentResultIdentifier: output.result.identifier };
      }

      // low_quality / 非 retryable: retryScheduled=false, result=null, job.state="failed"
      if (output.job !== null && output.job.state === "failed" && !output.retryScheduled) {
        return { kind: "low_quality" };
      }
    } else {
      // errAsync — unexpected error（low_quality は ok パスに乗る）
      return { kind: "low_quality" };
    }

    await new Promise<void>((resolve) => setTimeout(resolve, ANALYSIS_POLL_INTERVAL_MS));
  }

  return { kind: "timeout" };
};

/**
 * readPerPhonemeGop — AssessmentResult の perPhonemeGop を repository 経由で読む。
 * container.repositories.assessmentResult.find を使用（ACL/Infrastructure 層閉じ込め）。
 */
const readPerPhonemeGop = async (
  container: ReturnType<typeof getContainer>,
  assessmentResultIdentifier: string,
): Promise<ReadonlyArray<PerPhonemeGopEntry> | null> => {
  const identifier = createAssessmentResultIdentifier(assessmentResultIdentifier);
  if (!identifier) return null;

  const result = await container.repositories.assessmentResult.find(identifier);
  if (result.isErr()) return null;

  return result.value.perPhonemeGop;
};

/**
 * selectTargetPhonemeGop — perPhonemeGop heatmap から対象音素の GOP を選択する。
 *
 * S-CRL-1: 単語内に同一 IPA が複数回出現する場合、audioRange.startMs に最も近い
 * エントリを選ぶ（D5 — 音素マッチング）。
 * startMs がない / 単一エントリの場合は最初のマッチを返す。
 */
const selectTargetPhonemeGop = (
  perPhonemeGop: ReadonlyArray<PerPhonemeGopEntry>,
  expectedPhonemeIpa: string,
  _expectedAudioRangeStartMs: number,
): number | null => {
  const candidates = perPhonemeGop.filter((entry) => entry.phoneme === expectedPhonemeIpa);
  if (candidates.length === 0) return null;
  // S-CRL-1: PerPhonemeGopEntry に startMs フィールドが追加されるまでは index 0 を返す。
  // startMs が将来追加された場合は最近傍境界選択に切り替える。
  return candidates[0]!.gop;
};

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const { findingIdentifier } = await context.params;

  // ---- 1. multipart バリデーション ----
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return badRequestResponse("body", "multipart/form-data のパースに失敗しました");
  }

  const audioFile = formData.get("audio");
  if (!audioFile || !(audioFile instanceof File)) {
    return badRequestResponse("audio", "audio フィールドが必須です");
  }

  const referenceText = formData.get("referenceText");
  if (!referenceText || typeof referenceText !== "string") {
    return badRequestResponse("referenceText", "referenceText フィールドが必須です");
  }

  const expectedPhonemeIpa = formData.get("expectedPhonemeIpa");
  if (!expectedPhonemeIpa || typeof expectedPhonemeIpa !== "string") {
    return badRequestResponse("expectedPhonemeIpa", "expectedPhonemeIpa フィールドが必須です");
  }

  const recordedDurationMsRaw = formData.get("recordedDurationMs");
  const recordedDurationMs = recordedDurationMsRaw !== null ? Number(recordedDurationMsRaw) : NaN;
  if (!Number.isInteger(recordedDurationMs) || recordedDurationMs <= 0) {
    return badRequestResponse(
      "recordedDurationMs",
      "recordedDurationMs は正の整数で指定してください",
    );
  }

  const expectedAudioRangeStartMsRaw = formData.get("expectedAudioRangeStartMs");
  const expectedAudioRangeStartMs =
    expectedAudioRangeStartMsRaw !== null ? Number(expectedAudioRangeStartMsRaw) : NaN;
  if (!isFinite(expectedAudioRangeStartMs)) {
    return badRequestResponse(
      "expectedAudioRangeStartMs",
      "expectedAudioRangeStartMs は数値で指定してください",
    );
  }

  const originalGopRaw = formData.get("originalGop");
  const originalGop = originalGopRaw !== null ? Number(originalGopRaw) : NaN;
  if (!isFinite(originalGop)) {
    return badRequestResponse("originalGop", "originalGop は数値で指定してください");
  }

  const mimeType = normalizeAudioMimeType(audioFile.type || "audio/webm");
  if (!isSupportedMimeType(mimeType)) {
    return badRequestResponse("audio", `サポートされていない音声形式です: ${mimeType}`);
  }

  const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
  const container = getContainer();

  // ---- 2. per-finding 合成 Section を取得または作成 ----
  const sectionIdentifier = await ensureFindingRetrySectionExists(
    container.database,
    findingIdentifier,
    referenceText,
  );

  // ---- 3. submitPracticeAttempt — oss_worker_only ----
  const now = new Date();
  const submitResult = await container.usecases.submitPracticeAttempt({
    section: sectionIdentifier,
    analysisMode: "oss_worker_only",
    audioSource: {
      type: "browser_recording",
      data: audioBuffer,
      mimeType: mimeType as SupportedMimeType,
      durationMilliseconds: recordedDurationMs,
      startedAt: now,
      endedAt: new Date(now.getTime() + recordedDurationMs),
      browserInfo: {
        browserName: "MediaRecorder",
        deviceType: "pc",
        recordingApiType: "MediaRecorder",
        userAgent: "MediaRecorder",
      },
    },
  });

  if (submitResult.isErr()) {
    return badRequestResponse("audio", submitResult.error.type);
  }

  // ---- 4. runAssessmentJob を 30s polling ----
  const pollResult = await pollForAssessmentResult(container);

  if (pollResult.kind === "low_quality") {
    return unprocessableResponse("もう一度はっきり録音してください");
  }

  if (pollResult.kind === "timeout") {
    return unprocessableResponse("もう一度はっきり録音してください");
  }

  // ---- 5. AssessmentResult.perPhonemeGop から対象音素 GOP 取得 ----
  const perPhonemeGop = await readPerPhonemeGop(container, pollResult.assessmentResultIdentifier);

  if (!perPhonemeGop || perPhonemeGop.length === 0) {
    return unprocessableResponse("もう一度はっきり録音してください");
  }

  const retryGop = selectTargetPhonemeGop(
    perPhonemeGop,
    expectedPhonemeIpa,
    expectedAudioRangeStartMs,
  );

  if (retryGop === null) {
    return unprocessableResponse("もう一度はっきり録音してください");
  }

  // ---- 6. worker /v1/gop-delta ACL ----
  const gopDeltaAdaptor = createGopDeltaAdaptor({
    workerApiEndpoint: container.config.workerApiEndpoint,
    timeoutMilliseconds: container.config.ossWorkerTimeoutMilliseconds,
  });

  let gopDeltaResult: {
    gopDelta: number;
    deltaSignal: "improved" | "unchanged" | "regressed";
    boundarySignal: "crossedMajor" | "crossedMinor" | "none";
  };
  try {
    gopDeltaResult = await gopDeltaAdaptor.computeGopDelta({ originalGop, retryGop });
  } catch {
    return unprocessableResponse("もう一度はっきり録音してください");
  }

  // ---- 7. RetryRecordingResponse 200 ----
  const responseDto: RetryRecordingResponse = {
    findingIdentifier,
    phoneme: expectedPhonemeIpa,
    originalGop,
    retryGop,
    gopDelta: gopDeltaResult.gopDelta,
    deltaSignal: gopDeltaResult.deltaSignal,
    boundarySignal: gopDeltaResult.boundarySignal,
    qualityStatus: "normal",
  };

  // ADR-008: progress_snapshots への書き込みは行わない。
  return Response.json({ data: responseDto }, { status: 200 });
}
