/**
 * API-013: GET /api/v1/history — 履歴取得
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { getContainer } from "../../../../registry";
import { paginatedResponse } from "../_shared/response";
import { domainErrorToResponse } from "../_shared/errors";
import { zodErrorToValidationFailed } from "../_shared/validation";

const querySchema = z.object({
  material: z.string().min(1).optional(),
  sectionSeries: z.string().min(1),
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams } = request.nextUrl;

  const queryResult = querySchema.safeParse({
    material: searchParams.get("material") ?? undefined,
    sectionSeries: searchParams.get("sectionSeries") ?? undefined,
    offset: searchParams.get("offset") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
  });

  if (!queryResult.success) {
    return domainErrorToResponse(zodErrorToValidationFailed(queryResult.error, "query"));
  }

  const container = getContainer();
  const result = await container.usecases.reviewPracticeHistory({
    sectionSeries: queryResult.data.sectionSeries,
    material: queryResult.data.material,
    pagination: {
      offset: queryResult.data.offset,
      limit: queryResult.data.limit,
    },
  });

  if (result.isErr()) {
    return domainErrorToResponse(result.error);
  }

  const output = result.value;
  const data = output.sectionSeriesGroups.map((group) => ({
    sectionSeries: {
      identifier: group.sectionSeriesIdentifier,
      title: group.title,
    },
    sections: group.sectionVersions.map((sv) => ({
      section: {
        identifier: sv.sectionIdentifier,
        version: sv.version,
        bodyText: sv.bodyText,
        createdAt: sv.createdAt,
      },
      recordingAttempts: sv.recordingAttempts.map((ra) => ({
        identifier: ra.identifier,
        status: ra.state,
        createdAt: ra.createdAt,
      })),
      analysisRuns: sv.recordingAttempts.flatMap((ra) =>
        ra.analysisRuns.map((ar) => ({
          identifier: ar.identifier,
          mode: ar.mode,
          status: ar.mode,
          createdAt: ar.createdAt,
          assessmentResults: ar.assessmentResults.map((r) => ({
            identifier: r.identifier,
            overallScore: r.overallScore,
            findingsCount: r.findingsCount,
            engineKind: r.engineKind,
            createdAt: r.createdAt,
          })),
        })),
      ),
    })),
  }));

  return paginatedResponse(data, output.page);
}
