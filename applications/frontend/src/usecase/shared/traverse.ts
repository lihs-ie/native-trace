import { type ResultAsync, okAsync } from "neverthrow";
import { type DomainError } from "../../domain/shared";

// 前の apply が resolve してから次が始まる逐次実行を保存する。
// Promise.all / ResultAsync.combine への書き換えは禁止（実行順の保存がこのヘルパーの存在理由）。
export const traverseSequentially = <Item, Output>(
  items: readonly Item[],
  apply: (item: Item, index: number) => ResultAsync<Output, DomainError>,
): ResultAsync<Output[], DomainError> =>
  items.reduce(
    (accumulator, item, index) =>
      accumulator.andThen((outputs) =>
        apply(item, index).map((output) => {
          outputs.push(output); // 同一配列に push（O(n²) spread の除去。外部へは同じ配列参照を返すのみ）
          return outputs;
        }),
      ),
    okAsync<Output[], DomainError>([]),
  );
