/**
 * API-005: GET /api/v1/materials/{materialIdentifier}/practice-plan — 練習計画取得
 */

import { type NextRequest } from "next/server";
import { getContainer } from "../../../../../../registry";
import { successResponse } from "../../../_shared/response";
import { domainErrorToResponse } from "../../../_shared/errors";

type RouteContext = { params: Promise<{ materialIdentifier: string }> };

export async function GET(_request: NextRequest, context: RouteContext): Promise<Response> {
  const { materialIdentifier } = await context.params;

  const container = getContainer();
  const result = await container.usecases.viewMaterialPracticePlan({
    material: materialIdentifier,
  });

  if (result.isErr()) {
    return domainErrorToResponse(result.error);
  }

  const output = result.value;

  return successResponse({
    material: {
      identifier: output.material.identifier,
      title: output.material.title,
      source: output.material.sourceType ? { sourceType: output.material.sourceType } : null,
      updatedAt: output.material.updatedAt,
    },
    sectionSeries: output.sectionSeriesItems.map((item) => ({
      sectionSeries: {
        identifier: item.identifier,
        material: materialIdentifier,
        title: item.title,
        displayOrder: item.displayOrder,
      },
      latestSection: item.latestSection
        ? {
            identifier: item.latestSection.identifier,
            sectionSeries: item.identifier,
            version: item.latestSection.version,
            bodyText: item.latestSection.bodyText,
            createdAt: item.latestSection.createdAt,
          }
        : null,
      versions: item.versionSummaries.map((v) => ({
        identifier: v.identifier,
        version: v.version,
        createdAt: v.createdAt,
      })),
    })),
  });
}
