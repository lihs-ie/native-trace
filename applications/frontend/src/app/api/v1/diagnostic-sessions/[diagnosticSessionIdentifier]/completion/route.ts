/**
 * POST /api/v1/diagnostic-sessions/{diagnosticSessionIdentifier}/completion
 *
 * 診断セッションを完了させ WeaknessProfile を初期生成・永続化する。
 * M-DG-3/4: findings → catalog projection → initializeWeaknessProfile (三項式)
 * M-PG-2: 完了後に baseline ProgressSnapshot を生成・永続化する。
 *
 * Body: { assessmentResultIdentifiers: string[] }
 * レスポンス: 200 OK { data: { diagnosticSessionIdentifier, weaknessProfileIdentifier, focusSoundCount } }
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { getContainer } from "../../../../../../registry";
import { successResponse } from "../../../_shared/response";
import { domainErrorToResponse } from "../../../_shared/errors";
import { createLearnerIdentifier } from "../../../../../../domain/training";
import { createSectionIdentifier } from "../../../../../../domain/section";

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

  // M-PG-2: diagnostic 完了後に baseline ProgressSnapshot を生成・永続化する。
  // sentinel learner と診断セッション識別子（section として使用）を取得する。
  const learnerIdentifier = createLearnerIdentifier(
    container.config.diagnosticSentinelLearnerIdentifier,
  );
  if (!learnerIdentifier) {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "learner",
      reason: "sentinel LearnerIdentifier が不正です",
    });
  }

  // DiagnosticSession 識別子を SectionIdentifier として使用する（baseline honest 設計）
  const sectionIdentifier = createSectionIdentifier(result.value.diagnosticSessionIdentifier);
  if (!sectionIdentifier) {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "section",
      reason: "SectionIdentifier の生成に失敗しました",
    });
  }

  // 複数 AssessmentResult がある場合、最初の1件を baseline snapshot の source として使用する。
  // CEFR スコアは capture usecase 内で AssessmentResult.scores から deriveCefrSubscalesFromScores で導出する。
  const primaryAssessmentResult = result.value.assessmentResults[0];
  if (!primaryAssessmentResult) {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "assessmentResults",
      reason: "baseline snapshot 生成に必要な AssessmentResult が存在しません",
    });
  }

  const captureResult = await container.usecases.captureProgressSnapshot({
    learner: learnerIdentifier,
    section: sectionIdentifier,
    assessmentResult: primaryAssessmentResult,
    weaknessProfile: result.value.weaknessProfile,
  });

  if (captureResult.isErr()) {
    return domainErrorToResponse(captureResult.error);
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
