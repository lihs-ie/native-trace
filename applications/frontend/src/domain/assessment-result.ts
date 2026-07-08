import { err, ok } from "neverthrow";
import { type Result } from "neverthrow";
import {
  type Brand,
  type DomainError,
  type NonEmptyList,
  createNonEmptyBrandedString,
  validationFailed,
} from "./shared";
import { type AnalysisJobIdentifier, type EngineType } from "./analysis-job";

export type AssessmentResultIdentifier = Brand<string, "AssessmentResultIdentifier">;
export type AssessmentFindingIdentifier = Brand<string, "AssessmentFindingIdentifier">;
export type Score0To100 = Brand<number, "Score0To100">;
export type Confidence0To1 = Brand<number, "Confidence0To1">;
export type TokenizerVersion = Brand<string, "TokenizerVersion">;

export const createAssessmentResultIdentifier = (
  value: string,
): AssessmentResultIdentifier | null =>
  createNonEmptyBrandedString<AssessmentResultIdentifier>(value);

export const createAssessmentFindingIdentifier = (
  value: string,
): AssessmentFindingIdentifier | null =>
  createNonEmptyBrandedString<AssessmentFindingIdentifier>(value);

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
  createNonEmptyBrandedString<TokenizerVersion>(value);

export const FindingPhenomenon = {
  SUBSTITUTION: "substitution",
  OMISSION: "omission",
  INSERTION: "insertion",
  CONNECTED_SPEECH: "connectedSpeech",
  WEAK_FORM: "weakForm",
  LINKING: "linking",
  FLAP: "flap",
  ASSIMILATION: "assimilation",
  REDUCTION: "reduction",
  EPENTHESIS: "epenthesis",
  LEXICAL_STRESS: "lexicalStress",
} as const;
export type FindingPhenomenon = (typeof FindingPhenomenon)[keyof typeof FindingPhenomenon];

export const isValidFindingPhenomenon = (value: string): value is FindingPhenomenon =>
  Object.values(FindingPhenomenon).includes(value as FindingPhenomenon);

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

/** severity 重篤度順（数値が大きいほど重篤）。critical > major > minor > suggestion。 */
export const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  critical: 4,
  major: 3,
  minor: 2,
  suggestion: 1,
};

export type TextRange = Readonly<{
  startOffset: number;
  endOffset: number;
}>;
export type AudioRange = Readonly<{
  startMilliseconds: number;
  endMilliseconds: number;
}>;

export type PronunciationEvidence = Readonly<{
  text: string | null;
  ipa: string | null;
}>;

export type NBestCandidate = Readonly<{
  phoneme: string;
  confidence: number;
}>;

export type FeedbackLayers = Readonly<{
  whatJa: string;
  whyJa: string;
  howJa: string;
}>;

/**
 * M-AAI-12 (ADR-019): EMA 調音推定座標 + 表示適格性スコアのドメイン型。
 * 座標は発話内 z-score 正規化後 [-1,1] クランプ済み（生 mm ではない）。
 * displayEligibility = validFrameRatio × voicingRatio × durationAdequacy ([0,1])。
 */
export type ArticulatoryEstimate = Readonly<{
  tongueTipX: number;
  tongueTipY: number;
  tongueDorsumX: number;
  tongueDorsumY: number;
  lipApertureX: number;
  lipApertureY: number;
  displayEligibility: number;
}>;

export type AssessmentFinding = Readonly<{
  identifier: AssessmentFindingIdentifier;
  phenomenon: FindingPhenomenon | null;
  gop: number | null;
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
  /** C3-a: NBest最有力候補 IPA */
  detectedTopCandidate: string | null;
  /** C3-a: 上位3件候補 */
  nBest: ReadonlyArray<NBestCandidate> | null;
  /** C3-a: L1パターン一致フラグ */
  matchesL1Pattern: boolean;
  /** C3-a: functionalLoadランク */
  functionalLoad: string | null;
  /** C3-a: カタログID */
  catalogId: string | null;
  /** C3-a: connected speech対象語ペア */
  wordPair: Readonly<{ first: string; second: string }> | null;
  /** C3-a: connected speech期待発音IPA */
  expectedPronunciation: string | null;
  /** C3-a: epenthesis挿入母音 */
  insertedVowel: string | null;
  /** D4 (ADR-017): epenthesis挿入母音の時刻位置（ミリ秒）*/
  insertionPositionMs: number | null;
  /** M-104: 3層フィードバック文 */
  feedbackLayers: FeedbackLayers | null;
  /** C4-b: 却下フラグ (この Wave では false 固定) */
  dismissed: boolean;
  /** M-104R-b: 語内位置ラベル ("initial"|"medial"|"final"|null) */
  wordPositionLabel: string | null;
  /** M-AAI-12 (ADR-019): EMA 調音推定座標。null は AAI 不在/ガードレール未達 = floor のみ描画。*/
  articulatoryEstimate: ArticulatoryEstimate | null;
}>;

export type AssessmentSegment = Readonly<{
  textRange: TextRange;
  audioRange: AudioRange | null;
  transcript: string | null;
  confidence: number;
}>;

/** C3-b: CEFR 音韻統制の下位尺度（score + バンド表記） */
export type CefrSubscale = Readonly<{
  score: number;
  band: string;
}>;

export type ScoreSet = Readonly<{
  overall: Score0To100;
  accuracy: Score0To100;
  nativeLikeness: Score0To100;
  pronunciation: Score0To100;
  connectedSpeech: Score0To100;
  prosody: Score0To100;
  /** C3-b: FL 重み付き明瞭性スコア（Stage I）。旧データ互換のため null 許容。 */
  intelligibility: Score0To100 | null;
  /** C3-b: CEFR 全体的音韻統制 */
  cefrOverall: CefrSubscale | null;
  /** C3-b: CEFR 分節音の調音 */
  cefrSegmental: CefrSubscale | null;
  /** C3-b: CEFR 韻律 */
  cefrProsodic: CefrSubscale | null;
}>;

/** C3-c: 全音素 GOP ヒートマップの 1 エントリ */
export type PerPhonemeGopEntry = Readonly<{
  word: string;
  phoneme: string;
  gop: number;
  heat: number;
}>;

/** C3-c: focus sound（FL × 頻度 × 習熟度から導く優先音素） */
export type FocusSound = Readonly<{
  pair: string;
  phenomenon: string | null;
  functionalLoad: string;
  occurrences: number;
  priority: string;
  reasonJa: string;
  catalogId: string | null;
}>;

/** C3-c: 韻律生データ（F0 輪郭・語強勢・リズム・弱形実現率） */
export type ProsodyData = Readonly<{
  f0Contour: Readonly<{ timesMs: ReadonlyArray<number>; valuesHz: ReadonlyArray<number> }> | null;
  /** M-F0REF-c: お手本 F0 輪郭（f0Contour と同形。analyzer が返さない場合は null） */
  referenceF0Contour: Readonly<{
    timesMs: ReadonlyArray<number>;
    valuesHz: ReadonlyArray<number>;
  }> | null;
  wordStress: ReadonlyArray<
    Readonly<{ word: string; wordIndex: number; expectedStress: number; predictedStress: number }>
  > | null;
  rhythmNpvi: number | null;
  referenceNpvi: number | null;
  weakFormRate: number | null;
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
  type: EngineType;
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
  /** C3-c: 全音素 GOP ヒートマップ系列（閾値未満の音素も含む。旧データ互換で null） */
  perPhonemeGop: ReadonlyArray<PerPhonemeGopEntry> | null;
  /** C3-c: focus sounds（漸進更新） */
  focusSounds: ReadonlyArray<FocusSound> | null;
  /** C3-c: 韻律生データ */
  prosody: ProsodyData | null;
  /** C3-c / M-107b: エンジン別動的サマリー文 */
  engineSummaryMessageJa: string | null;
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
    perPhonemeGop?: ReadonlyArray<PerPhonemeGopEntry> | null;
    focusSounds?: ReadonlyArray<FocusSound> | null;
    prosody?: ProsodyData | null;
    engineSummaryMessageJa?: string | null;
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
    perPhonemeGop: input.perPhonemeGop ?? null,
    focusSounds: input.focusSounds ?? null,
    prosody: input.prosody ?? null,
    engineSummaryMessageJa: input.engineSummaryMessageJa ?? null,
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
