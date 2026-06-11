/**
 * API-003: PATCH /api/v1/materials/{materialIdentifier} — 題材更新
 * API-004: DELETE /api/v1/materials/{materialIdentifier} — 題材削除
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { getContainer } from "../../../../../registry";
import { successResponse } from "../../_shared/response";
import { domainErrorToResponse } from "../../_shared/errors";

type RouteContext = { params: Promise<{ materialIdentifier: string }> };

// ---- PATCH /api/v1/materials/{materialIdentifier} ----

const patchBodySchema = z.object({
  title: z.string().min(1).optional(),
  source: z
    .object({
      sourceType: z.string().optional(),
      sourceUrl: z.string().optional().nullable(),
      sourceTitle: z.string().optional().nullable(),
      speakerName: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
});

export async function PATCH(request: NextRequest, context: RouteContext): Promise<Response> {
  const { materialIdentifier } = await context.params;

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

  const parseResult = patchBodySchema.safeParse(body);
  if (!parseResult.success) {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "body",
      reason: parseResult.error.errors.map((e) => e.message).join(", "),
    });
  }

  const container = getContainer();
  const result = await container.usecases.reviseMaterial({
    material: materialIdentifier,
    title: parseResult.data.title,
    source: parseResult.data.source,
  });

  if (result.isErr()) {
    return domainErrorToResponse(result.error);
  }

  const { material } = result.value;
  return successResponse({
    material: {
      identifier: material.identifier,
      title: material.title,
      source: material.sourceType ? { sourceType: material.sourceType } : null,
      updatedAt: material.updatedAt,
    },
  });
}

// ---- DELETE /api/v1/materials/{materialIdentifier} ----

export async function DELETE(_request: NextRequest, context: RouteContext): Promise<Response> {
  const { materialIdentifier } = await context.params;

  const container = getContainer();
  const result = await container.usecases.retireMaterial({
    material: materialIdentifier,
  });

  if (result.isErr()) {
    return domainErrorToResponse(result.error);
  }

  return successResponse({
    identifier: result.value.material.identifier,
    status: "deleted",
  });
}
