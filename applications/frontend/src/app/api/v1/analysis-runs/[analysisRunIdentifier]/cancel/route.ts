/**
 * API-012: POST /api/v1/analysis-runs/{analysisRunIdentifier}/cancel — 解析実行キャンセル
 */

import { type NextRequest } from "next/server";
import { getContainer } from "../../../../../../registry";
import { successResponse } from "../../../_shared/response";
import { domainErrorToResponse } from "../../../_shared/errors";

type RouteContext = { params: Promise<{ analysisRunIdentifier: string }> };

export async function POST(_request: NextRequest, context: RouteContext): Promise<Response> {
  const { analysisRunIdentifier } = await context.params;

  const container = getContainer();
  const result = await container.usecases.cancelAssessmentRun({
    analysisRun: analysisRunIdentifier,
  });

  if (result.isErr()) {
    return domainErrorToResponse(result.error);
  }

  const output = result.value;
  return successResponse(
    {
      analysisRun: {
        identifier: output.analysisRun.identifier,
        status: output.analysisRun.status,
      },
      canceledJobs: output.canceledJobs.map((job) => job.identifier),
    },
    202,
  );
}
