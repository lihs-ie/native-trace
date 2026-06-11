/**
 * OSS Worker Pronunciation Assessment Adaptor。
 * acl.md §8 に準拠。
 * HTTP fetch (globalThis.fetch) を使って OSS Worker API に multipart/form-data でリクエストを送る。
 * クラス構文禁止。factory + plain object で PronunciationAssessmentEngine を返す。
 */

import { okAsync, errAsync, fromPromise } from "neverthrow";
import { type ResultAsync } from "neverthrow";
import { type PronunciationAssessmentEngine, type AssessPronunciationInput } from "../../../usecase/port/pronunciation-assessment-engine";
import { type AssessmentResultDraft } from "../../../usecase/assessment-result-draft";
import { type DomainError } from "../../../domain/shared";
import { type Clock } from "../../../usecase/port/clock";
import { type Logger } from "../../../usecase/port/logger";
import {
  assessmentEngineFailed,
  classifyFetchError,
} from "../shared/errors";
import { buildOssWorkerRequest } from "./request-mapper";
import { mapOssWorkerResponse } from "./response-mapper";

export type OssWorkerPronunciationAssessmentAdaptorDependencies = Readonly<{
  workerApiEndpoint: string;
  clock: Clock;
  logger: Logger;
}>;

/**
 * OssWorkerPronunciationAssessmentAdaptor ファクトリ。
 * acl.md §1.4: suffix は Adaptor に統一。クラス構文は使用しない。
 */
export const createOssWorkerPronunciationAssessmentAdaptor = (
  dependencies: OssWorkerPronunciationAssessmentAdaptorDependencies,
): PronunciationAssessmentEngine => ({
  assess: (input: AssessPronunciationInput): ResultAsync<AssessmentResultDraft, DomainError> => {
    const { url, body } = buildOssWorkerRequest(input, dependencies.workerApiEndpoint);
    const capturedAt = dependencies.clock.now();

    dependencies.logger.info("OssWorkerAdaptor: sending request", {
      analysisJob: String(input.analysisJob),
      url,
    });

    return fromPromise(
      globalThis
        .fetch(url, { method: "POST", body })
        .then(async (response) => {
          const status = response.status;
          let rawBody: unknown;
          try {
            rawBody = await (response.json() as Promise<unknown>);
          } catch {
            rawBody = null;
          }
          return { status, rawBody };
        }),
      (fetchError): DomainError =>
        assessmentEngineFailed(
          "oss_worker",
          fetchError instanceof Error ? fetchError.message : String(fetchError),
          classifyFetchError(fetchError),
        ),
    ).andThen(({ status, rawBody }) => {
      const result = mapOssWorkerResponse({
        status,
        rawBody,
        capturedAt,
        engine: input.engine,
        assessmentSchemaVersion: input.assessmentSchemaVersion,
        tokenizerVersion: input.tokenizerVersion,
      });

      if (result.isErr()) {
        dependencies.logger.error("OssWorkerAdaptor: failed", result.error);
        return errAsync(result.error);
      }

      dependencies.logger.info("OssWorkerAdaptor: assessment succeeded", {
        analysisJob: String(input.analysisJob),
      });

      return okAsync(result.value);
    });
  },
});
