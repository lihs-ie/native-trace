/**
 * DomainError → HTTP マッパー
 * §3.2 エラーレスポンス envelope + §3.3 DomainError 変換表
 *
 * API key / raw response 本文 / ローカル絶対パス / cause は返さない。
 */

import type { DomainError } from "../../../../domain/shared";

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

const generateRequestIdentifier = (): string => {
  const uuid = globalThis.crypto.randomUUID().replace(/-/g, "");
  return `req_${uuid}`;
};

type DomainErrorMapping = {
  status: number;
  code: string;
  message: string;
};

const mapDomainError = (error: DomainError): DomainErrorMapping & { details?: ErrorEnvelope["error"]["details"] } => {
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
  const envelope: ErrorEnvelope = {
    error: {
      code: mapping.code,
      message: mapping.message,
      ...(mapping.details ? { details: mapping.details } : {}),
    },
    meta: { requestIdentifier: generateRequestIdentifier() },
  };
  return Response.json(envelope, { status: mapping.status });
};

export const domainErrorToStatus = (error: DomainError): number => {
  return mapDomainError(error).status;
};
