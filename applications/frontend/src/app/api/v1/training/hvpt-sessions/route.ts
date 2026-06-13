/**
 * POST /api/v1/training/hvpt-sessions
 *
 * HVPT 識別課題セッションを開始する。(REQ-122 / M-TR-6)
 * WeaknessProfile の focus 対立（または SpacingSchedule の due 対立）を選択し、
 * analyzer /v1/stimuli から実刺激を取得して TrainingSession(kind=hvpt_identification, in_progress) を生成・永続化する。
 *
 * Body: { weaknessProfileIdentifier: string }
 * Response: 201 Created { data: HvptSessionDto }
 *
 * ADR-009: 刺激は analyzer 実取得（偽刺激禁止）。
 * ADR-007: Training Context は識別子のみで他 BC を参照。
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { getContainer } from "../../../../../registry";
import { successResponse } from "../../_shared/response";
import { domainErrorToResponse } from "../../_shared/errors";
import type {
  HvptSessionDto,
  HvptStimulusDto,
  StimulusMetadataDto,
  HvptChoiceDto,
} from "../../../../../lib/api-types";

const startHvptSessionBodySchema = z.object({
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

  const parsedBody = startHvptSessionBodySchema.safeParse(body);
  if (!parsedBody.success) {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "body",
      reason: parsedBody.error.errors.map((e) => e.message).join(", "),
    });
  }

  const container = getContainer();

  const result = await container.usecases.startHvptSession({
    learnerIdentifier: container.config.diagnosticSentinelLearnerIdentifier,
    weaknessProfileIdentifier: parsedBody.data.weaknessProfileIdentifier,
  });

  if (result.isErr()) {
    return domainErrorToResponse(result.error);
  }

  const { trainingSession, contrast, stimuli } = result.value;

  const stimuliDto: HvptStimulusDto[] = stimuli.map((stimulus) => {
    const metadata: StimulusMetadataDto = {
      stimulusIdentifier: String(stimulus.stimulusIdentifier),
      contrast: stimulus.metadata.contrast,
      word: stimulus.metadata.word,
      speakerIdentifier: stimulus.metadata.speakerIdentifier,
      speakerSex: stimulus.metadata.speakerSex,
      context: stimulus.metadata.context,
      sourceCorpus: stimulus.metadata.sourceCorpus,
      licenseIdentifier: stimulus.metadata.licenseIdentifier,
    };

    const choices: HvptChoiceDto[] = stimulus.choices.map((choice) => ({
      type: choice.type,
      value: choice.value,
    }));

    return {
      stimulusIdentifier: String(stimulus.stimulusIdentifier),
      wavBase64: stimulus.wavBase64,
      metadata,
      choices,
    };
  });

  const responseDto: HvptSessionDto = {
    trainingSessionIdentifier: String(trainingSession.identifier),
    contrast,
    stimuli: stimuliDto,
  };

  return successResponse(responseDto, 201);
}
