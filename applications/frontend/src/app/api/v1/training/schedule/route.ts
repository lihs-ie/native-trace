/**
 * GET /api/v1/training/schedule
 *
 * sentinel LearnerIdentifier の SpacingSchedule 全件 + 累計訓練時間を返す。
 * training 画面 .tr-rail (.sched / .cum-bar) の実データ駆動描画に使用する。
 *
 * Response: 200 OK { data: TrainingScheduleDto }
 *
 * ADR-011: SpacingSchedule は決定論 state machine で永続。
 * training 画面はこのエンドポイントから実 DB 値を受け取り描画する（固定値禁止）。
 */

import { type NextRequest } from "next/server";
import { getContainer } from "../../../../../registry";
import { successResponse } from "../../_shared/response";
import { domainErrorToResponse } from "../../_shared/errors";
import type { TrainingScheduleDto, SpacingScheduleDto } from "../../../../../lib/api-types";
import { createLearnerIdentifier } from "../../../../../domain/training";

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

  const schedulesResult = await container.repositories.spacingSchedule.findAllByLearner(
    learnerIdentifier,
  );
  if (schedulesResult.isErr()) {
    return domainErrorToResponse(schedulesResult.error);
  }

  const progressResult = await container.usecases.viewProgress({ learner: learnerIdentifier });
  if (progressResult.isErr()) {
    return domainErrorToResponse(progressResult.error);
  }

  const cumulativeTrainingMinutes =
    progressResult.value.now?.cumulativeTrainingMinutes ?? 0;

  const scheduleDtos: SpacingScheduleDto[] = schedulesResult.value.map((schedule) => ({
    identifier: String(schedule.identifier),
    contrast: String(schedule.contrast),
    state: schedule.state,
    nextPresentationAt: schedule.nextPresentationAt.toISOString(),
    recentAccuracy: schedule.recentAccuracy != null ? Number(schedule.recentAccuracy) : null,
  }));

  const responseDto: TrainingScheduleDto = {
    schedules: scheduleDtos,
    cumulativeTrainingMinutes,
  };

  return successResponse(responseDto, 200);
}
