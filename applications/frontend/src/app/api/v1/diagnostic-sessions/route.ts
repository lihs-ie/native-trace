/**
 * POST /api/v1/diagnostic-sessions
 *
 * 診断セッションを開始し、診断専用課題セットを返す。
 * M-DG-1/2: DiagnosticSession(pending) を生成・永続化する。
 *
 * レスポンス: 201 Created { data: DiagnosticSessionDto }
 */

import { getContainer } from "../../../../registry";
import { getDiagnosticPromptSet } from "../../../../infrastructure/training/diagnostic-prompt-fixture";
import { successResponse } from "../_shared/response";
import { domainErrorToResponse } from "../_shared/errors";
import type { DiagnosticSessionDto } from "../../../../lib/api-types";

export async function POST(): Promise<Response> {
  const container = getContainer();

  const promptSet = getDiagnosticPromptSet();

  const result = await container.usecases.startDiagnosticSession({
    learnerIdentifier: container.config.diagnosticSentinelLearnerIdentifier,
    promptSet,
  });

  if (result.isErr()) {
    return domainErrorToResponse(result.error);
  }

  const { diagnosticSession } = result.value;

  const responseDto: DiagnosticSessionDto = {
    identifier: String(diagnosticSession.identifier),
    status: diagnosticSession.type,
    promptSet: {
      prompts: diagnosticSession.promptSet.prompts.map((prompt) => ({
        identifier: prompt.identifier,
        text: prompt.text,
        targetCatalogId: prompt.targetCatalogId ? String(prompt.targetCatalogId) : null,
        phenomenon: prompt.phenomenon,
      })),
    },
    startedAt: diagnosticSession.startedAt.toISOString(),
    completedAt: null,
    weaknessProfileIdentifier: null,
  };

  return successResponse(responseDto, 201);
}
