/**
 * 成功レスポンス envelope のユニットテスト
 */

import { describe, it, expect } from "vitest";
import { successResponse, paginatedResponse } from "./response";

describe("successResponse", () => {
  it("data と meta.requestIdentifier を含む envelope を返す", async () => {
    const response = successResponse({ foo: "bar" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { foo: string };
      meta: { requestIdentifier: string };
    };
    expect(body.data.foo).toBe("bar");
    expect(body.meta.requestIdentifier).toMatch(/^req_/);
  });

  it("指定した status コードで返す", () => {
    const response = successResponse({}, 201);
    expect(response.status).toBe(201);
  });
});

describe("paginatedResponse", () => {
  it("data / page / meta を含む envelope を返す", async () => {
    const response = paginatedResponse([{ id: "1" }], { offset: 0, limit: 20, total: 1 });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: Array<{ id: string }>;
      page: { type: string; offset: number; limit: number; total: number };
      meta: { requestIdentifier: string };
    };
    expect(body.data).toHaveLength(1);
    expect(body.page.type).toBe("offset");
    expect(body.page.total).toBe(1);
    expect(body.meta.requestIdentifier).toMatch(/^req_/);
  });
});
