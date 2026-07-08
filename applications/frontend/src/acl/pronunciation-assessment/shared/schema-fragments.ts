/**
 * openai / oss-worker の pronunciation-assessment レスポンス schema で重複していた
 * zod 断片を共通化する（W29）。
 *
 * audioRange 系は秒（openai）/ミリ秒（oss-worker）で意図的に異なるため対象外。
 * 各エンジンの schema.ts にそれぞれ残す。
 */

import { z } from "zod";

export const textRangeSchema = z.object({
  startChar: z.number().int().nonnegative(),
  endChar: z.number().int().positive(),
});

// acl.md: category は Domain Choice Type の 5 値のみ許可
export const findingCategorySchema = z.enum([
  "accuracy",
  "pronunciation",
  "connectedSpeech",
  "prosody",
  "nativeLikeness",
]);

export const findingSeveritySchema = z.enum(["critical", "major", "minor", "suggestion"]);

export const pronunciationEvidenceSchema = z.object({
  text: z.string().nullable(),
  ipa: z.string().nullable(),
});
