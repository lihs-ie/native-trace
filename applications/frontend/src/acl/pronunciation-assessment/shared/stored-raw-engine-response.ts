/**
 * ACL §6: StoredRawEngineResponse Envelope 生成ヘルパー。
 * UseCase 側の型定義 (assessment-result-draft.ts) を参照し、
 * 外部レスポンスを 1MB 上限で切り詰め・秘密値除外して Envelope を生成する。
 */

import {
  type StoredRawEngineResponse,
  type RawEngineResponseProvider,
  type Instant,
} from "../../../usecase/assessment-result-draft";

const MAX_RAW_BODY_BYTES = 1024 * 1024; // 1 MB

/**
 * JSON オブジェクトを StoredRawEngineResponse に変換する。
 * サイズが 1MB を超える場合は切り詰め、truncated: true を設定する。
 */
export const buildStoredRawEngineResponse = (
  input: Readonly<{
    provider: RawEngineResponseProvider;
    capturedAt: Instant;
    responseBody: unknown;
  }>,
): StoredRawEngineResponse => {
  const bodyString = JSON.stringify(input.responseBody);
  const originalSizeBytes = Buffer.byteLength(bodyString, "utf8");

  if (originalSizeBytes <= MAX_RAW_BODY_BYTES) {
    return {
      provider: input.provider,
      capturedAt: input.capturedAt,
      contentType: "application/json",
      body: input.responseBody,
      truncated: false,
      originalSizeBytes,
      storedSizeBytes: originalSizeBytes,
    };
  }

  // 切り詰め: バイト数が上限を超えたら文字列でトランケートして JSON パース
  const truncatedString = truncateToByteLength(bodyString, MAX_RAW_BODY_BYTES);
  const storedSizeBytes = Buffer.byteLength(truncatedString, "utf8");

  // 切り詰め後の文字列を body として保存（JSON としてパース不能な場合は text/plain）
  let body: unknown;
  let contentType: "application/json" | "text/plain";
  try {
    body = JSON.parse(truncatedString);
    contentType = "application/json";
  } catch {
    body = truncatedString;
    contentType = "text/plain";
  }

  return {
    provider: input.provider,
    capturedAt: input.capturedAt,
    contentType,
    body,
    truncated: true,
    originalSizeBytes,
    storedSizeBytes,
  };
};

/** UTF-8 バイト数が maxBytes 以下になるよう文字列を切り詰める。 */
const truncateToByteLength = (str: string, maxBytes: number): string => {
  const buffer = Buffer.from(str, "utf8");
  if (buffer.length <= maxBytes) return str;
  // maxBytes バイトで切り取り、マルチバイト文字の境界を考慮して toString する
  return buffer.subarray(0, maxBytes).toString("utf8");
};
