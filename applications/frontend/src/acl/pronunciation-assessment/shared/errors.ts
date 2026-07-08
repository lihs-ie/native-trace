/**
 * ACL §10: エラー変換ヘルパー。
 * 外部エンジンのエラーを DomainError (assessmentEngineFailed / assessmentSchemaInvalid) へ変換する。
 */

import {
  type AssessmentEngineFailedError,
  type AssessmentSchemaInvalidError,
} from "../../../domain/shared";

/** acl.md §10.1 に定義された失敗種別 */
export const AssessmentEngineFailureKind = {
  RETRYABLE: "retryable",
  NON_RETRYABLE: "nonRetryable",
} as const;

export type AssessmentEngineFailureKind =
  (typeof AssessmentEngineFailureKind)[keyof typeof AssessmentEngineFailureKind];

/**
 * エンジン失敗 DomainError を生成する。
 * API key・request header・ローカルパスをサニタイズした安全なメッセージのみ含める。
 */
export const assessmentEngineFailed = (
  engine: string,
  reason: string,
  failureKind: AssessmentEngineFailureKind,
): AssessmentEngineFailedError => ({
  type: "assessmentEngineFailed",
  engine,
  reason: sanitizeErrorMessage(reason),
  failureKind,
});

/**
 * スキーマ不正 DomainError を生成する。
 * JSON parse 失敗・category 変換不能・range 不正・version 不一致はすべてこれを使う。
 */
export const assessmentSchemaInvalid = (reason: string): AssessmentSchemaInvalidError => ({
  type: "assessmentSchemaInvalid",
  reason: sanitizeErrorMessage(reason),
});

/**
 * HTTP ステータスコードから failureKind を分類する。
 * acl.md §10.2 の分類表に従う。
 *
 * retryable:     429, 500, 502, 503, 504
 * nonRetryable:  400, 401, 403, 404, 413, 415, 422, その他 4xx
 */
export const classifyHttpStatus = (status: number): AssessmentEngineFailureKind => {
  if (status === 429) return AssessmentEngineFailureKind.RETRYABLE;
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return AssessmentEngineFailureKind.RETRYABLE;
  }
  return AssessmentEngineFailureKind.NON_RETRYABLE;
};

/**
 * fetch のネットワークエラーから failureKind を分類する。
 * timeout / connection reset は retryable。
 */
export const classifyFetchError = (error: unknown): AssessmentEngineFailureKind => {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    const name = error.name.toLowerCase();
    if (
      name === "aborterror" ||
      message.includes("timeout") ||
      message.includes("connection reset") ||
      message.includes("econnreset") ||
      message.includes("etimedout") ||
      message.includes("econnrefused")
    ) {
      return AssessmentEngineFailureKind.RETRYABLE;
    }
  }
  return AssessmentEngineFailureKind.NON_RETRYABLE;
};

/**
 * エラーメッセージから API key・Authorization ヘッダー値・ローカル絶対パスを除去する。
 * acl.md §6.2 の禁止事項に対応。
 */
export const sanitizeErrorMessage = (message: string): string => {
  return (
    message
      // Bearer token / API key パターン (sk-... / Bearer xxx)
      .replace(/sk-[A-Za-z0-9_-]{10,}/g, "[REDACTED_API_KEY]")
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
      .replace(/Authorization:\s*[^\s]+/gi, "Authorization: [REDACTED]")
      // ローカル絶対パス (Unix / Windows)
      .replace(/\/(?:Users|home|root|var|tmp|opt|usr)\/[^\s,'"]+/g, "[REDACTED_PATH]")
      .replace(/[A-Z]:\\[^\s,'"]+/g, "[REDACTED_PATH]")
  );
};
