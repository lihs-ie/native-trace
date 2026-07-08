import { okAsync, errAsync, type ResultAsync } from "neverthrow";
import { type DomainError } from "../../../domain/shared";

/**
 * リポジトリ boilerplate の共通化（W26）。
 *
 * `okAsync(null).andThen(() => { try { ... } catch (e) { errAsync({...} + DomainError cast) } })`
 * の定型を置き換える。cast なしの型付きリテラルで `persistenceFailed` を返すため、
 * 判別 union の型検査が効く。
 *
 * work が同期で値を返す場合に使う。work 内で `Result` / `ResultAsync` を返す
 * 既存箇所（notFound の早期 return 等）は `tryPersistenceResult` を使う。
 */
export const tryPersistence = <Output>(work: () => Output): ResultAsync<Output, DomainError> =>
  okAsync(null).andThen(() => {
    try {
      return okAsync(work());
    } catch (caught) {
      return errAsync<Output, DomainError>({
        type: "persistenceFailed",
        reason: String(caught),
      });
    }
  });

/**
 * `tryPersistence` の andThen 版。work 自体が `ResultAsync` を返す
 * （途中で notFound 等の DomainError を返し分ける）メソッドに使う。
 */
export const tryPersistenceResult = <Output>(
  work: () => ResultAsync<Output, DomainError>,
): ResultAsync<Output, DomainError> =>
  okAsync(null).andThen(() => {
    try {
      return work();
    } catch (caught) {
      return errAsync<Output, DomainError>({
        type: "persistenceFailed",
        reason: String(caught),
      });
    }
  });
