/**
 * POST /api/v1/training/hvpt-sessions/{trainingSessionIdentifier}/trials
 *
 * HVPT 識別試行を記録し、即時フィードバックを返す。(REQ-122 / M-TR-6)
 *
 * Body:
 *   - stimulusIdentifier: string（提示した刺激の識別子）
 *   - correctLabelType: "spelling" | "keyword" | "ipa"
 *   - correctLabelValue: string（正解ラベルの値）
 *   - responseLabelType: "spelling" | "keyword" | "ipa"
 *   - responseLabelValue: string（学習者の応答ラベルの値）
 *   - reactionTimeMilliseconds: number（反応時間）
 *   - presentedAt: string（ISO 8601 刺激提示時刻）
 *   - correctStimulusWavBase64: string | null（正解音 WAV Base64、フィードバック用）
 *
 * Response: 201 Created { data: HvptTrialResultDto }
 *
 * ORPHAN-5: SubmitHvptTrial usecase が HvptTrial.save まで配線することで ORPHAN 解消。
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { getContainer } from "../../../../../../../registry";
import { successResponse } from "../../../../_shared/response";
import { domainErrorToResponse } from "../../../../_shared/errors";
import type { HvptTrialResultDto, HvptChoiceDto } from "../../../../../../../lib/api-types";

type RouteContext = {
  params: Promise<{ trainingSessionIdentifier: string }>;
};

const responseLabelTypeSchema = z.enum(["spelling", "keyword", "ipa"]);

const submitHvptTrialBodySchema = z.object({
  stimulusIdentifier: z.string().min(1, "stimulusIdentifier は必須です"),
  correctLabelType: responseLabelTypeSchema,
  correctLabelValue: z.string().min(1, "correctLabelValue は必須です"),
  responseLabelType: responseLabelTypeSchema,
  responseLabelValue: z.string().min(1, "responseLabelValue は必須です"),
  reactionTimeMilliseconds: z
    .number()
    .int()
    .positive("reactionTimeMilliseconds は正の整数で指定してください"),
  presentedAt: z.string().min(1, "presentedAt は必須です"),
  correctStimulusWavBase64: z.string().nullable().optional(),
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

  const parsedBody = submitHvptTrialBodySchema.safeParse(body);
  if (!parsedBody.success) {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "body",
      reason: parsedBody.error.errors.map((e) => e.message).join(", "),
    });
  }

  const container = getContainer();

  const result = await container.usecases.submitHvptTrial({
    trainingSessionIdentifier,
    stimulusIdentifier: parsedBody.data.stimulusIdentifier,
    correctLabelType: parsedBody.data.correctLabelType,
    correctLabelValue: parsedBody.data.correctLabelValue,
    responseLabelType: parsedBody.data.responseLabelType,
    responseLabelValue: parsedBody.data.responseLabelValue,
    reactionTimeMilliseconds: parsedBody.data.reactionTimeMilliseconds,
    presentedAt: parsedBody.data.presentedAt,
    correctStimulusWavBase64: parsedBody.data.correctStimulusWavBase64 ?? null,
  });

  if (result.isErr()) {
    return domainErrorToResponse(result.error);
  }

  const output = result.value;

  const correctLabelDto: HvptChoiceDto = {
    type: output.correctLabel.type as "spelling" | "keyword" | "ipa",
    value: output.correctLabel.value,
  };

  const responseDto: HvptTrialResultDto = {
    hvptTrialIdentifier: output.hvptTrialIdentifier,
    correct: output.correct,
    correctLabel: correctLabelDto,
    correctStimulusWavBase64: output.correctStimulusWavBase64,
  };

  return successResponse(responseDto, 201);
}
