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

// ---- Finding / Segment ----

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
});

const segmentSchema = z.object({
  textRange: textRangeSchema,
  audioRange: audioRangeSchema,
  transcript: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

// ---- Scores ----

const scoresSchema = z.object({
  overall: z.number().int().min(0).max(100),
  accuracy: z.number().int().min(0).max(100),
  nativeLikeness: z.number().int().min(0).max(100),
  pronunciation: z.number().int().min(0).max(100),
  connectedSpeech: z.number().int().min(0).max(100),
  prosody: z.number().int().min(0).max(100),
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
  segments: z.array(segmentSchema).min(1, "segments は 1 件以上必要です"),
  metadata: workerMetadataSchema,
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
