/**
 * OSS Worker HTTP レスポンスの Zod schema。
 * acl.md §8.2 の成功/失敗レスポンス仕様に準拠。
 */

import { z } from "zod";

// ---- 共通値オブジェクト ----

const textRangeSchema = z.object({
  startChar: z.number().int().nonnegative(),
  endChar: z.number().int().positive(),
});

const audioRangeSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
});

// acl.md §8.2: category は 5 値のみ許可
const findingCategorySchema = z.enum([
  "accuracy",
  "pronunciation",
  "connectedSpeech",
  "prosody",
  "nativeLikeness",
]);

const findingSeveritySchema = z.enum(["critical", "major", "minor", "suggestion"]);

const pronunciationEvidenceSchema = z.object({
  text: z.string().nullable(),
  ipa: z.string().nullable(),
});

// ---- NBest ----

const nBestCandidateSchema = z.object({
  phoneme: z.string(),
  confidence: z.number().min(0).max(1),
});

// ---- Finding / Segment ----

const wordPairSchema = z.object({
  first: z.string(),
  second: z.string(),
});

const findingSchema = z.object({
  phenomenon: z.string().nullable(),
  gop: z.number().nullable(),
  category: findingCategorySchema,
  severity: findingSeveritySchema,
  textRange: textRangeSchema,
  audioRange: audioRangeSchema.nullable(),
  expected: pronunciationEvidenceSchema,
  detected: pronunciationEvidenceSchema,
  messageJa: z.string().nullable(),
  messageEn: z.string().nullable(),
  scoreImpact: z.number(),
  confidence: z.number().min(0).max(1),
  // C3-a 追加フィールド
  detectedTopCandidate: z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  nBest: z
    .array(nBestCandidateSchema)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  matchesL1Pattern: z.boolean().optional().default(false),
  functionalLoad: z
    .enum(["max", "high", "mid", "low"])
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  catalogId: z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  wordPair: wordPairSchema
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  expectedPronunciation: z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  insertedVowel: z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  /** D4 (ADR-017): 挿入母音の時刻位置（ミリ秒）。worker が emit する値を frontend まで通す。*/
  insertionPositionMs: z
    .number()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  /** M-104R-b: 語内位置ラベル（worker JSON key）*/
  wordPositionLabel: z
    .enum(["initial", "medial", "final"])
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  /** M-APD-12 (ADR-018): 音響音声学的証拠。worker が導出した方向ラベル + 実測/目標フォルマント。*/
  acousticEvidence: z
    .object({
      tongueHeight: z.enum(["tooHigh", "tooLow", "ok"]).nullable().optional(),
      tongueBackness: z.enum(["tooFront", "tooBack", "ok"]).nullable().optional(),
      rhoticity: z.enum(["insufficient", "overRetroflex", "ok"]).nullable().optional(),
      sibilantPlace: z.enum(["tooPalatal", "tooAlveolar", "ok"]).nullable().optional(),
      vowelLength: z.enum(["tooShort", "ok"]).nullable().optional(),
      measuredF1Hz: z.number().nullable().optional(),
      measuredF2Hz: z.number().nullable().optional(),
      measuredF3Hz: z.number().nullable().optional(),
      targetF1Hz: z.number().nullable().optional(),
      targetF2Hz: z.number().nullable().optional(),
      targetF3Hz: z.number().nullable().optional(),
    })
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  /**
   * M-AAI-13 (ADR-019): EMA 調音推定座標 + 表示適格性スコア。
   * ORPHAN-C: Zod はデフォルトで unknown keys を strip するため、
   * このフィールドを schema に明示しないと mapper に届く前に null になる。
   */
  articulatoryEstimate: z
    .object({
      tongueTipX: z.number(),
      tongueTipY: z.number(),
      tongueDorsumX: z.number(),
      tongueDorsumY: z.number(),
      lipApertureX: z.number(),
      lipApertureY: z.number(),
      displayEligibility: z.number(),
    })
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});

const segmentSchema = z.object({
  textRange: textRangeSchema,
  audioRange: audioRangeSchema,
  transcript: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

// ---- Scores ----

const cefrBandSchema = z.object({
  score: z.number(),
  band: z.string(),
});

const scoresSchema = z.object({
  overall: z.number().int().min(0).max(100),
  accuracy: z.number().int().min(0).max(100),
  nativeLikeness: z.number().int().min(0).max(100),
  pronunciation: z.number().int().min(0).max(100),
  connectedSpeech: z.number().int().min(0).max(100),
  prosody: z.number().int().min(0).max(100),
  // C3-b 追加フィールド
  intelligibility: z
    .number()
    .min(0)
    .max(100)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  cefrOverall: cefrBandSchema
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  cefrSegmental: cefrBandSchema
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  cefrProsodic: cefrBandSchema
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});

// ---- Summary ----

const summarySchema = z.object({
  messageJa: z.string().min(1),
  messageEn: z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});

// ---- C3-c トップレベル追加スキーマ ----

const perPhonemeGopEntrySchema = z.object({
  word: z.string(),
  phoneme: z.string(),
  gop: z.number(),
  heat: z.number().int().min(0).max(4),
});

const focusSoundSchema = z.object({
  pair: z.string(),
  phenomenon: z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  functionalLoad: z.enum(["max", "high", "mid", "low"]),
  occurrences: z.number().int().nonnegative(),
  priority: z.enum(["now", "next", "later"]),
  reasonJa: z.string(),
  catalogId: z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});

const wordStressEntrySchema = z.object({
  word: z.string(),
  wordIndex: z.number().int().nonnegative(),
  expectedStress: z.number().int().min(0).max(2),
  predictedStress: z.number().int().min(0).max(2),
});

const f0ContourSchema = z.object({
  timesMs: z.array(z.number().int().nonnegative()),
  valuesHz: z.array(z.number()),
});

const prosodySchema = z.object({
  f0Contour: f0ContourSchema
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  referenceF0Contour: f0ContourSchema
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  wordStress: z
    .array(wordStressEntrySchema)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  rhythmNpvi: z
    .number()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  referenceNpvi: z
    .number()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  weakFormRate: z
    .number()
    .min(0)
    .max(1)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});

// ---- Worker Metadata ----

const workerMetadataSchema = z.object({
  workerVersion: z.string().min(1),
  modelVersion: z.string().min(1),
  ruleSetVersion: z.string().min(1),
  scoringRubricVersion: z.string().min(1),
});

// ---- 成功レスポンス ----

export const ossWorkerSuccessResponseSchema = z.object({
  assessmentSchemaVersion: z.string().min(1),
  tokenizerVersion: z.string().min(1),
  // status: "normal" = 採点完了、"low_quality" = 音声品質不足で採点せず早期返却
  status: z.enum(["normal", "low_quality"]).optional().default("normal"),
  scores: scoresSchema,
  summary: summarySchema,
  findings: z.array(findingSchema),
  // segments は空配列を許容する: 発話がほぼ検出されない低品質音声では worker が status="low_quality"
  // と空 segments を返す。空を schema hard fail にせず、response-mapper で low_quality_audio として扱う。
  segments: z.array(segmentSchema),
  metadata: workerMetadataSchema,
  // C3-c トップレベル追加フィールド
  perPhonemeGop: z
    .array(perPhonemeGopEntrySchema)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  focusSounds: z
    .array(focusSoundSchema)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  prosody: prosodySchema
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  engineSummaryMessageJa: z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});

export type OssWorkerSuccessResponse = z.infer<typeof ossWorkerSuccessResponseSchema>;

// ---- 失敗レスポンス ----

export const ossWorkerErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }),
});

export type OssWorkerErrorResponse = z.infer<typeof ossWorkerErrorResponseSchema>;
