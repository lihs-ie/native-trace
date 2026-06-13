/**
 * OSS Worker ShadowingLag Adaptor。
 * ShadowingLagClient port の infrastructure 実装。
 * worker `POST /v1/pronunciation-assessments/shadowing` へ multipart/form-data で送信する。
 *
 * acl.md §8 に準拠。クラス構文禁止。factory + plain object。
 * 層依存方向: acl → usecase/port (acl が port 型を import する設計を維持)。
 */

import { fromPromise } from "neverthrow";
import { type ResultAsync } from "neverthrow";
import {
  type ShadowingLagClient,
  type ShadowingLagInput,
  type ShadowingLagResult,
} from "../../../usecase/port/shadowing-lag-client";
import { type DomainError } from "../../../domain/shared";
import { assessmentEngineFailed, classifyFetchError } from "../shared/errors";
import { mapShadowingLagResponse } from "./shadowing-response-mapper";

export type OssWorkerShadowingLagAdaptorDependencies = Readonly<{
  workerApiEndpoint: string;
  timeoutMilliseconds: number;
}>;

/**
 * createOssWorkerShadowingLagAdaptor — ShadowingLagClient ファクトリ。
 * worker `POST /v1/pronunciation-assessments/shadowing` に multipart で
 * reference_audio + learner_audio + metadata を送信し ShadowingLagResult を返す。
 */
export const createOssWorkerShadowingLagAdaptor = (
  dependencies: OssWorkerShadowingLagAdaptorDependencies,
): ShadowingLagClient => ({
  computeLag: (input: ShadowingLagInput): ResultAsync<ShadowingLagResult, DomainError> => {
    const url = `${dependencies.workerApiEndpoint}/v1/pronunciation-assessments/shadowing`;

    const formData = new FormData();

    // reference_audio パート (Uint8Array は BlobPart に直接使えないため ArrayBuffer に変換)
    const referenceAudioBlob = new Blob(
      [input.referenceAudioBytes.buffer.slice(0) as ArrayBuffer],
      { type: input.referenceAudioMimeType },
    );
    formData.append("reference_audio", referenceAudioBlob);

    // learner_audio パート
    const learnerAudioBlob = new Blob([input.learnerAudioBytes.buffer.slice(0) as ArrayBuffer], {
      type: input.learnerAudioMimeType,
    });
    formData.append("learner_audio", learnerAudioBlob);

    // metadata パート: referenceText / mimeType / durationMilliseconds
    const metadataJson = JSON.stringify({
      referenceText: input.referenceText,
      mimeType: input.referenceAudioMimeType,
      durationMilliseconds: input.durationMilliseconds,
    });
    const metadataBlob = new Blob([metadataJson], { type: "application/json; charset=utf-8" });
    formData.append("metadata", metadataBlob);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), dependencies.timeoutMilliseconds);

    return fromPromise(
      globalThis
        .fetch(url, { method: "POST", body: formData, signal: controller.signal })
        .then(async (response) => {
          clearTimeout(timeoutId);
          const status = response.status;
          let rawBody: unknown;
          try {
            rawBody = await (response.json() as Promise<unknown>);
          } catch {
            rawBody = null;
          }
          return { status, rawBody };
        })
        .catch((error: unknown) => {
          clearTimeout(timeoutId);
          throw error;
        }),
      (fetchError): DomainError =>
        assessmentEngineFailed(
          "oss_worker_shadowing",
          fetchError instanceof Error ? fetchError.message : String(fetchError),
          classifyFetchError(fetchError),
        ),
    ).andThen(({ status, rawBody }) => mapShadowingLagResponse({ status, rawBody }));
  },
});
