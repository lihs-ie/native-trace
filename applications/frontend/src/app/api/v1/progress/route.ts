/**
 * GET /api/v1/progress
 *
 * 固定 sentinel LearnerIdentifier の進捗スナップショット時系列を返す。
 * M-PG-3: capturedAt 昇順全件 + now (最新) + prev (1 個前) を返す。
 * 空集合は valid (training 未実装時 = 0 件でも 200 / honest empty)。
 *
 * レスポンス: 200 OK { data: ProgressDto }
 */

import { type NextRequest } from "next/server";
import { getContainer } from "../../../../registry";
import { successResponse } from "../_shared/response";
import { domainErrorToResponse } from "../_shared/errors";
import type { ProgressDto, ProgressSnapshotDto } from "../../../../lib/api-types";
import { createLearnerIdentifier } from "../../../../domain/training";
import { scoreToCefrBand } from "../../../../usecase/shared/cefr-subscale-derivation";

export async function GET(_request: NextRequest): Promise<Response> {
  const container = getContainer();

  const learnerIdentifier = createLearnerIdentifier(
    container.config.diagnosticSentinelLearnerIdentifier,
  );
  if (!learnerIdentifier) {
    return domainErrorToResponse({
      type: "validationFailed",
      field: "learner",
      reason: "sentinel LearnerIdentifier が不正です",
    });
  }

  const result = await container.usecases.viewProgress({ learner: learnerIdentifier });

  if (result.isErr()) {
    return domainErrorToResponse(result.error);
  }

  const toSnapshotDto = (item: (typeof result.value.snapshots)[number]): ProgressSnapshotDto => ({
    identifier: item.identifier,
    section: item.section,
    sourceAssessment: item.sourceAssessment,
    taskKind: item.taskKind,
    cefrSubscales: {
      overall:
        item.cefrSubscales.overall > 0
          ? {
              score: item.cefrSubscales.overall,
              band: scoreToCefrBand(item.cefrSubscales.overall),
            }
          : null,
      segmental:
        item.cefrSubscales.segmental > 0
          ? {
              score: item.cefrSubscales.segmental,
              band: scoreToCefrBand(item.cefrSubscales.segmental),
            }
          : null,
      prosodic:
        item.cefrSubscales.prosodic > 0
          ? {
              score: item.cefrSubscales.prosodic,
              band: scoreToCefrBand(item.cefrSubscales.prosodic),
            }
          : null,
    },
    focusScores: item.focusScores.map((fs) => ({
      contrast: fs.contrast,
      score: fs.score,
    })),
    cumulativeTrainingMinutes: item.cumulativeTrainingMinutes,
    capturedAt: item.capturedAt,
  });

  const responseDto: ProgressDto = {
    snapshots: result.value.snapshots.map(toSnapshotDto),
    now: result.value.now ? toSnapshotDto(result.value.now) : null,
    prev: result.value.prev ? toSnapshotDto(result.value.prev) : null,
  };

  return successResponse(responseDto, 200);
}
