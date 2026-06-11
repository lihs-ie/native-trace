import {
  type Pagination,
  type Offset,
  type Limit,
  defaultPagination,
  createOffset,
  createLimit,
} from "../../domain/shared";

export type PaginationInput = Readonly<{
  offset?: number;
  limit?: number;
}>;

/**
 * UseCase 入力の pagination フィールドを Domain Pagination に変換する。
 * 不正値の場合は defaultPagination() にフォールバックする。
 */
export const toDomainPagination = (input?: PaginationInput): Pagination => {
  if (input === undefined) return defaultPagination();

  const offset: Offset | null =
    input.offset !== undefined ? createOffset(input.offset) : (0 as Offset);
  const limit: Limit | null =
    input.limit !== undefined ? createLimit(input.limit) : (20 as Limit);

  if (offset === null || limit === null) return defaultPagination();

  return {
    type: "offset",
    offset,
    limit,
  };
};
