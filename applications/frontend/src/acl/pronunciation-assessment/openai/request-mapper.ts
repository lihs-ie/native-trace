/**
 * OpenAI リクエストマッパー。
 * acl.md §7.2: マルチモーダル音声入力 + Structured Outputs の 1 段構成。
 * acl.md §7.4: OpenAI 固有入力制限の事前検証。
 */

import { ok, err, type Result } from "neverthrow";
import { type AssessPronunciationInput } from "../../../usecase/port/pronunciation-assessment-engine";
import { type DomainError } from "../../../domain/shared";
import { assessmentEngineFailed } from "../shared/errors";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompts/v1";
import { OPENAI_ASSESSMENT_JSON_SCHEMA } from "./schema";

/** OpenAI が対応する音声 MIME type (acl.md §7.4) */
const SUPPORTED_OPENAI_MIME_TYPES = [
  "audio/wav",
  "audio/mp3",
  "audio/mpeg",
  "audio/mp4",
  "audio/webm",
  "audio/ogg",
  "audio/flac",
] as const;

/** OpenAI 音声ファイルサイズ上限: 25MB */
const OPENAI_MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export type OpenAiRequestPayload = Readonly<{
  model: string;
  systemPrompt: string;
  userMessage: string;
  audioBuffer: Buffer;
  audioMimeType: string;
  assessmentSchemaVersion: string;
  tokenizerVersion: string;
  responseFormat: typeof OPENAI_ASSESSMENT_JSON_SCHEMA;
}>;

/**
 * AssessPronunciationInput から OpenAI リクエストペイロードを組み立てる。
 * 固有制限を事前検証し、違反は nonRetryable エラーを返す。
 */
export const buildOpenAiRequest = (
  input: AssessPronunciationInput,
  model: string,
): Result<OpenAiRequestPayload, DomainError> => {
  // MIME type 検証
  const mimeTypeSupported = (SUPPORTED_OPENAI_MIME_TYPES as readonly string[]).includes(
    input.audioMimeType,
  );
  if (!mimeTypeSupported) {
    return err(
      assessmentEngineFailed(
        "cloud",
        `Unsupported audio MIME type for OpenAI: ${input.audioMimeType}`,
        "nonRetryable",
      ),
    );
  }

  // ファイルサイズ検証
  if (input.audioByteLength > OPENAI_MAX_AUDIO_BYTES) {
    return err(
      assessmentEngineFailed(
        "cloud",
        `Audio file size ${input.audioByteLength} bytes exceeds OpenAI limit of ${OPENAI_MAX_AUDIO_BYTES} bytes`,
        "nonRetryable",
      ),
    );
  }

  return ok({
    model,
    systemPrompt: SYSTEM_PROMPT,
    userMessage: buildUserMessage(input.sectionBodyText),
    audioBuffer: input.audioBuffer,
    audioMimeType: input.audioMimeType,
    assessmentSchemaVersion: input.assessmentSchemaVersion,
    tokenizerVersion: input.tokenizerVersion,
    responseFormat: OPENAI_ASSESSMENT_JSON_SCHEMA,
  });
};
