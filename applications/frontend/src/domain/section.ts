import { err, ok } from "neverthrow";
import { type Result } from "neverthrow";
import { type DomainError, type NonEmptyList, validationFailed } from "./shared";
import { type SectionSeriesIdentifier } from "./section-series";

declare const __brand: unique symbol;
type Brand<T, B> = T & { readonly [__brand]: B };

export type SectionIdentifier = Brand<string, "SectionIdentifier">;
export type SectionVersion = Brand<number, "SectionVersion">;
export type SectionBodyText = Brand<string, "SectionBodyText">;

export const createSectionIdentifier = (
  value: string,
): SectionIdentifier | null =>
  value.trim().length > 0 ? (value as SectionIdentifier) : null;

export const createSectionVersion = (
  value: number,
): Result<SectionVersion, DomainError> => {
  if (!Number.isInteger(value) || value < 1)
    return err(
      validationFailed(
        "version",
        "版番号は1以上の整数である必要があります",
      ),
    );
  return ok(value as SectionVersion);
};

const MAX_BODY_TEXT_LENGTH = 10000;
const MIN_ENGLISH_CHAR_RATIO = 0.3;

export const createSectionBodyText = (
  value: string,
): Result<SectionBodyText, DomainError> => {
  const trimmed = value.trim();
  if (trimmed.length === 0)
    return err(validationFailed("bodyText", "本文は空にできません"));
  if (trimmed.length > MAX_BODY_TEXT_LENGTH)
    return err(
      validationFailed(
        "bodyText",
        `本文は${MAX_BODY_TEXT_LENGTH}文字以内である必要があります`,
      ),
    );
  // 制御文字禁止（改行・タブ以外）
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(trimmed)) {
    return err(
      validationFailed("bodyText", "本文に制御文字を含めることはできません"),
    );
  }
  // 英字割合チェック
  const englishChars = (trimmed.match(/[a-zA-Z]/g) ?? []).length;
  if (englishChars / trimmed.length < MIN_ENGLISH_CHAR_RATIO) {
    return err(
      validationFailed(
        "bodyText",
        "本文には英字を十分に含める必要があります",
      ),
    );
  }
  return ok(trimmed as SectionBodyText);
};

export type ActiveSection = Readonly<{
  type: "active";
  identifier: SectionIdentifier;
  sectionSeries: SectionSeriesIdentifier;
  version: SectionVersion;
  bodyText: SectionBodyText;
  createdAt: Date;
}>;

export type Section = ActiveSection;

export type SectionCreated = Readonly<{
  type: "sectionCreated";
  section: ActiveSection;
  sectionSeries: SectionSeriesIdentifier;
  occurredAt: Date;
}>;

export type CreateSectionOutput = Readonly<{
  section: ActiveSection;
  events: NonEmptyList<SectionCreated>;
}>;

export const createSection = (
  input: Readonly<{
    identifier: SectionIdentifier;
    sectionSeries: SectionSeriesIdentifier;
    version: SectionVersion;
    bodyText: SectionBodyText;
    now: Date;
  }>,
): CreateSectionOutput => {
  const section: ActiveSection = {
    type: "active",
    identifier: input.identifier,
    sectionSeries: input.sectionSeries,
    version: input.version,
    bodyText: input.bodyText,
    createdAt: input.now,
  };
  return {
    section,
    events: [
      {
        type: "sectionCreated",
        section,
        sectionSeries: input.sectionSeries,
        occurredAt: input.now,
      },
    ],
  };
};
