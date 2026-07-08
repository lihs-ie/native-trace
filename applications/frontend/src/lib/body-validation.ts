/**
 * 本文妥当性検証（純粋関数）
 *
 * 各定数は src/domain/section.ts が source of truth。
 * section.ts の定数は private/未 export のため、ここで同値をミラー定義する。
 * 変更時は section.ts と両方を更新すること。
 */

/** 最大文字数（section.ts MAX_BODY_TEXT_LENGTH と同値） */
export const MAX_BODY_TEXT_LENGTH = 10000;

/** 英字割合の最小値（section.ts MIN_ENGLISH_CHAR_RATIO と同値） */
export const MIN_ENGLISH_CHAR_RATIO = 0.3;

/** 長文分割推奨の warn 閾値（本ファイル独自定数） */
export const LONG_BODY_WARN_LENGTH = 2000;

/** 本文のメトリクス */
export type BodyMetrics = {
  readonly words: number;
  readonly chars: number;
  readonly englishRatio: number;
};

/** 個別の妥当性チェック結果 */
export type ValidationStatus = "ok" | "warn";

/** 妥当性チェック結果一覧 */
export type BodyValidationResult = {
  readonly isNotEmpty: ValidationStatus;
  readonly isWithinMaxLength: ValidationStatus;
  readonly meetsEnglishRatio: ValidationStatus;
  readonly hasNoControlCharacters: ValidationStatus;
  readonly isNotLong: ValidationStatus;
};

/**
 * 本文のメトリクスを算出する。
 * 空文字列の場合は words=0, chars=0, englishRatio=0 を返す。
 */
export const computeBodyMetrics = (bodyText: string): BodyMetrics => {
  const chars = bodyText.length;
  // usecase/shared/tokenizer.ts の countWords と同義（公開 API のためここでは現状維持）。
  const words =
    chars === 0
      ? 0
      : bodyText
          .trim()
          .split(/\s+/)
          .filter((word) => word.length > 0).length;
  const englishCharCount = (bodyText.match(/[A-Za-z]/g) ?? []).length;
  const englishRatio = chars === 0 ? 0 : englishCharCount / chars;

  return { words, chars, englishRatio };
};

/**
 * 制御文字（タブ・改行・CR 以外の C0/C1 制御文字）が含まれるかを返す。
 * タブ(\x09)、改行(\x0A)、CR(\x0D) は本文として許容する。
 */
export const hasControlCharacters = (bodyText: string): boolean =>
  /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/.test(bodyText);

/**
 * 本文全体の妥当性チェック結果を返す。
 * 各フィールドは "ok" | "warn"。
 * - isNotEmpty: 空でない → ok、空 → warn
 * - isWithinMaxLength: MAX_BODY_TEXT_LENGTH 以内 → ok、超過 → warn
 * - meetsEnglishRatio: englishRatio ≥ MIN_ENGLISH_CHAR_RATIO → ok（空は warn）
 * - hasNoControlCharacters: 制御文字なし → ok、あり → warn
 * - isNotLong: LONG_BODY_WARN_LENGTH 以内 → ok、超過 → warn
 */
export const validateBody = (bodyText: string): BodyValidationResult => {
  const metrics = computeBodyMetrics(bodyText);

  const isNotEmpty: ValidationStatus = metrics.chars > 0 ? "ok" : "warn";

  const isWithinMaxLength: ValidationStatus = metrics.chars <= MAX_BODY_TEXT_LENGTH ? "ok" : "warn";

  const meetsEnglishRatio: ValidationStatus =
    metrics.chars > 0 && metrics.englishRatio >= MIN_ENGLISH_CHAR_RATIO ? "ok" : "warn";

  const hasNoControlCharacters: ValidationStatus = hasControlCharacters(bodyText) ? "warn" : "ok";

  const isNotLong: ValidationStatus = metrics.chars <= LONG_BODY_WARN_LENGTH ? "ok" : "warn";

  return {
    isNotEmpty,
    isWithinMaxLength,
    meetsEnglishRatio,
    hasNoControlCharacters,
    isNotLong,
  };
};
