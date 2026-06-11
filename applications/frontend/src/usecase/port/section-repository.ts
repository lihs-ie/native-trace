import { type ResultAsync } from "neverthrow";
import {
  type Section,
  type ActiveSection,
  type SectionIdentifier,
} from "../../domain/section";
import { type SectionSeriesIdentifier } from "../../domain/section-series";
import { type SectionSearchCriteria } from "../../domain/criteria";
import { type DomainError } from "../../domain/shared";

export type SectionPage = Readonly<{
  items: ReadonlyArray<Section>;
  total: number;
}>;

export type SectionRepository = Readonly<{
  find: (identifier: SectionIdentifier) => ResultAsync<ActiveSection, DomainError>;
  findLatestInSeries: (sectionSeries: SectionSeriesIdentifier) => ResultAsync<ActiveSection, DomainError>;
  findLatestVersionNumber: (sectionSeries: SectionSeriesIdentifier) => ResultAsync<number, DomainError>;
  search: (criteria: SectionSearchCriteria) => ResultAsync<SectionPage, DomainError>;
  persist: (section: Section) => ResultAsync<void, DomainError>;
}>;
