/**
 * OpenAI Structured Outputs の JSON Schema + response Zod schema。
 * acl.md §7.2, §7.5 に準拠。
 */

import { z } from "zod";

// ---- Zod schema (response validation) ----

const textRangeSchema = z.object({
  startChar: z.number().int().nonnegative(),
  endChar: z.number().int().positive(),
});

// audioRange: OpenAI は秒小数を返す可能性があるため、ここでは number (float) も許可し
// response-mapper でミリ秒整数へ変換する。
const audioRangeSecondsSchema = z.object({
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
}).nullable();

// acl.md §5.3: category は Domain Choice Type の 5 値のみ許可
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

const findingSchema = z.object({
  category: findingCategorySchema,
  severity: findingSeveritySchema,
  textRange: textRangeSchema,
  audioRange: audioRangeSecondsSchema,
  expected: pronunciationEvidenceSchema,
  detected: pronunciationEvidenceSchema,
  messageJa: z.string().min(1),
  messageEn: z.string().nullable().optional().transform((v) => v ?? null),
  scoreImpact: z.number(),
  confidence: z.number().min(0).max(1),
});

const segmentSchema = z.object({
  textRange: textRangeSchema,
  // audioRange: OpenAI は秒小数で返す想定
  audioRange: z.object({
    startSeconds: z.number().nonnegative(),
    endSeconds: z.number().positive(),
  }),
  transcript: z.string().nullable().optional().transform((v) => v ?? null),
  confidence: z.number().min(0).max(1),
});

const scoresSchema = z.object({
  overall: z.number().int().min(0).max(100),
  accuracy: z.number().int().min(0).max(100),
  nativeLikeness: z.number().int().min(0).max(100),
  pronunciation: z.number().int().min(0).max(100),
  connectedSpeech: z.number().int().min(0).max(100),
  prosody: z.number().int().min(0).max(100),
});

const summarySchema = z.object({
  messageJa: z.string().min(1),
  messageEn: z.string().nullable().optional().transform((v) => v ?? null),
});

export const openAiAssessmentResponseSchema = z.object({
  assessmentSchemaVersion: z.string().min(1),
  tokenizerVersion: z.string().min(1),
  scores: scoresSchema,
  summary: summarySchema,
  findings: z.array(findingSchema),
  segments: z.array(segmentSchema).min(1, "segments は 1 件以上必要です"),
});

export type OpenAiAssessmentResponse = z.infer<typeof openAiAssessmentResponseSchema>;

// ---- JSON Schema (Structured Outputs 用) ----
// OpenAI Structured Outputs に渡す JSON Schema。additionalProperties: false が必要。

export const OPENAI_ASSESSMENT_JSON_SCHEMA = {
  name: "pronunciation_assessment",
  strict: true,
  schema: {
    type: "object",
    properties: {
      assessmentSchemaVersion: { type: "string" },
      tokenizerVersion: { type: "string" },
      scores: {
        type: "object",
        properties: {
          overall: { type: "integer", minimum: 0, maximum: 100 },
          accuracy: { type: "integer", minimum: 0, maximum: 100 },
          nativeLikeness: { type: "integer", minimum: 0, maximum: 100 },
          pronunciation: { type: "integer", minimum: 0, maximum: 100 },
          connectedSpeech: { type: "integer", minimum: 0, maximum: 100 },
          prosody: { type: "integer", minimum: 0, maximum: 100 },
        },
        required: ["overall", "accuracy", "nativeLikeness", "pronunciation", "connectedSpeech", "prosody"],
        additionalProperties: false,
      },
      summary: {
        type: "object",
        properties: {
          messageJa: { type: "string" },
          messageEn: { type: ["string", "null"] },
        },
        required: ["messageJa", "messageEn"],
        additionalProperties: false,
      },
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            category: {
              type: "string",
              enum: ["accuracy", "pronunciation", "connectedSpeech", "prosody", "nativeLikeness"],
            },
            severity: {
              type: "string",
              enum: ["critical", "major", "minor", "suggestion"],
            },
            textRange: {
              type: "object",
              properties: {
                startChar: { type: "integer", minimum: 0 },
                endChar: { type: "integer", minimum: 1 },
              },
              required: ["startChar", "endChar"],
              additionalProperties: false,
            },
            audioRange: {
              oneOf: [
                {
                  type: "object",
                  properties: {
                    startSeconds: { type: "number", minimum: 0 },
                    endSeconds: { type: "number", minimum: 0 },
                  },
                  required: ["startSeconds", "endSeconds"],
                  additionalProperties: false,
                },
                { type: "null" },
              ],
            },
            expected: {
              type: "object",
              properties: {
                text: { type: ["string", "null"] },
                ipa: { type: ["string", "null"] },
              },
              required: ["text", "ipa"],
              additionalProperties: false,
            },
            detected: {
              type: "object",
              properties: {
                text: { type: ["string", "null"] },
                ipa: { type: ["string", "null"] },
              },
              required: ["text", "ipa"],
              additionalProperties: false,
            },
            messageJa: { type: "string" },
            messageEn: { type: ["string", "null"] },
            scoreImpact: { type: "number" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
          required: [
            "category", "severity", "textRange", "audioRange",
            "expected", "detected", "messageJa", "messageEn",
            "scoreImpact", "confidence",
          ],
          additionalProperties: false,
        },
      },
      segments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            textRange: {
              type: "object",
              properties: {
                startChar: { type: "integer", minimum: 0 },
                endChar: { type: "integer", minimum: 1 },
              },
              required: ["startChar", "endChar"],
              additionalProperties: false,
            },
            audioRange: {
              type: "object",
              properties: {
                startSeconds: { type: "number", minimum: 0 },
                endSeconds: { type: "number", minimum: 0 },
              },
              required: ["startSeconds", "endSeconds"],
              additionalProperties: false,
            },
            transcript: { type: ["string", "null"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["textRange", "audioRange", "transcript", "confidence"],
          additionalProperties: false,
        },
      },
    },
    required: [
      "assessmentSchemaVersion",
      "tokenizerVersion",
      "scores",
      "summary",
      "findings",
      "segments",
    ],
    additionalProperties: false,
  },
} as const;
