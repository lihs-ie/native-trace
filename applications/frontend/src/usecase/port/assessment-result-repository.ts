import { type ResultAsync } from "neverthrow";
import {
  type AssessmentResult,
  type AssessmentResultIdentifier,
} from "../../domain/assessment-result";
import { type AssessmentResultSearchCriteria } from "../../domain/criteria";
import { type DomainError } from "../../domain/shared";

export type AssessmentResultPage = Readonly<{
  items: ReadonlyArray<AssessmentResult>;
}>;

export type AssessmentResultRepository = Readonly<{
  find: (identifier: AssessmentResultIdentifier) => ResultAsync<AssessmentResult, DomainError>;
  search: (criteria: AssessmentResultSearchCriteria) => ResultAsync<AssessmentResultPage, DomainError>;
  persist: (result: AssessmentResult) => ResultAsync<void, DomainError>;
}>;
