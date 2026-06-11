import { type ResultAsync } from "neverthrow";
import {
  type RecordingAttempt,
  type ReadyRecordingAttempt,
  type SavingRecordingAttempt,
  type RecordingAttemptIdentifier,
} from "../../domain/recording-attempt";
import { type RecordingAttemptSearchCriteria } from "../../domain/criteria";
import { type DomainError } from "../../domain/shared";

export type RecordingAttemptPage = Readonly<{
  items: ReadonlyArray<RecordingAttempt>;
  total: number;
}>;

export type RecordingAttemptRepository = Readonly<{
  find: (identifier: RecordingAttemptIdentifier) => ResultAsync<ReadyRecordingAttempt, DomainError>;
  findSaving: (identifier: RecordingAttemptIdentifier) => ResultAsync<SavingRecordingAttempt, DomainError>;
  search: (criteria: RecordingAttemptSearchCriteria) => ResultAsync<RecordingAttemptPage, DomainError>;
  persist: (attempt: RecordingAttempt) => ResultAsync<void, DomainError>;
}>;
