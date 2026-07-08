/**
 * GET /api/v1/diagnostic-sessions/{diagnosticSessionIdentifier}
 *
 * 診断セッションの状態を取得する。
 * M-DG-1: DiagnosticSession の状態確認エンドポイント。
 *
 * 完了済みセッションの場合: 200 OK { data: { status: "completed", ... } }
 * 未完了セッションの場合: viewDiagnosticResult が pending エラーを返すため
 *   200 OK { data: { status: "pending" } } を返す。
 *
 * レスポンス: 200 OK { data: DiagnosticSessionStatusDto }
 */

import { type NextRequest } from "next/server";
import { getContainer } from "../../../../../registry";
import { successResponse } from "../../_shared/response";
import { domainErrorToResponse } from "../../_shared/errors";

type RouteContext = {
  params: Promise<{ diagnosticSessionIdentifier: string }>;
};

type DiagnosticSessionStatusDto = Readonly<{
  identifier: string;
  status: "pending" | "completed";
  weaknessProfileIdentifier: string | null;
  completedAt: string | null;
}>;

export async function GET(_request: NextRequest, context: RouteContext): Promise<Response> {
  const { diagnosticSessionIdentifier } = await context.params;

  if (!diagnosticSessionIdentifier || diagnosticSessionIdentifier.trim().length === 0) {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "diagnosticSessionIdentifier",
      reason: "不正な診断セッション識別子です",
    });
  }

  const container = getContainer();
  const result = await container.usecases.viewDiagnosticResult({
    diagnosticSessionIdentifier,
  });

  if (result.isErr()) {
    const error = result.error;
    // viewDiagnosticResult が pending エラーを返す場合は pending 状態を返す
    if (error.type === "validationFailed" && error.reason.includes("pending")) {
      const pendingDto: DiagnosticSessionStatusDto = {
        identifier: diagnosticSessionIdentifier,
        status: "pending",
        weaknessProfileIdentifier: null,
        completedAt: null,
      };
      return successResponse(pendingDto, 200);
    }
    return domainErrorToResponse(error);
  }

  const resultValue = result.value;
  const completedDto: DiagnosticSessionStatusDto = {
    identifier: resultValue.diagnosticSessionIdentifier,
    status: "completed",
    weaknessProfileIdentifier: resultValue.weaknessProfileIdentifier,
    completedAt: resultValue.completedAt,
  };

  return successResponse(completedDto, 200);
}
