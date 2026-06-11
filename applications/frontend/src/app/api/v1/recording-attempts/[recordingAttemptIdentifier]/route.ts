/**
 * API-014: DELETE /api/v1/recording-attempts/{recordingAttemptIdentifier} — 録音試行削除
 */

import { type NextRequest } from "next/server";
import { getContainer } from "../../../../../registry";
import { successResponse } from "../../_shared/response";
import { domainErrorToResponse } from "../../_shared/errors";

type RouteContext = { params: Promise<{ recordingAttemptIdentifier: string }> };

export async function DELETE(_request: NextRequest, context: RouteContext): Promise<Response> {
  const { recordingAttemptIdentifier } = await context.params;

  const container = getContainer();
  const result = await container.usecases.discardRecordingAttempt({
    recordingAttempt: recordingAttemptIdentifier,
  });

  if (result.isErr()) {
    return domainErrorToResponse(result.error);
  }

  const output = result.value;
  return successResponse({
    identifier: output.recordingAttempt.identifier,
    status: "deleted",
    physicalAudioDeletion: {
      status: output.audioPhysicallyDeleted ? "succeeded" : "failed",
    },
  });
}
