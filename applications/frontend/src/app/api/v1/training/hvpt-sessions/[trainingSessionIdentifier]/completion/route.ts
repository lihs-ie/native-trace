/**
 * POST /api/v1/training/hvpt-sessions/{trainingSessionIdentifier}/completion
 *
 * HVPT 識別課題セッションを完了し、SpacingSchedule 遷移 + progress snapshot を生成する。(REQ-122/127 / M-TR-2/3)
 *
 * Body:
 *   - weaknessProfileIdentifier: string
 *   - durationMinutes: number（セッション経過時間、1-30 分）
 *
 * Response: 200 OK { data: HvptCompletionDto }
 *
 * ADR-011: computeSessionAccuracy → applySpacingTransition（60% ゲート）。
 * M-TR-3: captureProgressSnapshot で progress_snapshots と接続。
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { getContainer } from "../../../../../../../registry";
import { successResponse } from "../../../../_shared/response";
import { domainErrorToResponse } from "../../../../_shared/errors";
import type { HvptCompletionDto } from "../../../../../../../lib/api-types";

type RouteContext = {
  params: Promise<{ trainingSessionIdentifier: string }>;
};

const completeHvptSessionBodySchema = z.object({
  weaknessProfileIdentifier: z.string().min(1, "weaknessProfileIdentifier は必須です"),
  durationMinutes: z
    .number()
    .int()
    .min(1, "durationMinutes は 1 以上で指定してください")
    .max(30, "durationMinutes は 30 以下で指定してください"),
});

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const { trainingSessionIdentifier } = await context.params;

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

  const parsedBody = completeHvptSessionBodySchema.safeParse(body);
  if (!parsedBody.success) {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "body",
      reason: parsedBody.error.errors.map((e) => e.message).join(", "),
    });
  }

  const container = getContainer();

  const result = await container.usecases.completeHvptSession({
    trainingSessionIdentifier,
    learnerIdentifier: container.config.diagnosticSentinelLearnerIdentifier,
    durationMinutes: parsedBody.data.durationMinutes,
    weaknessProfileIdentifier: parsedBody.data.weaknessProfileIdentifier,
    schedulerConfig: {
      spacingIntervalHours: container.config.spacingIntervalHours,
      masteryGateThreshold: container.config.masteryGateThreshold,
      sessionCutoffMinutesMax: container.config.sessionCutoffMinutesMax,
      sessionCutoffMinutesMin: container.config.sessionCutoffMinutesMin,
      gateRetryIntervalHours: container.config.gateRetryIntervalHours,
    },
  });

  if (result.isErr()) {
    return domainErrorToResponse(result.error);
  }

  const output = result.value;

  const responseDto: HvptCompletionDto = {
    trainingSessionIdentifier: output.trainingSessionIdentifier,
    sessionAccuracy: output.sessionAccuracy,
    spacingState: output.spacingState,
    cumulativeTrainingMinutes: output.cumulativeTrainingMinutes,
  };

  return successResponse(responseDto, 200);
}
