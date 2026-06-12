/**
 * OpenAI レスポンスマッパー。
 * OpenAI response → AssessmentResultDraft 変換。
 * acl.md §7.5: schema 違反・category 変換不能・textRange 不正・version 不一致は nonRetryable。
 * acl.md §5.4: audioRange は OpenAI が秒小数を返すのでミリ秒整数へ変換。
 */

import { ok, err, type Result } from "neverthrow";
import {
  type AssessmentResultDraft,
  type AssessmentEngineMetadataDraft,
  RawEngineResponseProvider,
  createAssessmentSchemaVersion,
  createScoringRubricVersion,
  createInstant,
} from "../../../usecase/assessment-result-draft";
import { type AnalysisEngine } from "../../../domain/analysis-engine";
import { type DomainError } from "../../../domain/shared";
import { buildStoredRawEngineResponse } from "../shared/stored-raw-engine-response";
import { assessmentSchemaInvalid } from "../shared/errors";
import { openAiAssessmentResponseSchema, type OpenAiAssessmentResponse } from "./schema";
import { PROMPT_VERSION } from "./prompts/v1";

/** スコアリングルーブリックのバージョン（prompt v1 に対応する固定値） */
const SCORING_RUBRIC_VERSION = "v1";

/**
 * OpenAI Structured Outputs のレスポンス JSON を AssessmentResultDraft へ変換する。
 */
export const mapOpenAiResponse = (
  input: Readonly<{
    rawResponseContent: unknown;
    capturedAt: Date;
    engine: AnalysisEngine;
    model: string;
    assessmentSchemaVersion: string;
    tokenizerVersion: string;
  }>,
): Result<AssessmentResultDraft, DomainError> => {
  const capturedAt = createInstant(input.capturedAt);
  const rawResponse = buildStoredRawEngineResponse({
    provider: RawEngineResponseProvider.OPENAI,
    capturedAt,
    responseBody: input.rawResponseContent,
  });

  // Zod 検証
  const parsed = openAiAssessmentResponseSchema.safeParse(input.rawResponseContent);
  if (!parsed.success) {
    return err(
      assessmentSchemaInvalid(`OpenAI response schema validation failed: ${parsed.error.message}`),
    );
  }

  return mapValidatedResponse({
    response: parsed.data,
    rawResponse,
    engine: input.engine,
    model: input.model,
  });
};

const mapValidatedResponse = (
  input: Readonly<{
    response: OpenAiAssessmentResponse;
    rawResponse: ReturnType<typeof buildStoredRawEngineResponse>;
    engine: AnalysisEngine;
    model: string;
  }>,
): Result<AssessmentResultDraft, DomainError> => {
  const { response, rawResponse, engine, model } = input;

  const schemaVersion = createAssessmentSchemaVersion(response.assessmentSchemaVersion);
  if (!schemaVersion) {
    return err(assessmentSchemaInvalid("assessmentSchemaVersion が空です"));
  }

  const rubricVersion = createScoringRubricVersion(SCORING_RUBRIC_VERSION);
  if (!rubricVersion) {
    return err(assessmentSchemaInvalid("scoringRubricVersion が空です"));
  }

  const promptVersion = PROMPT_VERSION;

  const metadata: AssessmentEngineMetadataDraft = {
    assessmentSchemaVersion: schemaVersion,
    scoringRubricVersion: rubricVersion,
    promptVersion: promptVersion as ReturnType<
      typeof import("../../../usecase/assessment-result-draft").createPromptVersion
    >,
    model,
    workerVersion: null,
    modelVersion: null,
    ruleSetVersion: null,
    engineSpecific: {},
  };

  const draft: AssessmentResultDraft = {
    engine,
    // OpenAI は採点ステータスを持たないため常に "normal"
    status: "normal",
    scores: {
      overall: response.scores.overall,
      accuracy: response.scores.accuracy,
      nativeLikeness: response.scores.nativeLikeness,
      pronunciation: response.scores.pronunciation,
      connectedSpeech: response.scores.connectedSpeech,
      prosody: response.scores.prosody,
      // OpenAI は二段階ゴール / CEFR 内訳を返さない（空状態。偽データを入れない）
      intelligibility: null,
      cefrOverall: null,
      cefrSegmental: null,
      cefrProsodic: null,
    },
    findings: response.findings.map((finding) => ({
      phenomenon: null,
      gop: null,
      category: finding.category,
      severity: finding.severity,
      textRange: {
        startChar: finding.textRange.startChar,
        endChar: finding.textRange.endChar,
      },
      audioRange: finding.audioRange
        ? {
            // acl.md §5.4: 秒小数 → ミリ秒整数へ変換
            startMs: Math.round(finding.audioRange.startSeconds * 1000),
            endMs: Math.round(finding.audioRange.endSeconds * 1000),
          }
        : null,
      expected: { text: finding.expected.text, ipa: finding.expected.ipa },
      detected: { text: finding.detected.text, ipa: finding.detected.ipa },
      messageJa: finding.messageJa,
      messageEn: finding.messageEn,
      scoreImpact: finding.scoreImpact,
      confidence: finding.confidence,
      // OpenAI は NBest / FL / カタログ / connected speech 詳細を返さない（空状態）
      detectedTopCandidate: null,
      nBest: null,
      matchesL1Pattern: false,
      functionalLoad: null,
      catalogId: null,
      wordPair: null,
      expectedPronunciation: null,
      insertedVowel: null,
      feedbackLayers: null,
      dismissed: false,
    })),
    segments: response.segments.map((segment) => ({
      textRange: {
        startChar: segment.textRange.startChar,
        endChar: segment.textRange.endChar,
      },
      audioRange: {
        // acl.md §5.4: 秒小数 → ミリ秒整数へ変換
        startMs: Math.round(segment.audioRange.startSeconds * 1000),
        endMs: Math.round(segment.audioRange.endSeconds * 1000),
      },
      transcript: segment.transcript,
      confidence: segment.confidence,
    })),
    summary: {
      messageJa: response.summary.messageJa,
      messageEn: response.summary.messageEn ?? null,
    },
    rawResponse,
    metadata,
    tokenizerVersion: response.tokenizerVersion,
    // OpenAI は全音素 GOP / focus sounds / 韻律生データ / 動的サマリーを返さない（空状態）
    perPhonemeGop: null,
    focusSounds: null,
    prosody: null,
    engineSummaryMessageJa: null,
  };

  return ok(draft);
};
