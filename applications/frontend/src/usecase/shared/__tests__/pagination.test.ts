import { describe, it, expect } from "vitest";
import { toDomainPagination } from "../pagination";

describe("toDomainPagination", () => {
  it("空オブジェクトは offset=0 / limit=20 になる", () => {
    const pagination = toDomainPagination({});

    expect(pagination.type).toBe("offset");
    expect(pagination.offset).toBe(0);
    expect(pagination.limit).toBe(20);
  });

  it("有効な offset/limit はそのまま採用される", () => {
    const pagination = toDomainPagination({ offset: 5, limit: 10 });

    expect(pagination.type).toBe("offset");
    expect(pagination.offset).toBe(5);
    expect(pagination.limit).toBe(10);
  });

  it("負の offset は既定値にフォールバックする", () => {
    const pagination = toDomainPagination({ offset: -1 });

    expect(pagination.type).toBe("offset");
    expect(pagination.offset).toBe(0);
    expect(pagination.limit).toBe(20);
  });

  it("limit が上限(100)を超えると既定値にフォールバックする", () => {
    const pagination = toDomainPagination({ limit: 101 });

    expect(pagination.type).toBe("offset");
    expect(pagination.offset).toBe(0);
    expect(pagination.limit).toBe(20);
  });
});
