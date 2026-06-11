/**
 * OpenAI Pronunciation Assessment Adaptor。
 * acl.md §7 に準拠。
 * マルチモーダル音声入力 + Structured Outputs の 1 段構成。
 * クラス構文禁止。factory + plain object で PronunciationAssessmentEngine を返す。
 *
 * 実 API キーが無い環境でも build/typecheck が通るよう、
 * OpenAI client は assess 呼び出し時に遅延構築する。
 */

import OpenAI from "openai";
import {
  type ChatCompletionMessageParam,
  type ChatCompletionContentPart,
  type ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions";
import { okAsync, errAsync, fromPromise } from "neverthrow";
import { type ResultAsync } from "neverthrow";
import {
  type PronunciationAssessmentEngine,
  type AssessPronunciationInput,
} from "../../../usecase/port/pronunciation-assessment-engine";
import { type AssessmentResultDraft } from "../../../usecase/assessment-result-draft";
import { type DomainError } from "../../../domain/shared";
import { type Clock } from "../../../usecase/port/clock";
import { type Logger } from "../../../usecase/port/logger";
import { assessmentEngineFailed, assessmentSchemaInvalid } from "../shared/errors";
import { buildOpenAiRequest } from "./request-mapper";
import { mapOpenAiResponse } from "./response-mapper";

export type OpenAiPronunciationAssessmentAdaptorDependencies = Readonly<{
  /** OpenAI API キー。Config から注入する。 */
  apiKey: string;
  /** 使用モデル名 (例: gpt-4o-audio-preview)。Config から注入する。 */
  model: string;
  /** テスト時に差し替え可能な OpenAI client ファクトリ。省略時は遅延構築。 */
  openAiClientFactory?: () => OpenAI;
  clock: Clock;
  logger: Logger;
}>;

/**
 * OpenAiPronunciationAssessmentAdaptor ファクトリ。
 * acl.md §1.4: suffix は Adaptor に統一。クラス構文は使用しない。
 */
export const createOpenAiPronunciationAssessmentAdaptor = (
  dependencies: OpenAiPronunciationAssessmentAdaptorDependencies,
): PronunciationAssessmentEngine => {
  // assess 呼び出し時に OpenAI client を遅延構築する（API キーが空でも import/build は通る）
  let cachedClient: OpenAI | null = null;

  const getClient = (): OpenAI => {
    if (dependencies.openAiClientFactory) {
      return dependencies.openAiClientFactory();
    }
    if (!cachedClient) {
      cachedClient = new OpenAI({ apiKey: dependencies.apiKey });
    }
    return cachedClient;
  };

  return {
    assess: (input: AssessPronunciationInput): ResultAsync<AssessmentResultDraft, DomainError> => {
      // リクエスト組み立て（入力制限の事前検証含む）
      const requestResult = buildOpenAiRequest(input, dependencies.model);
      if (requestResult.isErr()) {
        return errAsync(requestResult.error);
      }
      const requestPayload = requestResult.value;

      const capturedAt = dependencies.clock.now();
      const client = getClient();

      dependencies.logger.info("OpenAiAdaptor: sending request", {
        analysisJob: String(input.analysisJob),
        model: requestPayload.model,
      });

      // Buffer を base64 エンコードして OpenAI multimodal API に渡す
      const audioBase64 = requestPayload.audioBuffer.toString("base64");

      // ChatCompletionMessageParam で型を明示することで input_audio content part を許容させる。
      // stream: false を明示して NonStreaming overload に解決させ、completion.choices へのアクセスを保証する。
      // input_audio を含む user content は ChatCompletionContentPart[] で明示注釈する
      // （union 推論が assistant 用 content part に誤マッチするのを防ぐ）。
      const userContent: Array<ChatCompletionContentPart> = [
        {
          type: "text",
          text: requestPayload.userMessage,
        },
        {
          type: "input_audio",
          input_audio: {
            data: audioBase64,
            format: resolveAudioFormat(requestPayload.audioMimeType),
          },
        },
      ];
      const messages: Array<ChatCompletionMessageParam> = [
        {
          role: "system",
          content: requestPayload.systemPrompt,
        },
        {
          role: "user",
          content: userContent,
        },
      ];

      const requestBody: ChatCompletionCreateParamsNonStreaming = {
        model: requestPayload.model,
        messages,
        response_format: {
          type: "json_schema",
          json_schema: requestPayload.responseFormat,
        },
        stream: false,
      };

      return fromPromise(
        client.chat.completions.create(requestBody),
        (openAiError): DomainError => {
          if (openAiError instanceof OpenAI.APIError) {
            const failureKind =
              openAiError.status === 429 || (openAiError.status >= 500 && openAiError.status < 600)
                ? "retryable"
                : "nonRetryable";
            return assessmentEngineFailed(
              "cloud",
              `OpenAI API error ${openAiError.status}: ${openAiError.message}`,
              failureKind,
            );
          }
          return assessmentEngineFailed(
            "cloud",
            openAiError instanceof Error ? openAiError.message : String(openAiError),
            "retryable",
          );
        },
      ).andThen((completion) => {
        const content = completion.choices[0]?.message?.content;
        if (!content) {
          return errAsync(assessmentSchemaInvalid("OpenAI response has no content"));
        }

        let rawParsed: unknown;
        try {
          rawParsed = JSON.parse(content);
        } catch (parseError) {
          return errAsync(
            assessmentSchemaInvalid(
              `OpenAI response JSON parse failed: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
            ),
          );
        }

        const result = mapOpenAiResponse({
          rawResponseContent: rawParsed,
          capturedAt,
          engine: input.engine,
          model: requestPayload.model,
          assessmentSchemaVersion: requestPayload.assessmentSchemaVersion,
          tokenizerVersion: requestPayload.tokenizerVersion,
        });

        if (result.isErr()) {
          dependencies.logger.error("OpenAiAdaptor: schema error", result.error);
          return errAsync(result.error);
        }

        dependencies.logger.info("OpenAiAdaptor: assessment succeeded", {
          analysisJob: String(input.analysisJob),
        });

        return okAsync(result.value);
      });
    },
  };
};

/**
 * MIME type から OpenAI audio format 文字列へ変換する。
 * acl.md §7.4 の対応 MIME type に対応。
 */
// OpenAI chat completions の input_audio は "wav" / "mp3" のみ対応する。
// それ以外のコンテナ（webm/mp4/ogg 等）は best-effort で "mp3" として送る。
// 実際に非対応なら OpenAI が API エラーを返し、nonRetryable として扱われる。
const resolveAudioFormat = (mimeType: string): "wav" | "mp3" => {
  if (mimeType.includes("wav")) return "wav";
  return "mp3";
};
