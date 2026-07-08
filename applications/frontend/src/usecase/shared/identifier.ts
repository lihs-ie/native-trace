import { type Result, ok, err } from "neverthrow";
import { type DomainError, validationFailed } from "../../domain/shared";
import { type EntropyProvider } from "../port/entropy-provider";

/**
 * ULID を生成して brand 型 smart constructor に通す共通ヘルパー。
 * factory が null を返す経路は実 ULID では発火しないが、cast で null を
 * ブランド型として下流に流す代わりに定義済みエラー（validationFailed）へ落とす。
 */
export const generateIdentifier = <T>(
  entropyProvider: EntropyProvider,
  factory: (raw: string) => T | null,
  fieldName: string,
): Result<T, DomainError> => {
  const raw = entropyProvider.generateUlid();
  const identifier = factory(raw);
  if (identifier === null) {
    return err(validationFailed(fieldName, "識別子の生成に失敗しました"));
  }
  return ok(identifier);
};
