// NonEmptyList
export type NonEmptyList<T> = readonly [T, ...T[]];

export const createNonEmptyList = <T>(items: readonly T[]): NonEmptyList<T> | null => {
  if (items.length === 0) return null;
  return items as NonEmptyList<T>;
};

// Result / DomainError（neverthrow の Result を使う）
export type { Result, ResultAsync } from "neverthrow";
export { ok, err, okAsync, errAsync } from "neverthrow";

// DomainError
export type ValidationFailedError = Readonly<{
  type: "validationFailed";
  field: string;
  reason: string;
}>;
export type NotFoundError = Readonly<{
  type: "notFound";
  resource: string;
  identifier: string;
}>;
export type InvalidStateTransitionError = Readonly<{
  type: "invalidStateTransition";
  from: string;
  to: string;
  reason: string;
}>;
export type PersistenceFailedError = Readonly<{
  type: "persistenceFailed";
  reason: string;
}>;
export type TransactionFailedError = Readonly<{
  type: "transactionFailed";
  reason: string;
}>;
export type AudioStorageFailedError = Readonly<{
  type: "audioStorageFailed";
  reason: string;
}>;
export type AssessmentEngineFailedError = Readonly<{
  type: "assessmentEngineFailed";
  engine: string;
  reason: string;
  failureKind: "retryable" | "nonRetryable";
}>;
export type AssessmentSchemaInvalidError = Readonly<{
  type: "assessmentSchemaInvalid";
  reason: string;
}>;

export type DomainError =
  | ValidationFailedError
  | NotFoundError
  | InvalidStateTransitionError
  | PersistenceFailedError
  | TransactionFailedError
  | AudioStorageFailedError
  | AssessmentEngineFailedError
  | AssessmentSchemaInvalidError;

// 共通ヘルパー
export const validationFailed = (field: string, reason: string): ValidationFailedError => ({
  type: "validationFailed",
  field,
  reason,
});

export const notFound = (resource: string, identifier: string): NotFoundError => ({
  type: "notFound",
  resource,
  identifier,
});

export const invalidStateTransition = (
  from: string,
  to: string,
  reason: string,
): InvalidStateTransitionError => ({
  type: "invalidStateTransition",
  from,
  to,
  reason,
});

// Branded type ヘルパー
declare const __brand: unique symbol;
export type Brand<T, B> = T & { readonly [__brand]: B };

/** 非空文字列ブランド型の共通ファクトリ（trim 後の長さのみを検証する）。 */
export const createNonEmptyBrandedString = <T extends string>(value: string): T | null =>
  value.trim().length > 0 ? (value as T) : null;

// Pagination
export type Offset = Brand<number, "Offset">;
export type Limit = Brand<number, "Limit">;

export const createOffset = (value: number): Offset | null =>
  value >= 0 ? (value as Offset) : null;

export const createLimit = (value: number): Limit | null =>
  value >= 1 && value <= 100 ? (value as Limit) : null;

export type Pagination = {
  readonly type: "offset";
  readonly offset: Offset;
  readonly limit: Limit;
};

export const defaultPagination = (): Pagination => ({
  type: "offset",
  offset: 0 as Offset,
  limit: 20 as Limit,
});

// 時間換算ヘルパー
export const hoursToMilliseconds = (hours: number): number => hours * 60 * 60 * 1000;
