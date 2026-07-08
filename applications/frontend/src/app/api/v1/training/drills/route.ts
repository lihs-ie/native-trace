/**
 * POST /api/v1/training/drills
 *
 * 産出ドリルセッションを開始する。(REQ-123 / M-TR-4)
 * WeaknessProfile から優先 focus 対立を選択し、対応するドリルコンテンツ +
 * TrainingSession(kind=production_drill, in_progress) を生成・永続化する。
 *
 * Body: { weaknessProfileIdentifier: string }
 * Response: 201 Created { data: DrillDto }
 *
 * ADR-004: 採点は既存 worker 契約再利用。新採点経路を作らない。
 * ADR-007: Training Context は识别符のみで他 BC を参照。
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { getContainer } from "../../../../../registry";
import { successResponse } from "../../_shared/response";
import { domainErrorToResponse } from "../../_shared/errors";
import { zodErrorToValidationFailed } from "../../_shared/validation";
import type { DrillDto } from "../../../../../lib/api-types";

const startDrillBodySchema = z.object({
  weaknessProfileIdentifier: z.string().min(1, "weaknessProfileIdentifier は必須です"),
});

export async function POST(request: NextRequest): Promise<Response> {
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

  const parsedBody = startDrillBodySchema.safeParse(body);
  if (!parsedBody.success) {
    return domainErrorToResponse(zodErrorToValidationFailed(parsedBody.error, "body"));
  }

  const container = getContainer();

  const result = await container.usecases.startDrill({
    learnerIdentifier: container.config.diagnosticSentinelLearnerIdentifier,
    weaknessProfileIdentifier: parsedBody.data.weaknessProfileIdentifier,
  });

  if (result.isErr()) {
    return domainErrorToResponse(result.error);
  }

  const { trainingSession, drillContent } = result.value;

  const responseDto: DrillDto = {
    trainingSessionIdentifier: String(trainingSession.identifier),
    catalogId: drillContent.catalogId,
    contrast: drillContent.contrast,
    targetPhonemes: [...drillContent.targetPhonemes],
    minimalPairs: drillContent.minimalPairs.map((pair) => ({
      targetWord: pair.targetWord,
      contrastWord: pair.contrastWord,
      targetPhonemeIpa: pair.targetPhonemeIpa,
      contrastPhonemeIpa: pair.contrastPhonemeIpa,
    })),
    exampleSentence: drillContent.exampleSentence,
    exampleTargetPhonemeIpas: [...drillContent.exampleTargetPhonemeIpas],
    hintJa: drillContent.hintJa,
  };

  return successResponse(responseDto, 201);
}
