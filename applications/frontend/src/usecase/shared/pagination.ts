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

  const fallback = defaultPagination();
  const offset: Offset | null =
    input.offset !== undefined ? createOffset(input.offset) : fallback.offset;
  const limit: Limit | null = input.limit !== undefined ? createLimit(input.limit) : fallback.limit;

  if (offset === null || limit === null) return defaultPagination();

  return {
    type: "offset",
    offset,
    limit,
  };
};

const buildPage = (offsetValue: number, limitValue: number): Pagination => {
  const offset = createOffset(offsetValue);
  const limit = createLimit(limitValue);
  if (offset === null || limit === null) return defaultPagination();
  return { type: "offset", offset, limit };
};

/** 「最新 1 件だけ取る」ための固定ページ */
export const singleItemPage = (): Pagination => buildPage(0, 1);

/**
 * 実質無制限に全件取るための固定ページ（現行 1000 を踏襲）。
 * `createLimit` の上限は 100 のため、1000 は `buildPage` の検証を通らず
 * defaultPagination（limit 20）にフォールバックしてしまう。挙動を変えないため
 * ここだけキャストを閉じ込めて現行値をそのまま保持する。
 */
export const unboundedPage = (): Pagination => ({
  type: "offset",
  offset: 0 as Offset,
  limit: 1000 as Limit,
});

export const firstPage = (limit: number): Pagination => buildPage(0, limit);
