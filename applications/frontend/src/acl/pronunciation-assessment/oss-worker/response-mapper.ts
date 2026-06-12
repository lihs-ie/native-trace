/**
 * OSS Worker レスポンスマッパー。
 * Worker JSON → AssessmentResultDraft 変換。
 * Worker response は必ず Zod 検証してから変換する。
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
import {
  assessmentSchemaInvalid,
  assessmentEngineFailed,
  classifyHttpStatus,
} from "../shared/errors";
import {
  ossWorkerSuccessResponseSchema,
  ossWorkerErrorResponseSchema,
  type OssWorkerSuccessResponse,
} from "./schema";

/**
 * HTTP レスポンスを AssessmentResultDraft へ変換する。
 * 400/413/415/422 は nonRetryable、500/502/503/504 は retryable。
 */
export const mapOssWorkerResponse = (
  input: Readonly<{
    status: number;
    rawBody: unknown;
    capturedAt: Date;
    engine: AnalysisEngine;
    assessmentSchemaVersion: string;
    tokenizerVersion: string;
  }>,
): Result<AssessmentResultDraft, DomainError> => {
  const capturedAt = createInstant(input.capturedAt);
  const rawResponse = buildStoredRawEngineResponse({
    provider: RawEngineResponseProvider.OSS_WORKER,
    capturedAt,
    responseBody: input.rawBody,
  });

  // HTTP エラーレスポンス処理
  if (input.status !== 200) {
    const failureKind = classifyHttpStatus(input.status);
    // エラーレスポンス本文を Zod で検証してメッセージを取得する試み
    const errorParsed = ossWorkerErrorResponseSchema.safeParse(input.rawBody);
    const reason = errorParsed.success
      ? `HTTP ${input.status}: ${errorParsed.data.error.code} - ${errorParsed.data.error.message}`
      : `HTTP ${input.status}`;

    return err(assessmentEngineFailed(String(input.engine.type), reason, failureKind));
  }

  // 成功レスポンス Zod 検証
  const parsed = ossWorkerSuccessResponseSchema.safeParse(input.rawBody);
  if (!parsed.success) {
    return err(
      assessmentSchemaInvalid(
        `OSS Worker response schema validation failed: ${parsed.error.message}`,
      ),
    );
  }

  return mapSuccessResponse({
    response: parsed.data,
    rawResponse,
    engine: input.engine,
    requestedAssessmentSchemaVersion: input.assessmentSchemaVersion,
    requestedTokenizerVersion: input.tokenizerVersion,
  });
};

const mapSuccessResponse = (
  input: Readonly<{
    response: OssWorkerSuccessResponse;
    rawResponse: ReturnType<typeof buildStoredRawEngineResponse>;
    engine: AnalysisEngine;
    requestedAssessmentSchemaVersion: string;
    requestedTokenizerVersion: string;
  }>,
): Result<AssessmentResultDraft, DomainError> => {
  const { response, rawResponse, engine } = input;

  const schemaVersion = createAssessmentSchemaVersion(response.assessmentSchemaVersion);
  if (!schemaVersion) {
    return err(assessmentSchemaInvalid("assessmentSchemaVersion が空です"));
  }

  const rubricVersion = createScoringRubricVersion(response.metadata.scoringRubricVersion);
  if (!rubricVersion) {
    return err(assessmentSchemaInvalid("scoringRubricVersion が空です"));
  }

  const metadata: AssessmentEngineMetadataDraft = {
    assessmentSchemaVersion: schemaVersion,
    scoringRubricVersion: rubricVersion,
    promptVersion: null,
    model: null,
    workerVersion: response.metadata.workerVersion,
    modelVersion: response.metadata.modelVersion,
    ruleSetVersion: response.metadata.ruleSetVersion,
    engineSpecific: {},
  };

  const draft: AssessmentResultDraft = {
    engine,
    status: response.status,
    scores: {
      overall: response.scores.overall,
      accuracy: response.scores.accuracy,
      nativeLikeness: response.scores.nativeLikeness,
      pronunciation: response.scores.pronunciation,
      connectedSpeech: response.scores.connectedSpeech,
      prosody: response.scores.prosody,
    },
    findings: response.findings.map((finding) => ({
      phenomenon: finding.phenomenon,
      gop: finding.gop,
      category: finding.category,
      severity: finding.severity,
      textRange: {
        startChar: finding.textRange.startChar,
        endChar: finding.textRange.endChar,
      },
      audioRange: finding.audioRange
        ? { startMs: finding.audioRange.startMs, endMs: finding.audioRange.endMs }
        : null,
      expected: { text: finding.expected.text, ipa: finding.expected.ipa },
      detected: { text: finding.detected.text, ipa: finding.detected.ipa },
      messageJa: finding.messageJa,
      messageEn: finding.messageEn,
      scoreImpact: finding.scoreImpact,
      confidence: finding.confidence,
    })),
    segments: response.segments.map((segment) => ({
      textRange: {
        startChar: segment.textRange.startChar,
        endChar: segment.textRange.endChar,
      },
      audioRange: {
        startMs: segment.audioRange.startMs,
        endMs: segment.audioRange.endMs,
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
  };

  return ok(draft);
};
