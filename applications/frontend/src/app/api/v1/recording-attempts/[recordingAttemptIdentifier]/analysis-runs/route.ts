/**
 * API-011: POST /api/v1/recording-attempts/{recordingAttemptIdentifier}/analysis-runs — 再解析開始
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { getContainer } from "../../../../../../registry";
import { successResponse } from "../../../_shared/response";
import { domainErrorToResponse } from "../../../_shared/errors";
import { zodErrorToValidationFailed } from "../../../_shared/validation";

type RouteContext = { params: Promise<{ recordingAttemptIdentifier: string }> };

const postBodySchema = z.object({
  analysisMode: z.enum(["cloudOnly", "ossWorkerOnly", "comparison"]),
});

const toUseCaseAnalysisMode = (
  mode: "cloudOnly" | "ossWorkerOnly" | "comparison",
): "cloud_only" | "oss_worker_only" | "comparison" => {
  switch (mode) {
    case "cloudOnly":
      return "cloud_only";
    case "ossWorkerOnly":
      return "oss_worker_only";
    case "comparison":
      return "comparison";
  }
};

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const { recordingAttemptIdentifier } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "body",
      reason: "JSON のパースに失敗しました",
    });
  }

  const parseResult = postBodySchema.safeParse(body);
  if (!parseResult.success) {
    return domainErrorToResponse(zodErrorToValidationFailed(parseResult.error, "analysisMode"));
  }

  const container = getContainer();
  const result = await container.usecases.reassessPracticeAttempt({
    recordingAttempt: recordingAttemptIdentifier,
    analysisMode: toUseCaseAnalysisMode(parseResult.data.analysisMode),
  });

  if (result.isErr()) {
    return domainErrorToResponse(result.error);
  }

  const output = result.value;
  return successResponse(
    {
      analysisRun: {
        identifier: output.analysisRun.identifier,
        recordingAttempt: recordingAttemptIdentifier,
        status: "queued",
        createdAt: output.analysisRun.createdAt,
      },
      analysisJobs: output.analysisJobs.map((job) => ({
        identifier: job.identifier,
        analysisRun: output.analysisRun.identifier,
        engine: job.engine,
        status: job.state,
        attemptCount: 0,
      })),
    },
    202,
  );
}
