/**
 * API-001: GET /api/v1/materials — 題材一覧取得
 * API-002: POST /api/v1/materials — 題材作成
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { getContainer } from "../../../../registry";
import { successResponse, paginatedResponse } from "../_shared/response";
import { domainErrorToResponse } from "../_shared/errors";
import { zodErrorToValidationFailed } from "../_shared/validation";

// ---- GET /api/v1/materials ----

const querySchema = z.object({
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams } = request.nextUrl;
  const queryResult = querySchema.safeParse({
    offset: searchParams.get("offset") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
  });

  if (!queryResult.success) {
    return domainErrorToResponse(zodErrorToValidationFailed(queryResult.error, "query"));
  }

  const container = getContainer();
  const result = await container.usecases.browsePracticeMaterials({
    pagination: {
      offset: queryResult.data.offset,
      limit: queryResult.data.limit,
    },
  });

  if (result.isErr()) {
    return domainErrorToResponse(result.error);
  }

  const output = result.value;
  const data = output.materials.map((m) => ({
    identifier: m.identifier,
    title: m.title,
    source: m.sourceType ? { sourceType: m.sourceType } : null,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    stats: {
      sectionSeriesCount: m.stats.sectionSeriesCount,
      recordingAttemptCount: m.stats.recordingAttemptCount,
      bestOverallScore: m.stats.bestOverallScore,
      overallScoreHistory: [...m.stats.overallScoreHistory],
      lastPracticedAt: m.stats.lastPracticedAt,
    },
  }));

  return paginatedResponse(data, output.page);
}

// ---- POST /api/v1/materials ----

const postBodySchema = z.object({
  title: z.string().min(1),
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

export async function POST(request: NextRequest): Promise<Response> {
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
    return domainErrorToResponse(zodErrorToValidationFailed(parseResult.error, "body"));
  }

  const container = getContainer();
  const result = await container.usecases.prepareMaterial({
    title: parseResult.data.title,
    source: parseResult.data.source,
  });

  if (result.isErr()) {
    return domainErrorToResponse(result.error);
  }

  const { material } = result.value;
  return successResponse(
    {
      material: {
        identifier: material.identifier,
        title: material.title,
        source: material.sourceType ? { sourceType: material.sourceType } : null,
        createdAt: material.createdAt,
        updatedAt: material.updatedAt,
      },
    },
    201,
  );
}
