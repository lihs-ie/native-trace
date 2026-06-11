import { type ResultAsync } from "neverthrow";
import {
  type SectionSeries,
  type ActiveSectionSeries,
  type SectionSeriesIdentifier,
} from "../../domain/section-series";
import { type SectionSeriesSearchCriteria } from "../../domain/criteria";
import { type DomainError } from "../../domain/shared";

export type SectionSeriesPage = Readonly<{
  items: ReadonlyArray<SectionSeries>;
  total: number;
}>;

export type SectionSeriesRepository = Readonly<{
  find: (identifier: SectionSeriesIdentifier) => ResultAsync<ActiveSectionSeries, DomainError>;
  search: (criteria: SectionSeriesSearchCriteria) => ResultAsync<SectionSeriesPage, DomainError>;
  persist: (sectionSeries: SectionSeries) => ResultAsync<void, DomainError>;
}>;
