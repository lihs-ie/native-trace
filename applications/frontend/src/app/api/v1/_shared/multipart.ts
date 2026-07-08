/**
 * multipart/form-data 検証の共通ヘルパー
 *
 * browser_recording 録音投稿 4 route（practice-attempts / diagnostic recording-attempts /
 * retry-recordings / drill attempts）で重複していた MIME 集合・browser_recording 検証・
 * recordedDurationMs 検証を集約する（W30, docs/plans/2026-07-04-refactoring-plan.md）。
 *
 * エラー応答の status / code / message は route ごとに現行値を完全維持する契約
 * （§4.1 全面禁止リスト 3）のため、ここでは field/reason のみを返し、
 * HTTP envelope への変換は呼び出し元（domainErrorToResponse 等）に委ねる。
 */

import { z } from "zod";
import { type Result, ok, err } from "../../../../domain/shared";
import { SUPPORTED_AUDIO_MIME_TYPES } from "../../../../domain/audio-file";
import { zodErrorToValidationFailed } from "./validation";

export { SUPPORTED_AUDIO_MIME_TYPES };

export type SupportedAudioMimeType = (typeof SUPPORTED_AUDIO_MIME_TYPES)[number];

export const isSupportedAudioMimeType = (value: string): value is SupportedAudioMimeType =>
  (SUPPORTED_AUDIO_MIME_TYPES as ReadonlyArray<string>).includes(value);

export type MultipartFieldError = Readonly<{ field: string; reason: string }>;

const browserInfoSchema = z.object({
  browserName: z.string().min(1),
  browserVersion: z.string().optional(),
  deviceType: z.string().optional(),
});

export type ParsedBrowserRecordingForm = Readonly<{
  startedAt: Date;
  endedAt: Date;
  browserInfo: Readonly<{
    browserName: string;
    deviceType: "mobile" | "pc";
    recordingApiType: "MediaRecorder";
    userAgent: string;
  }>;
}>;

/**
 * parseBrowserRecordingForm — browser_recording multipart（startedAt / endedAt / browserInfo）を検証する。
 * 4 route中 3 route（practice-attempts / recording-attempts / drill attempts）で
 * 文字単位で重複していたロジック。retry-recordings は browser_recording ブロックを持たないため対象外。
 */
export const parseBrowserRecordingForm = (
  formData: FormData,
): Result<ParsedBrowserRecordingForm, MultipartFieldError> => {
  const startedAtRaw = formData.get("startedAt");
  const endedAtRaw = formData.get("endedAt");
  const browserInfoRaw = formData.get("browserInfo");

  if (!startedAtRaw || typeof startedAtRaw !== "string") {
    return err({ field: "startedAt", reason: "browser_recording では startedAt が必須です" });
  }
  if (!endedAtRaw || typeof endedAtRaw !== "string") {
    return err({ field: "endedAt", reason: "browser_recording では endedAt が必須です" });
  }
  if (!browserInfoRaw || typeof browserInfoRaw !== "string") {
    return err({ field: "browserInfo", reason: "browser_recording では browserInfo が必須です" });
  }

  let browserInfoParsed: unknown;
  try {
    browserInfoParsed = JSON.parse(browserInfoRaw);
  } catch {
    return err({ field: "browserInfo", reason: "browserInfo は JSON 文字列で指定してください" });
  }

  const browserInfoResult = browserInfoSchema.safeParse(browserInfoParsed);
  if (!browserInfoResult.success) {
    const { field, reason } = zodErrorToValidationFailed(browserInfoResult.error, "browserInfo");
    return err({ field, reason });
  }

  const startedAt = new Date(startedAtRaw);
  const endedAt = new Date(endedAtRaw);
  if (isNaN(startedAt.getTime()) || isNaN(endedAt.getTime())) {
    return err({
      field: "startedAt",
      reason: "startedAt / endedAt は ISO 8601 形式で指定してください",
    });
  }

  return ok({
    startedAt,
    endedAt,
    browserInfo: {
      browserName: browserInfoResult.data.browserName,
      deviceType: browserInfoResult.data.deviceType === "mobile" ? "mobile" : "pc",
      recordingApiType: "MediaRecorder",
      userAgent: browserInfoResult.data.browserVersion ?? browserInfoResult.data.browserName,
    },
  });
};

/**
 * parseRecordedDurationMilliseconds — recordedDurationMs multipart フィールドを検証する。
 * 4 route 共通ロジック。エラー文言は practice-attempts のみ「（最大10分）」suffix があるため、
 * reason を引数で上書き可能にし、他 3 route はデフォルト文言を使う。
 */
export const parseRecordedDurationMilliseconds = (
  formData: FormData,
  reason: string = "recordedDurationMs は正の整数で指定してください",
): Result<number, MultipartFieldError> => {
  const raw = formData.get("recordedDurationMs");
  const value = raw !== null ? Number(raw) : NaN;
  if (!Number.isInteger(value) || value <= 0) {
    return err({ field: "recordedDurationMs", reason });
  }
  return ok(value);
};
