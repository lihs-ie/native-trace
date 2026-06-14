/**
 * API: POST /api/v1/ab-usage-logs — A/B 音源使用ログ記録 (M-GRV-8, ORPHAN-5)
 *
 * リクエスト: { source: "self"|"model"|"golden", qualityGatePassed: boolean|null }
 * learner は local MVP 固定 sentinel (config.diagnosticSentinelLearnerIdentifier) を使用。
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { getContainer } from "../../../../registry";
import { domainErrorToResponse } from "../_shared/errors";
import { successResponse } from "../_shared/response";

const requestBodySchema = z.object({
  source: z.enum(["self", "model", "golden"]),
  qualityGatePassed: z.boolean().nullable().default(null),
});

export async function POST(request: NextRequest): Promise<Response> {
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

  const parseResult = requestBodySchema.safeParse(body);
  if (!parseResult.success) {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "body",
      reason: parseResult.error.errors.map((error) => error.message).join(", "),
    });
  }

  const { source, qualityGatePassed } = parseResult.data;

  const container = getContainer();
  const learner = container.config.diagnosticSentinelLearnerIdentifier;

  const result = await container.usecases.recordAudioSourceUsage({
    learner,
    source,
    qualityGatePassed,
  });

  if (result.isErr()) {
    return domainErrorToResponse(result.error);
  }

  return successResponse({ recorded: true }, 201);
}
