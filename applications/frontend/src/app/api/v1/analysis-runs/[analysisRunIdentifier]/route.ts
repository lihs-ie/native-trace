/**
 * API-015: DELETE /api/v1/analysis-runs/{analysisRunIdentifier} — 解析実行削除
 */

import { type NextRequest } from "next/server";
import { getContainer } from "../../../../../registry";
import { successResponse } from "../../_shared/response";
import { domainErrorToResponse } from "../../_shared/errors";

type RouteContext = { params: Promise<{ analysisRunIdentifier: string }> };

export async function DELETE(_request: NextRequest, context: RouteContext): Promise<Response> {
  const { analysisRunIdentifier } = await context.params;

  const container = getContainer();
  const result = await container.usecases.discardAssessmentRun({
    analysisRun: analysisRunIdentifier,
  });

  if (result.isErr()) {
    return domainErrorToResponse(result.error);
  }

  return successResponse({
    identifier: result.value.analysisRun.identifier,
    status: "deleted",
  });
}
