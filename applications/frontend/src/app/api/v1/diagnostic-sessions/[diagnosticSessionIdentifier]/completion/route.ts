/**
 * POST /api/v1/diagnostic-sessions/{diagnosticSessionIdentifier}/completion
 *
 * 診断セッションを完了させ WeaknessProfile を初期生成・永続化する。
 * M-DG-3/4: findings → catalog projection → initializeWeaknessProfile (三項式)
 *
 * Body: { assessmentResultIdentifiers: string[] }
 * レスポンス: 200 OK { data: { diagnosticSessionIdentifier, weaknessProfileIdentifier, focusSoundCount } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { getContainer } from "../../../../../../registry";
import { successResponse } from "../../../_shared/response";
import { domainErrorToResponse } from "../../../_shared/errors";

type RouteContext = {
  params: Promise<{ diagnosticSessionIdentifier: string }>;
};

const completionBodySchema = z.object({
  assessmentResultIdentifiers: z
    .array(z.string().min(1))
    .min(1, "assessmentResultIdentifiers は1件以上必要です"),
});

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const { diagnosticSessionIdentifier } = await context.params;

  let body: unknown;
  try {
    const text = await request.text();
    body = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "body",
      reason: "リクエストボディのJSONが不正です",
    });
  }

  const parsedBody = completionBodySchema.safeParse(body);
  if (!parsedBody.success) {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "body",
      reason: parsedBody.error.errors.map((e) => e.message).join(", "),
    });
  }

  const container = getContainer();

  const result = await container.usecases.completeDiagnosticSession({
    diagnosticSessionIdentifier,
    assessmentResultIdentifiers: parsedBody.data.assessmentResultIdentifiers,
    priorityWeights: {
      w1: container.config.diagnosticFocusWeightW1,
      w2: container.config.diagnosticFocusWeightW2,
      w3: container.config.diagnosticFocusWeightW3,
    },
    gopNormalizationRange: {
      floor: container.config.diagnosticGopRangeFloor,
      ceiling: container.config.diagnosticGopRangeCeiling,
    },
  });

  if (result.isErr()) {
    return domainErrorToResponse(result.error);
  }

  return successResponse(
    {
      diagnosticSessionIdentifier: result.value.diagnosticSessionIdentifier,
      weaknessProfileIdentifier: result.value.weaknessProfileIdentifier,
      focusSoundCount: result.value.focusSoundCount,
    },
    200,
  );
}
