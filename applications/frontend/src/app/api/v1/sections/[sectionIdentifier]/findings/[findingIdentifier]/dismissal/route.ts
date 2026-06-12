/**
 * API-C6: finding 却下永続化 (M-108 / REQ-108)
 *
 * POST   /api/v1/sections/{sectionIdentifier}/findings/{findingIdentifier}/dismissal
 *   → finding を却下として記録する（body: { reason?: string | null }）
 *
 * DELETE /api/v1/sections/{sectionIdentifier}/findings/{findingIdentifier}/dismissal
 *   → finding の却下を取り消す
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { getContainer } from "../../../../../../../../registry";
import { successResponse } from "../../../../../_shared/response";
import { domainErrorToResponse } from "../../../../../_shared/errors";

type RouteContext = {
  params: Promise<{ sectionIdentifier: string; findingIdentifier: string }>;
};

const dismissBodySchema = z.object({
  reason: z.string().nullable().optional(),
});

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const { sectionIdentifier, findingIdentifier } = await context.params;

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

  const parsedBody = dismissBodySchema.safeParse(body);
  if (!parsedBody.success) {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "body",
      reason: parsedBody.error.errors.map((e) => e.message).join(", "),
    });
  }

  const container = getContainer();
  const result = await container.usecases.dismissFinding({
    section: sectionIdentifier,
    finding: findingIdentifier,
    reason: parsedBody.data.reason ?? null,
  });

  if (result.isErr()) {
    return domainErrorToResponse(result.error);
  }

  return successResponse(
    {
      dismissalIdentifier: result.value.dismissalIdentifier,
      assessmentResult: result.value.assessmentResult,
      findingIdentifier: result.value.findingIdentifier,
      dismissedAt: result.value.dismissedAt,
    },
    201,
  );
}

export async function DELETE(_request: NextRequest, context: RouteContext): Promise<Response> {
  const { sectionIdentifier, findingIdentifier } = await context.params;

  const container = getContainer();
  const result = await container.usecases.restoreFinding({
    section: sectionIdentifier,
    finding: findingIdentifier,
  });

  if (result.isErr()) {
    return domainErrorToResponse(result.error);
  }

  return successResponse(
    {
      assessmentResult: result.value.assessmentResult,
      findingIdentifier: result.value.findingIdentifier,
      undoneAt: result.value.undoneAt,
    },
    200,
  );
}
