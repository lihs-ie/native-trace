/**
 * OSS Worker リクエストマッパー。
 * acl.md §8.2 の multipart/form-data リクエストを組み立てる。
 */

import { type AssessPronunciationInput } from "../../../usecase/port/pronunciation-assessment-engine";

/**
 * AssessPronunciationInput から OSS Worker への multipart/form-data リクエストを構築する。
 * metadata パートと audio パートの 2 パートで構成する。
 */
export const buildOssWorkerRequest = (
  input: AssessPronunciationInput,
  workerApiEndpoint: string,
): { url: string; body: FormData } => {
  const metadataJson = {
    analysisJob: String(input.analysisJob),
    analysisRun: String(input.analysisRun),
    recordingAttempt: String(input.recordingAttempt),
    section: String(input.section),
    sectionBodyText: input.sectionBodyText,
    expectedLanguage: "en-US" as const,
    targetAccent: "generalAmerican" as const,
    requestedMetrics: [
      "overall",
      "accuracy",
      "nativeLikeness",
      "pronunciation",
      "connectedSpeech",
      "prosody",
    ],
    assessmentSchemaVersion: input.assessmentSchemaVersion,
    tokenizerVersion: input.tokenizerVersion,
    audio: {
      mimeType: input.audioMimeType,
      byteLength: input.audioByteLength,
      durationMilliseconds: input.audioDurationMilliseconds,
    },
  };

  const formData = new FormData();

  // metadata パート: application/json; charset=utf-8
  const metadataBlob = new Blob([JSON.stringify(metadataJson)], {
    type: "application/json; charset=utf-8",
  });
  formData.append("metadata", metadataBlob);

  // audio パート: 音声 binary
  // Buffer<ArrayBufferLike> は BlobPart に直接代入できないため Uint8Array へ包む。
  const audioBlob = new Blob([new Uint8Array(input.audioBuffer)], { type: input.audioMimeType });
  formData.append("audio", audioBlob);

  const url = `${workerApiEndpoint}/v1/pronunciation-assessments`;

  return { url, body: formData };
};
