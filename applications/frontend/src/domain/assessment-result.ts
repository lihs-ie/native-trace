import { err, ok } from "neverthrow";
import { type Result } from "neverthrow";
import { type DomainError, type NonEmptyList, validationFailed } from "./shared";
import { type AnalysisJobIdentifier } from "./analysis-job";

declare const __brand: unique symbol;
type Brand<T, B> = T & { readonly [__brand]: B };

export type AssessmentResultIdentifier = Brand<string, "AssessmentResultIdentifier">;
export type AssessmentFindingIdentifier = Brand<string, "AssessmentFindingIdentifier">;
export type Score0To100 = Brand<number, "Score0To100">;
export type Confidence0To1 = Brand<number, "Confidence0To1">;
export type TokenizerVersion = Brand<string, "TokenizerVersion">;

export const createAssessmentResultIdentifier = (
  value: string,
): AssessmentResultIdentifier | null =>
  value.trim().length > 0 ? (value as AssessmentResultIdentifier) : null;

export const createAssessmentFindingIdentifier = (
  value: string,
): AssessmentFindingIdentifier | null =>
  value.trim().length > 0 ? (value as AssessmentFindingIdentifier) : null;

export const createScore0To100 = (value: number): Result<Score0To100, DomainError> => {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    return err(validationFailed("score", "スコアは0から100の整数である必要があります"));
  }
  return ok(value as Score0To100);
};

export const createConfidence0To1 = (value: number): Result<Confidence0To1, DomainError> => {
  if (value < 0 || value > 1) {
    return err(validationFailed("confidence", "信頼度は0以上1以下である必要があります"));
  }
  return ok(value as Confidence0To1);
};

export const createTokenizerVersion = (value: string): TokenizerVersion | null =>
  value.trim().length > 0 ? (value as TokenizerVersion) : null;

export const FindingCategory = {
  ACCURACY: "accuracy",
  PRONUNCIATION: "pronunciation",
  CONNECTED_SPEECH: "connectedSpeech",
  PROSODY: "prosody",
  NATIVE_LIKENESS: "nativeLikeness",
} as const;
export type FindingCategory = (typeof FindingCategory)[keyof typeof FindingCategory];

export const FindingSeverity = {
  CRITICAL: "critical",
  MAJOR: "major",
  MINOR: "minor",
  SUGGESTION: "suggestion",
} as const;
export type FindingSeverity = (typeof FindingSeverity)[keyof typeof FindingSeverity];

export type TextRange = Readonly<{
  startOffset: number;
  endOffset: number;
}>;
export type AudioRange = Readonly<{
  startMilliseconds: number;
  endMilliseconds: number;
}>;

export const createTextRange = (start: number, end: number): Result<TextRange, DomainError> => {
  if (start >= end || start < 0)
    return err(
      validationFailed("textRange", "textRangeのstartはendより小さく0以上である必要があります"),
    );
  return ok({ startOffset: start, endOffset: end });
};

export const createAudioRange = (start: number, end: number): Result<AudioRange, DomainError> => {
  if (start >= end || start < 0)
    return err(
      validationFailed("audioRange", "audioRangeのstartはendより小さく0以上である必要があります"),
    );
  return ok({ startMilliseconds: start, endMilliseconds: end });
};

export type PronunciationEvidence = Readonly<{
  text: string | null;
  ipa: string | null;
}>;

export type AssessmentFinding = Readonly<{
  identifier: AssessmentFindingIdentifier;
  category: FindingCategory;
  severity: FindingSeverity;
  textRange: TextRange;
  audioRange: AudioRange | null;
  expected: PronunciationEvidence;
  detected: PronunciationEvidence;
  messageJa: string;
  messageEn: string | null;
  scoreImpact: number;
  confidence: Confidence0To1;
}>;

export type AssessmentSegment = Readonly<{
  textRange: TextRange;
  audioRange: AudioRange | null;
  transcript: string | null;
  confidence: number;
}>;

export type ScoreSet = Readonly<{
  overall: Score0To100;
  accuracy: Score0To100;
  nativeLikeness: Score0To100;
  pronunciation: Score0To100;
  connectedSpeech: Score0To100;
  prosody: Score0To100;
}>;

export type AssessmentSummary = Readonly<{
  overallCommentJa: string;
  overallCommentEn: string | null;
}>;

export type AssessmentEngineMetadata = Readonly<{
  engineName: string;
  engineVersion: string;
  modelName: string | null;
  promptVersion: string | null;
  schemaVersion: string;
}>;

export type AnalysisEngineSnapshot = Readonly<{
  type: "cloud" | "oss_worker";
  identifier: string;
  displayName: string;
  modelName: string | null;
}>;

export type UnknownEngineRawResult = Readonly<{ data: unknown }>;

export type AssessmentResult = Readonly<{
  identifier: AssessmentResultIdentifier;
  analysisJob: AnalysisJobIdentifier;
  scores: ScoreSet;
  summary: AssessmentSummary;
  findings: ReadonlyArray<AssessmentFinding>;
  segments: NonEmptyList<AssessmentSegment>;
  metadata: AssessmentEngineMetadata;
  tokenizerVersion: TokenizerVersion;
  raw: UnknownEngineRawResult;
  engineSnapshot: AnalysisEngineSnapshot;
  createdAt: Date;
}>;

export type AssessmentResultCreated = Readonly<{
  type: "assessmentResultCreated";
  assessmentResult: AssessmentResult;
  analysisJob: AnalysisJobIdentifier;
  occurredAt: Date;
}>;

export type CreateAssessmentResultOutput = Readonly<{
  assessmentResult: AssessmentResult;
  events: NonEmptyList<AssessmentResultCreated>;
}>;

export const createAssessmentResult = (
  input: Readonly<{
    identifier: AssessmentResultIdentifier;
    analysisJob: AnalysisJobIdentifier;
    scores: ScoreSet;
    summary: AssessmentSummary;
    findings: ReadonlyArray<AssessmentFinding>;
    segments: NonEmptyList<AssessmentSegment>;
    metadata: AssessmentEngineMetadata;
    tokenizerVersion: TokenizerVersion;
    raw: UnknownEngineRawResult;
    engineSnapshot: AnalysisEngineSnapshot;
    now: Date;
  }>,
): CreateAssessmentResultOutput => {
  const assessmentResult: AssessmentResult = {
    identifier: input.identifier,
    analysisJob: input.analysisJob,
    scores: input.scores,
    summary: input.summary,
    findings: input.findings,
    segments: input.segments,
    metadata: input.metadata,
    tokenizerVersion: input.tokenizerVersion,
    raw: input.raw,
    engineSnapshot: input.engineSnapshot,
    createdAt: input.now,
  };
  return {
    assessmentResult,
    events: [
      {
        type: "assessmentResultCreated",
        assessmentResult,
        analysisJob: input.analysisJob,
        occurredAt: input.now,
      },
    ],
  };
};
