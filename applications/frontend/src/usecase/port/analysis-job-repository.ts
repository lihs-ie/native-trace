import { type ResultAsync } from "neverthrow";
import {
  type AnalysisJob,
  type LeasedAnalysisJob,
  type AnalysisJobIdentifier,
} from "../../domain/analysis-job";
import { type AnalysisJobSearchCriteria } from "../../domain/criteria";
import { type DomainError } from "../../domain/shared";

export type AnalysisJobPage = Readonly<{
  items: ReadonlyArray<AnalysisJob>;
}>;

export type AnalysisJobRepository = Readonly<{
  find: (identifier: AnalysisJobIdentifier) => ResultAsync<AnalysisJob, DomainError>;
  search: (criteria: AnalysisJobSearchCriteria) => ResultAsync<AnalysisJobPage, DomainError>;
  persist: (job: AnalysisJob) => ResultAsync<void, DomainError>;
  // DB lease 取得: 1 件だけ条件付き UPDATE して LeasedAnalysisJob を返す
  acquireLease: (
    leaseOwner: string,
    leaseDurationMs: number,
    now: Date,
  ) => ResultAsync<LeasedAnalysisJob | null, DomainError>;
}>;
