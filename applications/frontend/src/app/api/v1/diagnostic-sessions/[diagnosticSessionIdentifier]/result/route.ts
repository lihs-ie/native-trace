/**
 * GET /api/v1/diagnostic-sessions/{diagnosticSessionIdentifier}/result
 *
 * 診断結果（Stage / CEFR 下位尺度 / focus sounds）を取得する。
 * M-DG-3/4/5: WeaknessProfile + AssessmentResult から診断結果を組み立てて返す。
 *
 * レスポンス: 200 OK { data: DiagnosticResultDto }
 */

import { type NextRequest } from "next/server";
import { getContainer } from "../../../../../../registry";
import { successResponse } from "../../../_shared/response";
import { domainErrorToResponse } from "../../../_shared/errors";
import type { DiagnosticResultDto } from "../../../../../../lib/api-types";

type RouteContext = {
  params: Promise<{ diagnosticSessionIdentifier: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext): Promise<Response> {
  const { diagnosticSessionIdentifier } = await context.params;

  if (!diagnosticSessionIdentifier || diagnosticSessionIdentifier.trim().length === 0) {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "diagnosticSessionIdentifier",
      reason: "不正な診断セッション識別子です",
    });
  }

  const container = getContainer();
  const result = await container.usecases.viewDiagnosticResult({
    diagnosticSessionIdentifier,
  });

  if (result.isErr()) {
    return domainErrorToResponse(result.error);
  }

  const resultValue = result.value;

  const responseDto: DiagnosticResultDto = {
    diagnosticSessionIdentifier: resultValue.diagnosticSessionIdentifier,
    weaknessProfileIdentifier: resultValue.weaknessProfileIdentifier,
    stage: resultValue.stage,
    cefrSubscales: {
      overall: resultValue.cefrSubscales.overall,
      segmental: resultValue.cefrSubscales.segmental,
      prosodic: resultValue.cefrSubscales.prosodic,
    },
    focusSounds: resultValue.focusSounds.map((sound) => ({
      contrast: sound.contrast,
      catalogId: sound.catalogId,
      functionalLoadRank: sound.functionalLoadRank,
      occurrenceFrequency: sound.occurrenceFrequency,
      mastery: sound.mastery,
      priority: sound.priority,
    })),
    completedAt: resultValue.completedAt,
  };

  return successResponse(responseDto, 200);
}
