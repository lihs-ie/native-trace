/**
 * ResultAsync ヘルパー: UseCase の ResultAsync を envelope へ変換する薄いラッパ。
 */

import type { ResultAsync } from "neverthrow";
import type { DomainError } from "../../../../domain/shared";
import { successResponse } from "./response";
import { domainErrorToResponse } from "./errors";

export const handleResult = async <T>(
  result: ResultAsync<T, DomainError>,
  toData: (output: T) => Response,
): Promise<Response> => {
  const settled = await result;
  if (settled.isErr()) {
    return domainErrorToResponse(settled.error);
  }
  return toData(settled.value);
};

export const handleResultWithStatus = async <T>(
  result: ResultAsync<T, DomainError>,
  status: number,
  toData: (output: T) => unknown,
): Promise<Response> => {
  const settled = await result;
  if (settled.isErr()) {
    return domainErrorToResponse(settled.error);
  }
  return successResponse(toData(settled.value), status);
};
