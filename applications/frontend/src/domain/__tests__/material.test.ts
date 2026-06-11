import { describe, it, expect } from "vitest";
import {
  createMaterialIdentifier,
  createMaterialTitle,
  createMaterial,
  reviseMaterial,
  retireMaterial,
  createMaterialSource,
} from "../material";

const makeIdentifier = () => {
  const id = createMaterialIdentifier("01HTEST000000000001");
  if (id === null) throw new Error("unexpected null identifier");
  return id;
};

const makeTitle = (value = "Test Material") => {
  const result = createMaterialTitle(value);
  if (result.isErr()) throw new Error("unexpected title error");
  return result._unsafeUnwrap();
};

describe("createMaterialTitle", () => {
  it("空文字はエラーを返す", () => {
    const result = createMaterialTitle("");
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("validationFailed");
    }
  });

  it("空白のみはエラーを返す", () => {
    const result = createMaterialTitle("   ");
    expect(result.isErr()).toBe(true);
  });

  it("有効なタイトルは成功する", () => {
    const result = createMaterialTitle("My Material");
    expect(result.isOk()).toBe(true);
  });

  it("前後の空白はトリミングされる", () => {
    const result = createMaterialTitle("  trimmed  ");
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe("trimmed");
  });
});

describe("createMaterial", () => {
  it("ActiveMaterial を作成しイベントを返す", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const output = createMaterial({
      identifier: makeIdentifier(),
      title: makeTitle(),
      source: null,
      now,
    });

    expect(output.material.type).toBe("active");
    expect(output.material.createdAt).toBe(now);
    expect(output.material.updatedAt).toBe(now);
    expect(output.events).toHaveLength(1);
    expect(output.events[0].type).toBe("materialCreated");
  });

  it("source付きで作成できる", () => {
    const sourceResult = createMaterialSource({ sourceType: "ted" });
    if (sourceResult.isErr()) throw new Error("unexpected source error");
    const source = sourceResult._unsafeUnwrap();

    const output = createMaterial({
      identifier: makeIdentifier(),
      title: makeTitle(),
      source,
      now: new Date(),
    });

    expect(output.material.source).not.toBeNull();
    expect(output.material.source?.sourceType).toBe("ted");
  });
});

describe("reviseMaterial", () => {
  it("タイトルと source が更新される", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const laterTime = new Date("2026-01-02T00:00:00Z");
    const { material } = createMaterial({
      identifier: makeIdentifier(),
      title: makeTitle("Original"),
      source: null,
      now,
    });

    const revisedTitle = makeTitle("Revised");
    const output = reviseMaterial(material, {
      title: revisedTitle,
      source: null,
      now: laterTime,
    });

    expect(output.material.title).toBe(revisedTitle);
    expect(output.material.updatedAt).toBe(laterTime);
    expect(output.events[0].type).toBe("materialRevised");
    expect(output.events).toHaveLength(1);
  });
});

describe("retireMaterial", () => {
  it("DeletedMaterial に遷移しイベントを返す", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const deletedAt = new Date("2026-06-01T00:00:00Z");
    const { material } = createMaterial({
      identifier: makeIdentifier(),
      title: makeTitle(),
      source: null,
      now,
    });

    const output = retireMaterial(material, deletedAt);

    expect(output.material.type).toBe("deleted");
    expect(output.material.deletedAt).toBe(deletedAt);
    expect(output.events[0].type).toBe("materialRetired");
    expect(output.events).toHaveLength(1);
  });
});
