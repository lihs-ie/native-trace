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

  // 低品質音声の graceful 扱い: worker が status="low_quality" を返す、または発話がほぼ検出されず
  // segments が空のとき、schema hard fail にせず low_quality_audio エンジン失敗として返す。
  // run-assessment-job が reason==="low_quality_audio" を errorCode に写像し、UI が再録音導線を出す。
  // nonRetryable: 同じ音声を再解析しても結果は変わらないためリトライで run を滞留させない。
  if (parsed.data.status === "low_quality" || parsed.data.segments.length === 0) {
    return err(
      assessmentEngineFailed(String(input.engine.type), "low_quality_audio", "nonRetryable"),
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
      intelligibility: response.scores.intelligibility,
      cefrOverall: response.scores.cefrOverall,
      cefrSegmental: response.scores.cefrSegmental,
      cefrProsodic: response.scores.cefrProsodic,
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
      detectedTopCandidate: finding.detectedTopCandidate,
      nBest: finding.nBest,
      matchesL1Pattern: finding.matchesL1Pattern,
      functionalLoad: finding.functionalLoad,
      catalogId: finding.catalogId,
      wordPair: finding.wordPair,
      expectedPronunciation: finding.expectedPronunciation,
      insertedVowel: finding.insertedVowel,
      insertionPositionMs: finding.insertionPositionMs ?? null,
      feedbackLayers: null,
      dismissed: false,
      wordPositionLabel: finding.wordPositionLabel,
      acousticEvidence:
        finding.acousticEvidence != null
          ? {
              tongueHeight: finding.acousticEvidence.tongueHeight ?? null,
              tongueBackness: finding.acousticEvidence.tongueBackness ?? null,
              rhoticity: finding.acousticEvidence.rhoticity ?? null,
              sibilantPlace: finding.acousticEvidence.sibilantPlace ?? null,
              vowelLength: finding.acousticEvidence.vowelLength ?? null,
              measuredF1Hz: finding.acousticEvidence.measuredF1Hz ?? null,
              measuredF2Hz: finding.acousticEvidence.measuredF2Hz ?? null,
              measuredF3Hz: finding.acousticEvidence.measuredF3Hz ?? null,
              targetF1Hz: finding.acousticEvidence.targetF1Hz ?? null,
              targetF2Hz: finding.acousticEvidence.targetF2Hz ?? null,
              targetF3Hz: finding.acousticEvidence.targetF3Hz ?? null,
            }
          : null,
      // M-AAI-13 (ADR-019): articulatoryEstimate を mapper で転写。欠落時は null（ADR-017 再発防止）。
      articulatoryEstimate: finding.articulatoryEstimate ?? null,
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
    perPhonemeGop: response.perPhonemeGop,
    focusSounds: response.focusSounds,
    prosody: response.prosody
      ? {
          f0Contour: response.prosody.f0Contour,
          referenceF0Contour: response.prosody.referenceF0Contour,
          wordStress: response.prosody.wordStress,
          rhythmNpvi: response.prosody.rhythmNpvi,
          referenceNpvi: response.prosody.referenceNpvi,
          weakFormRate: response.prosody.weakFormRate,
        }
      : null,
    engineSummaryMessageJa: response.engineSummaryMessageJa,
  };

  return ok(draft);
};
