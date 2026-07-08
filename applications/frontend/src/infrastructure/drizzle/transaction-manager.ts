import { type TransactionManager } from "../../usecase/port/transaction-manager";
import { type DrizzleDatabase } from "./client";
import { type ResultAsync, errAsync, okAsync } from "neverthrow";
import { type DomainError } from "../../domain/shared";

/**
 * createDrizzleTransactionManager
 *
 * better-sqlite3 は同期 DB であり、すべてのリポジトリ操作は実際は同期の DB 呼び出しを
 * ResultAsync で薄くラップしたものに過ぎない。
 * BEGIN/COMMIT/ROLLBACK を work() の前後に置くことで
 * 全操作を単一トランザクションに閉じ込める。
 *
 * - work() が Ok を返す: COMMIT
 * - work() が Err を返す: ROLLBACK
 * - work() 例外: ROLLBACK してから persistenceFailed を返す
 */
export const createDrizzleTransactionManager = (db: DrizzleDatabase): TransactionManager => ({
  execute: <T>(work: () => ResultAsync<T, DomainError>): ResultAsync<T, DomainError> => {
    const client = db.$client;
    return okAsync(undefined).andThen((): ResultAsync<T, DomainError> => {
      try {
        client.exec("BEGIN");
      } catch (e) {
        return errAsync<T, DomainError>({
          type: "persistenceFailed",
          reason: `BEGIN failed: ${String(e)}`,
        });
      }

      return work()
        .andThen((value) => {
          try {
            client.exec("COMMIT");
            return okAsync(value);
          } catch (e) {
            try {
              client.exec("ROLLBACK");
            } catch {
              // ignore rollback error
            }
            return errAsync<T, DomainError>({
              type: "persistenceFailed",
              reason: `COMMIT failed: ${String(e)}`,
            });
          }
        })
        .mapErr((error) => {
          try {
            client.exec("ROLLBACK");
          } catch {
            // ignore rollback error
          }
          return error;
        });
    });
  },
});
