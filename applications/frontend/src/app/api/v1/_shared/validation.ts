/**
 * route 層の zod 検証エラー変換ヘルパー（W31）
 *
 * zod issue メッセージを ", " 結合して ValidationFailedError にする処理の route 間コピーを一本化する。
 * usecase 層の `usecase/shared/validation.ts`（W19）とは別物 — こちらは HTTP 入口専用。
 */

import { type ZodError } from "zod";
import type { ValidationFailedError } from "../../../../domain/shared";

export const zodErrorToValidationFailed = (
  zodError: ZodError,
  field: string = "input",
): ValidationFailedError => ({
  type: "validationFailed",
  field,
  reason: zodError.errors.map((e) => e.message).join(", "),
});
