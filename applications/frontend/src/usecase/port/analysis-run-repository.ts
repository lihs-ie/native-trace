import { type ResultAsync } from "neverthrow";
import {
  type AnalysisRun,
  type AnalysisRunIdentifier,
  type AnalysisRunStatus,
} from "../../domain/analysis-run";
import { type AnalysisRunSearchCriteria } from "../../domain/criteria";
import { type DomainError } from "../../domain/shared";

export type AnalysisRunPage = Readonly<{
  items: ReadonlyArray<AnalysisRun>;
  total: number;
}>;

export type AnalysisRunRepository = Readonly<{
  find: (identifier: AnalysisRunIdentifier) => ResultAsync<AnalysisRun, DomainError>;
  search: (criteria: AnalysisRunSearchCriteria) => ResultAsync<AnalysisRunPage, DomainError>;
  persist: (analysisRun: AnalysisRun) => ResultAsync<void, DomainError>;
  updateStatus: (
    identifier: AnalysisRunIdentifier,
    status: AnalysisRunStatus,
  ) => ResultAsync<void, DomainError>;
}>;
