/**
 * API-007: PATCH /api/v1/section-series/{sectionSeriesIdentifier} — セクション系列改訂
 * API-008: DELETE /api/v1/section-series/{sectionSeriesIdentifier} — セクション系列削除
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { getContainer } from "../../../../../registry";
import { successResponse } from "../../_shared/response";
import { domainErrorToResponse } from "../../_shared/errors";
import { zodErrorToValidationFailed } from "../../_shared/validation";

type RouteContext = { params: Promise<{ sectionSeriesIdentifier: string }> };

// ---- PATCH /api/v1/section-series/{sectionSeriesIdentifier} ----

const patchBodySchema = z.object({
  title: z.string().min(1).optional(),
  displayOrder: z.number().int().min(0).optional(),
  bodyText: z.string().min(1).optional(),
});

export async function PATCH(request: NextRequest, context: RouteContext): Promise<Response> {
  const { sectionSeriesIdentifier } = await context.params;

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
    return domainErrorToResponse(zodErrorToValidationFailed(parseResult.error, "body"));
  }

  const container = getContainer();
  const result = await container.usecases.revisePracticeSection({
    sectionSeries: sectionSeriesIdentifier,
    title: parseResult.data.title,
    displayOrder: parseResult.data.displayOrder,
    bodyText: parseResult.data.bodyText,
  });

  if (result.isErr()) {
    return domainErrorToResponse(result.error);
  }

  const output = result.value;
  return successResponse({
    sectionSeries: {
      identifier: output.sectionSeries.identifier,
      title: output.sectionSeries.title,
      displayOrder: output.sectionSeries.displayOrder,
      updatedAt: output.sectionSeries.updatedAt,
    },
    createdSection: output.newSection
      ? {
          identifier: output.newSection.identifier,
          sectionSeries: sectionSeriesIdentifier,
          version: output.newSection.version,
          bodyText: output.newSection.bodyText,
          createdAt: output.newSection.createdAt,
        }
      : null,
  });
}

// ---- DELETE /api/v1/section-series/{sectionSeriesIdentifier} ----

export async function DELETE(_request: NextRequest, context: RouteContext): Promise<Response> {
  const { sectionSeriesIdentifier } = await context.params;

  const container = getContainer();
  const result = await container.usecases.retirePracticeSectionSeries({
    sectionSeries: sectionSeriesIdentifier,
  });

  if (result.isErr()) {
    return domainErrorToResponse(result.error);
  }

  return successResponse({
    identifier: result.value.sectionSeries.identifier,
    status: "deleted",
  });
}
