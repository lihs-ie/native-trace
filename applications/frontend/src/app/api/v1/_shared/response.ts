/**
 * 共通レスポンスヘルパー
 * §3.1 成功レスポンス envelope を組み立てる。
 * requestIdentifier は req_ + UUID。
 */

export type SuccessEnvelope<T> = Readonly<{
  data: T;
  meta: Readonly<{
    requestIdentifier: string;
  }>;
}>;

export type PaginatedEnvelope<T> = Readonly<{
  data: T;
  page: Readonly<{
    type: "offset";
    offset: number;
    limit: number;
    total: number;
  }>;
  meta: Readonly<{
    requestIdentifier: string;
  }>;
}>;

/** `req_` + UUID(ハイフン除去) のリクエスト ID を生成する（W31: 生成形式の唯一の定義） */
export const generateRequestIdentifier = (): string => {
  const uuid = globalThis.crypto.randomUUID().replace(/-/g, "");
  return `req_${uuid}`;
};

export const successResponse = <T>(data: T, status: number = 200): Response => {
  const envelope: SuccessEnvelope<T> = {
    data,
    meta: { requestIdentifier: generateRequestIdentifier() },
  };
  return Response.json(envelope, { status });
};

export const paginatedResponse = <T>(
  data: T,
  page: { offset: number; limit: number; total: number },
  status: number = 200,
): Response => {
  const envelope: PaginatedEnvelope<T> = {
    data,
    page: { type: "offset", ...page },
    meta: { requestIdentifier: generateRequestIdentifier() },
  };
  return Response.json(envelope, { status });
};
