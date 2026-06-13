/**
 * UseCase/ACL 境界 DTO。
 * ACL がエンジン固有出力を変換した共通解析結果案。
 * acl.md §5, §6, §9 に準拠。
 *
 * UseCase 層は ACL 層を import できないため、ACL 設計書で定義された型のうち
 * UseCase が参照する型はこのファイルに自己完結させる。
 */

import { type AnalysisEngine } from "../domain/analysis-engine";
import { type FindingCategory, type FindingSeverity } from "../domain/assessment-result";

// ---- ブランド型（ACL 境界で使うバージョン文字列）----

declare const __aclBrand: unique symbol;
type AclBrand<T, B> = T & { readonly [__aclBrand]: B };

export type AssessmentSchemaVersion = AclBrand<string, "AssessmentSchemaVersion">;
export type ScoringRubricVersion = AclBrand<string, "ScoringRubricVersion">;
export type PromptVersion = AclBrand<string, "PromptVersion">;
/** ISO 8601 文字列で表現した時刻 */
export type Instant = AclBrand<string, "Instant">;

export const createAssessmentSchemaVersion = (value: string): AssessmentSchemaVersion | null =>
  value.trim().length > 0 ? (value as AssessmentSchemaVersion) : null;

export const createScoringRubricVersion = (value: string): ScoringRubricVersion | null =>
  value.trim().length > 0 ? (value as ScoringRubricVersion) : null;

export const createPromptVersion = (value: string): PromptVersion | null =>
  value.trim().length > 0 ? (value as PromptVersion) : null;

export const createInstant = (date: Date): Instant => date.toISOString() as Instant;

// ---- StoredRawEngineResponse (acl.md §6) ----

/** レスポンス提供元の識別子 */
export const RawEngineResponseProvider = {
  OPENAI: "openai",
  OSS_WORKER: "ossWorker",
} as const;

export type RawEngineResponseProvider =
  (typeof RawEngineResponseProvider)[keyof typeof RawEngineResponseProvider];

/**
 * 外部エンジンのレスポンスを保存用に包むエンベロープ。
 * body は 1MB 以下に切り詰め済み。API key・request header・ローカルパスを含まない。
 */
export type StoredRawEngineResponse = Readonly<{
  provider: RawEngineResponseProvider;
  capturedAt: Instant;
  contentType: "application/json" | "text/plain";
  body: unknown;
  truncated: boolean;
  originalSizeBytes: number;
  storedSizeBytes: number;
}>;

// ---- テキスト/音声範囲 Draft 型 ----
// Domain 層の TextRange / AudioRange とフィールド名が異なるため ACL 境界専用型として定義する。
// textRange: startChar(inclusive) / endChar(exclusive)、UTF-16 code unit offset。
// audioRange: startMs(inclusive) / endMs(exclusive)、ミリ秒整数。

export type TextRangeDraft = Readonly<{
  startChar: number;
  endChar: number;
}>;

export type AudioRangeDraft = Readonly<{
  startMs: number;
  endMs: number;
}>;

// ---- スコア ----

/** 6 項目スコアセット（0–100 整数、未検証の数値）。UseCase が整数・範囲を検証する。 */
export type ScoreDraftSet = Readonly<{
  overall: number;
  accuracy: number;
  nativeLikeness: number;
  pronunciation: number;
  connectedSpeech: number;
  prosody: number;
  /** C3-b: FL重み付き明瞭性スコア 0-100 */
  intelligibility: number | null;
  /** C3-b: CEFR全体的音韻統制 */
  cefrOverall: Readonly<{ score: number; band: string }> | null;
  /** C3-b: CEFR分節 */
  cefrSegmental: Readonly<{ score: number; band: string }> | null;
  /** C3-b: CEFR韻律 */
  cefrProsodic: Readonly<{ score: number; band: string }> | null;
}>;

// ---- NBest ----

export type NBestCandidateDraft = Readonly<{
  phoneme: string;
  confidence: number;
}>;

// ---- focusSounds ----

export type FocusSoundDraft = Readonly<{
  pair: string;
  phenomenon: string | null;
  functionalLoad: string;
  occurrences: number;
  priority: string;
  reasonJa: string;
  catalogId: string | null;
}>;

// ---- prosody ----

export type ProsodyDraft = Readonly<{
  f0Contour: Readonly<{ timesMs: ReadonlyArray<number>; valuesHz: ReadonlyArray<number> }> | null;
  wordStress: ReadonlyArray<
    Readonly<{ word: string; wordIndex: number; expectedStress: number; predictedStress: number }>
  > | null;
  rhythmNpvi: number | null;
  referenceNpvi: number | null;
  weakFormRate: number | null;
}>;

// ---- perPhonemeGop ----

export type PerPhonemeGopDraft = Readonly<{
  word: string;
  phoneme: string;
  gop: number;
  heat: number;
}>;

// ---- Finding / Segment ----

export type PronunciationEvidenceDraft = Readonly<{
  text: string | null;
  ipa: string | null;
}>;

/** C4-b: 3層フィードバック文 */
export type FeedbackLayersDraft = Readonly<{
  whatJa: string;
  whyJa: string;
  howJa: string;
}>;

export type AssessmentFindingDraft = Readonly<{
  phenomenon: string | null;
  gop: number | null;
  category: FindingCategory;
  severity: FindingSeverity;
  textRange: TextRangeDraft;
  audioRange: AudioRangeDraft | null;
  expected: PronunciationEvidenceDraft;
  detected: PronunciationEvidenceDraft;
  messageJa: string | null;
  messageEn: string | null;
  scoreImpact: number;
  confidence: number;
  /** C3-a: NBest最有力候補 IPA */
  detectedTopCandidate: string | null;
  /** C3-a: 上位3件候補 */
  nBest: ReadonlyArray<NBestCandidateDraft> | null;
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
  /** M-104: 3層フィードバック文 (ACL/usecase で生成) */
  feedbackLayers: FeedbackLayersDraft | null;
  /** C4-b: 却下フラグ (この Wave では false 固定、次 Wave で永続化) */
  dismissed: boolean;
  /** M-104R-b: 語内位置ラベル ("initial"|"medial"|"final"|null) */
  wordPositionLabel: string | null;
}>;

export type AssessmentSegmentDraft = Readonly<{
  textRange: TextRangeDraft;
  audioRange: AudioRangeDraft;
  transcript: string | null;
  confidence: number;
}>;

// ---- Summary / Metadata ----

export type AssessmentSummaryDraft = Readonly<{
  messageJa: string;
  messageEn: string | null;
}>;

/**
 * ACL §9 に準拠したエンジンメタデータ。
 * OpenAI: model / promptVersion / scoringRubricVersion / assessmentSchemaVersion 必須。
 * OSS Worker: workerVersion / modelVersion / ruleSetVersion / scoringRubricVersion / assessmentSchemaVersion 必須。
 * 両 Adaptor の必須項目以外は null を許容する。
 */
export type AssessmentEngineMetadataDraft = Readonly<{
  assessmentSchemaVersion: AssessmentSchemaVersion;
  scoringRubricVersion: ScoringRubricVersion;
  promptVersion: PromptVersion | null;
  model: string | null;
  workerVersion: string | null;
  modelVersion: string | null;
  ruleSetVersion: string | null;
  engineSpecific: Record<string, unknown>;
}>;

// ---- Draft ルート型 ----

/**
 * ACL が外部エンジン出力を正規化した共通解析結果 Draft。
 * UseCase 層は Draft を受け取り、共通検証後に正式な AssessmentResult を作成する。
 */
export type AssessmentResultDraft = Readonly<{
  engine: AnalysisEngine;
  /** 採点ステータス。"low_quality" は音声品質不足で採点せず早期返却されたことを示す。 */
  status: "normal" | "low_quality";
  scores: ScoreDraftSet;
  findings: ReadonlyArray<AssessmentFindingDraft>;
  segments: ReadonlyArray<AssessmentSegmentDraft>;
  summary: AssessmentSummaryDraft;
  rawResponse: StoredRawEngineResponse;
  metadata: AssessmentEngineMetadataDraft;
  tokenizerVersion: string;
  /** C3-c: 全音素GOPヒートマップ */
  perPhonemeGop: ReadonlyArray<PerPhonemeGopDraft> | null;
  /** C3-c: focusSoundsリスト */
  focusSounds: ReadonlyArray<FocusSoundDraft> | null;
  /** C3-c: 韻律生データ */
  prosody: ProsodyDraft | null;
  /** C3-c: エンジンサマリー文 (M-107b) */
  engineSummaryMessageJa: string | null;
}>;
