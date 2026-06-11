/**
 * API-006: POST /api/v1/materials/{materialIdentifier}/section-series — セクション作成
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { getContainer } from "../../../../../../registry";
import { successResponse } from "../../../_shared/response";
import { domainErrorToResponse } from "../../../_shared/errors";

type RouteContext = { params: Promise<{ materialIdentifier: string }> };

const postBodySchema = z.object({
  title: z.string().min(1),
  displayOrder: z.number().int().min(0),
  bodyText: z.string().min(1),
});

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
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

  const parseResult = postBodySchema.safeParse(body);
  if (!parseResult.success) {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "body",
      reason: parseResult.error.errors.map((e) => e.message).join(", "),
    });
  }

  const container = getContainer();
  const result = await container.usecases.definePracticeSection({
    material: materialIdentifier,
    title: parseResult.data.title,
    displayOrder: parseResult.data.displayOrder,
    bodyText: parseResult.data.bodyText,
  });

  if (result.isErr()) {
    return domainErrorToResponse(result.error);
  }

  const output = result.value;
  return successResponse(
    {
      sectionSeries: {
        identifier: output.sectionSeries.identifier,
        material: materialIdentifier,
        title: output.sectionSeries.title,
        displayOrder: output.sectionSeries.displayOrder,
        createdAt: output.sectionSeries.createdAt,
        updatedAt: output.sectionSeries.createdAt,
      },
      section: {
        identifier: output.section.identifier,
        sectionSeries: output.sectionSeries.identifier,
        version: output.section.version,
        bodyText: output.section.bodyText,
        createdAt: output.section.createdAt,
      },
    },
    201,
  );
}
