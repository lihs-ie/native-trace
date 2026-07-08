/**
 * DomainError → HTTP マッパー
 * §3.2 エラーレスポンス envelope + §3.3 DomainError 変換表
 *
 * API key / raw response 本文 / ローカル絶対パス / cause は返さない。
 */

import type { DomainError } from "../../../../domain/shared";
import { generateRequestIdentifier } from "./response";

type ErrorEnvelope = Readonly<{
  error: Readonly<{
    code: string;
    message: string;
    details?: Readonly<{
      fieldErrors?: ReadonlyArray<Readonly<{ field: string; message: string }>>;
    }>;
  }>;
  meta: Readonly<{
    requestIdentifier: string;
  }>;
}>;

/**
 * エラー封筒 `{ error: { code, message, details? }, meta: { requestIdentifier } }` を組み立てる（W31）。
 * 封筒 JSON 形状は凍結（§4.1.3）— details は指定時のみ含める。
 */
export const errorResponse = (
  status: number,
  code: string,
  message: string,
  details?: ErrorEnvelope["error"]["details"],
): Response => {
  const envelope: ErrorEnvelope = {
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
    meta: { requestIdentifier: generateRequestIdentifier() },
  };
  return Response.json(envelope, { status });
};

type DomainErrorMapping = {
  status: number;
  code: string;
  message: string;
};

const mapDomainError = (
  error: DomainError,
): DomainErrorMapping & { details?: ErrorEnvelope["error"]["details"] } => {
  switch (error.type) {
    case "validationFailed":
      return {
        status: 400,
        code: "validationFailed",
        message: "入力値が不正です",
        details: {
          fieldErrors: [{ field: error.field, message: error.reason }],
        },
      };
    case "notFound":
      return {
        status: 404,
        code: "notFound",
        message: "指定されたリソースが見つかりません",
      };
    case "invalidStateTransition":
      return {
        status: 409,
        code: "invalidStateTransition",
        message: "状態遷移が不正です",
      };
    case "persistenceFailed":
      return {
        status: 500,
        code: "persistenceFailed",
        message: "データの保存に失敗しました",
      };
    case "transactionFailed":
      return {
        status: 500,
        code: "transactionFailed",
        message: "トランザクションの処理に失敗しました",
      };
    case "audioStorageFailed":
      return {
        status: 500,
        code: "audioStorageFailed",
        message: "音声ファイルの処理に失敗しました",
      };
    case "assessmentEngineFailed":
      return {
        status: 502,
        code: "assessmentEngineFailed",
        message: "発音評価エンジンとの通信に失敗しました",
      };
    case "assessmentSchemaInvalid":
      return {
        status: 502,
        code: "assessmentSchemaInvalid",
        message: "発音評価エンジンのレスポンス形式が不正です",
      };
  }
};

export const domainErrorToResponse = (error: DomainError): Response => {
  const mapping = mapDomainError(error);
  return errorResponse(mapping.status, mapping.code, mapping.message, mapping.details);
};
