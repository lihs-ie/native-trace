import { type ResultAsync } from "neverthrow";
import { type DomainError } from "../../domain/shared";

export type TransactionManager = Readonly<{
  execute: <T>(work: () => ResultAsync<T, DomainError>) => ResultAsync<T, DomainError>;
}>;
