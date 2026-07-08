import { err, ok } from "neverthrow";
import { type Result } from "neverthrow";
import {
  type Brand,
  type DomainError,
  type NonEmptyList,
  createNonEmptyBrandedString,
  validationFailed,
} from "./shared";
import { type MaterialIdentifier } from "./material";

export type SectionSeriesIdentifier = Brand<string, "SectionSeriesIdentifier">;
export type SectionTitle = Brand<string, "SectionTitle">;
export type SectionDisplayOrder = Brand<number, "SectionDisplayOrder">;

export const createSectionSeriesIdentifier = (value: string): SectionSeriesIdentifier | null =>
  createNonEmptyBrandedString<SectionSeriesIdentifier>(value);

export const createSectionTitle = (value: string): Result<SectionTitle, DomainError> => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return err(validationFailed("title", "セクション名は空にできません"));
  return ok(trimmed as SectionTitle);
};

export const createSectionDisplayOrder = (
  value: number,
): Result<SectionDisplayOrder, DomainError> => {
  if (value < 0 || !Number.isInteger(value))
    return err(validationFailed("displayOrder", "表示順は0以上の整数である必要があります"));
  return ok(value as SectionDisplayOrder);
};

export type ActiveSectionSeries = Readonly<{
  type: "active";
  identifier: SectionSeriesIdentifier;
  material: MaterialIdentifier;
  title: SectionTitle;
  displayOrder: SectionDisplayOrder;
  createdAt: Date;
  updatedAt: Date;
}>;

export type DeletedSectionSeries = Readonly<{
  type: "deleted";
  identifier: SectionSeriesIdentifier;
  material: MaterialIdentifier;
  title: SectionTitle;
  deletedAt: Date;
}>;

export type SectionSeries = ActiveSectionSeries | DeletedSectionSeries;

export type SectionSeriesCreated = Readonly<{
  type: "sectionSeriesCreated";
  sectionSeries: ActiveSectionSeries;
  material: MaterialIdentifier;
  occurredAt: Date;
}>;

export type SectionSeriesRevised = Readonly<{
  type: "sectionSeriesRevised";
  sectionSeries: ActiveSectionSeries;
  occurredAt: Date;
}>;

export type SectionSeriesRetired = Readonly<{
  type: "sectionSeriesRetired";
  sectionSeries: DeletedSectionSeries;
  occurredAt: Date;
}>;

export type CreateSectionSeriesOutput = Readonly<{
  sectionSeries: ActiveSectionSeries;
  events: NonEmptyList<SectionSeriesCreated>;
}>;

export const createSectionSeriesAggregate = (
  input: Readonly<{
    identifier: SectionSeriesIdentifier;
    material: MaterialIdentifier;
    title: SectionTitle;
    displayOrder: SectionDisplayOrder;
    now: Date;
  }>,
): CreateSectionSeriesOutput => {
  const sectionSeriesAggregate: ActiveSectionSeries = {
    type: "active",
    identifier: input.identifier,
    material: input.material,
    title: input.title,
    displayOrder: input.displayOrder,
    createdAt: input.now,
    updatedAt: input.now,
  };
  return {
    sectionSeries: sectionSeriesAggregate,
    events: [
      {
        type: "sectionSeriesCreated",
        sectionSeries: sectionSeriesAggregate,
        material: input.material,
        occurredAt: input.now,
      },
    ],
  };
};

export type ReviseSectionSeriesOutput = Readonly<{
  sectionSeries: ActiveSectionSeries;
  events: NonEmptyList<SectionSeriesRevised>;
}>;

export const reviseSectionSeries = (
  sectionSeriesAggregate: ActiveSectionSeries,
  input: Readonly<{
    title: SectionTitle;
    displayOrder: SectionDisplayOrder;
    now: Date;
  }>,
): ReviseSectionSeriesOutput => {
  const revised: ActiveSectionSeries = {
    ...sectionSeriesAggregate,
    title: input.title,
    displayOrder: input.displayOrder,
    updatedAt: input.now,
  };
  return {
    sectionSeries: revised,
    events: [
      {
        type: "sectionSeriesRevised",
        sectionSeries: revised,
        occurredAt: input.now,
      },
    ],
  };
};

export type RetireSectionSeriesOutput = Readonly<{
  sectionSeries: DeletedSectionSeries;
  events: NonEmptyList<SectionSeriesRetired>;
}>;

export const retireSectionSeries = (
  sectionSeriesAggregate: ActiveSectionSeries,
  now: Date,
): RetireSectionSeriesOutput => {
  const deleted: DeletedSectionSeries = {
    type: "deleted",
    identifier: sectionSeriesAggregate.identifier,
    material: sectionSeriesAggregate.material,
    title: sectionSeriesAggregate.title,
    deletedAt: now,
  };
  return {
    sectionSeries: deleted,
    events: [
      {
        type: "sectionSeriesRetired",
        sectionSeries: deleted,
        occurredAt: now,
      },
    ],
  };
};
