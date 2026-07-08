import { describe, it, expect } from "vitest";
import {
  createNonEmptyList,
  createOffset,
  createLimit,
  defaultPagination,
  validationFailed,
  notFound,
  invalidStateTransition,
} from "../shared";
import { createScore0To100, createConfidence0To1 } from "../assessment-result";

describe("createNonEmptyList", () => {
  it("空配列からはnullを返す", () => {
    expect(createNonEmptyList([])).toBeNull();
  });

  it("1要素以上の配列からNonEmptyListを返す", () => {
    const result = createNonEmptyList([1, 2, 3]);
    expect(result).toEqual([1, 2, 3]);
  });

  it("1要素の配列からNonEmptyListを返す", () => {
    const result = createNonEmptyList(["only"]);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
  });
});

describe("nonEmptyListHead", () => {
  it("先頭要素を返す", () => {
    const list = createNonEmptyList([10, 20, 30]);
    expect(list![0]).toBe(10);
  });
});

describe("createOffset", () => {
  it("0は有効", () => {
    expect(createOffset(0)).toBe(0);
  });

  it("正数は有効", () => {
    expect(createOffset(100)).toBe(100);
  });

  it("負数はnullを返す", () => {
    expect(createOffset(-1)).toBeNull();
  });
});

describe("createLimit", () => {
  it("1は有効", () => {
    expect(createLimit(1)).toBe(1);
  });

  it("100は有効", () => {
    expect(createLimit(100)).toBe(100);
  });

  it("0はnullを返す", () => {
    expect(createLimit(0)).toBeNull();
  });

  it("101はnullを返す", () => {
    expect(createLimit(101)).toBeNull();
  });
});

describe("defaultPagination", () => {
  it("offset=0 limit=20 で初期化される", () => {
    const pagination = defaultPagination();
    expect(pagination.type).toBe("offset");
    expect(pagination.offset).toBe(0);
    expect(pagination.limit).toBe(20);
  });
});

describe("createScore0To100 (via assessment-result)", () => {
  it("0は有効", () => {
    const result = createScore0To100(0);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(0);
  });

  it("100は有効", () => {
    const result = createScore0To100(100);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(100);
  });

  it("50は有効", () => {
    const result = createScore0To100(50);
    expect(result.isOk()).toBe(true);
  });

  it("-1はエラーを返す", () => {
    const result = createScore0To100(-1);
    expect(result.isErr()).toBe(true);
  });

  it("101はエラーを返す", () => {
    const result = createScore0To100(101);
    expect(result.isErr()).toBe(true);
  });

  it("小数はエラーを返す", () => {
    const result = createScore0To100(50.5);
    expect(result.isErr()).toBe(true);
  });
});

describe("createConfidence0To1 (via assessment-result)", () => {
  it("0は有効", () => {
    const result = createConfidence0To1(0);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(0);
  });

  it("1は有効", () => {
    const result = createConfidence0To1(1);
    expect(result.isOk()).toBe(true);
  });

  it("0.5は有効", () => {
    const result = createConfidence0To1(0.5);
    expect(result.isOk()).toBe(true);
  });

  it("-0.01はエラーを返す", () => {
    const result = createConfidence0To1(-0.01);
    expect(result.isErr()).toBe(true);
  });

  it("1.01はエラーを返す", () => {
    const result = createConfidence0To1(1.01);
    expect(result.isErr()).toBe(true);
  });
});

describe("DomainError ヘルパー", () => {
  it("validationFailed は正しい型を返す", () => {
    const error = validationFailed("field", "reason");
    expect(error.type).toBe("validationFailed");
    expect(error.field).toBe("field");
    expect(error.reason).toBe("reason");
  });

  it("notFound は正しい型を返す", () => {
    const error = notFound("Material", "abc123");
    expect(error.type).toBe("notFound");
    expect(error.resource).toBe("Material");
    expect(error.identifier).toBe("abc123");
  });

  it("invalidStateTransition は正しい型を返す", () => {
    const error = invalidStateTransition("queued", "succeeded", "理由");
    expect(error.type).toBe("invalidStateTransition");
    expect(error.from).toBe("queued");
    expect(error.to).toBe("succeeded");
  });
});
