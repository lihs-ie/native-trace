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
      source: output.material.sourceType
        ? {
            sourceType: output.material.sourceType,
            speakerName: output.material.speakerName ?? null,
          }
        : null,
      createdAt: output.material.createdAt,
      updatedAt: output.material.updatedAt,
      stats: {
        sectionSeriesCount: output.sectionSeriesItems.length,
        recordingAttemptCount: output.materialLevelStats.totalRecordingAttemptCount,
        bestOverallScore: output.materialLevelStats.bestOverallScore,
        overallScoreHistory: [],
        lastPracticedAt: null,
      },
    },
    sectionSeries: output.sectionSeriesItems.map((item) => ({
      sectionSeries: {
        identifier: item.identifier,
        material: materialIdentifier,
        title: item.title,
        displayOrder: item.displayOrder,
        createdAt: item.latestSection?.createdAt ?? output.material.createdAt,
        updatedAt: item.latestSection?.createdAt ?? output.material.updatedAt,
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
      stats: {
        wordCount: item.stats.wordCount,
        recordingAttemptCount: item.stats.recordingAttemptCount,
        bestOverallScore: item.stats.bestOverallScore,
        overallScoreHistory: [...item.stats.overallScoreHistory],
      },
    })),
    materialLevelStats: {
      totalWordCount: output.materialLevelStats.totalWordCount,
      totalRecordingAttemptCount: output.materialLevelStats.totalRecordingAttemptCount,
      bestOverallScore: output.materialLevelStats.bestOverallScore,
    },
  });
}
