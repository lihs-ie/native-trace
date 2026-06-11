/**
 * §3.3 DomainError → HTTP マッピングのユニットテスト（全 8 type）
 */

import { describe, it, expect } from "vitest";
import { domainErrorToResponse } from "./errors";
import type { DomainError } from "../../../../domain/shared";

const parseBody = async (response: Response): Promise<unknown> => {
  return response.json();
};

describe("domainErrorToResponse", () => {
  it("validationFailed → 400 with fieldErrors", async () => {
    const error: DomainError = {
      type: "validationFailed",
      field: "title",
      reason: "必須です",
    };
    const response = domainErrorToResponse(error);
    expect(response.status).toBe(400);
    const body = await parseBody(response) as {
      error: { code: string; message: string; details?: { fieldErrors?: Array<{ field: string; message: string }> } };
      meta: { requestIdentifier: string };
    };
    expect(body.error.code).toBe("validationFailed");
    expect(body.error.details?.fieldErrors?.[0]?.field).toBe("title");
    expect(body.meta.requestIdentifier).toMatch(/^req_/);
  });

  it("notFound → 404", async () => {
    const error: DomainError = {
      type: "notFound",
      resource: "Material",
      identifier: "01JZ0000000000000000000001",
    };
    const response = domainErrorToResponse(error);
    expect(response.status).toBe(404);
    const body = await parseBody(response) as { error: { code: string } };
    expect(body.error.code).toBe("notFound");
  });

  it("invalidStateTransition → 409", async () => {
    const error: DomainError = {
      type: "invalidStateTransition",
      from: "active",
      to: "deleted",
      reason: "既に削除済みです",
    };
    const response = domainErrorToResponse(error);
    expect(response.status).toBe(409);
    const body = await parseBody(response) as { error: { code: string } };
    expect(body.error.code).toBe("invalidStateTransition");
  });

  it("persistenceFailed → 500", async () => {
    const error: DomainError = {
      type: "persistenceFailed",
      reason: "DB書き込みエラー",
    };
    const response = domainErrorToResponse(error);
    expect(response.status).toBe(500);
    const body = await parseBody(response) as { error: { code: string } };
    expect(body.error.code).toBe("persistenceFailed");
  });

  it("transactionFailed → 500", async () => {
    const error: DomainError = {
      type: "transactionFailed",
      reason: "ロールバック失敗",
    };
    const response = domainErrorToResponse(error);
    expect(response.status).toBe(500);
    const body = await parseBody(response) as { error: { code: string } };
    expect(body.error.code).toBe("transactionFailed");
  });

  it("audioStorageFailed → 500", async () => {
    const error: DomainError = {
      type: "audioStorageFailed",
      reason: "ファイル書き込み失敗",
    };
    const response = domainErrorToResponse(error);
    expect(response.status).toBe(500);
    const body = await parseBody(response) as { error: { code: string } };
    expect(body.error.code).toBe("audioStorageFailed");
  });

  it("assessmentEngineFailed → 502", async () => {
    const error: DomainError = {
      type: "assessmentEngineFailed",
      engine: "cloud",
      reason: "OpenAI API timeout",
      failureKind: "retryable",
    };
    const response = domainErrorToResponse(error);
    expect(response.status).toBe(502);
    const body = await parseBody(response) as { error: { code: string } };
    expect(body.error.code).toBe("assessmentEngineFailed");
  });

  it("assessmentSchemaInvalid → 502", async () => {
    const error: DomainError = {
      type: "assessmentSchemaInvalid",
      reason: "JSON スキーマ不一致",
    };
    const response = domainErrorToResponse(error);
    expect(response.status).toBe(502);
    const body = await parseBody(response) as { error: { code: string } };
    expect(body.error.code).toBe("assessmentSchemaInvalid");
  });

  it("エラーレスポンスは常に meta.requestIdentifier を含む", async () => {
    const error: DomainError = {
      type: "notFound",
      resource: "Material",
      identifier: "01JZ0000000000000000000001",
    };
    const response = domainErrorToResponse(error);
    const body = await parseBody(response) as { meta: { requestIdentifier: string } };
    expect(body.meta.requestIdentifier).toMatch(/^req_[0-9a-f]{32}$/);
  });

  it("エラーレスポンスは cause / API key を含まない", async () => {
    const error: DomainError = {
      type: "assessmentEngineFailed",
      engine: "cloud",
      reason: "API key: sk-xxx...",
      failureKind: "nonRetryable",
    };
    const response = domainErrorToResponse(error);
    const bodyText = await response.clone().text();
    // reason は message として漏れない（汎用メッセージのみ）
    expect(bodyText).not.toContain("sk-xxx");
  });
});
