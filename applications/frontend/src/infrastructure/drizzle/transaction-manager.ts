import { type TransactionManager } from "../../usecase/port/transaction-manager";
import { type ResultAsync } from "neverthrow";
import { type DomainError } from "../../domain/shared";

// DrizzleDatabase は後続フェーズで実トランザクション実装時に使用する
export const createDrizzleTransactionManager = (): TransactionManager => ({
  execute: <T>(work: () => ResultAsync<T, DomainError>): ResultAsync<T, DomainError> => {
    // MVP: better-sqlite3 は単一スレッド同期 DB なので
    // トランザクション境界の完全実装は後続フェーズで行う
    // 現時点では work() をそのまま実行する
    return work();
  },
});
