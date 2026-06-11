import { describe, it, expect } from "vitest";
import {
  createSectionTitle,
  createSectionDisplayOrder,
  createSectionSeriesIdentifier,
  createSectionSeriesAggregate,
  reviseSectionSeries,
  retireSectionSeries,
} from "../section-series";
import { createMaterialIdentifier } from "../material";

const makeSeriesIdentifier = () => {
  const id = createSectionSeriesIdentifier("01HTEST000000000002");
  if (id === null) throw new Error("unexpected null identifier");
  return id;
};

const makeMaterialIdentifier = () => {
  const id = createMaterialIdentifier("01HTEST000000000001");
  if (id === null) throw new Error("unexpected null identifier");
  return id;
};

const makeTitle = (value = "Test Section") => {
  const result = createSectionTitle(value);
  if (result.isErr()) throw new Error("unexpected title error");
  return result._unsafeUnwrap();
};

const makeDisplayOrder = (value = 0) => {
  const result = createSectionDisplayOrder(value);
  if (result.isErr()) throw new Error("unexpected displayOrder error");
  return result._unsafeUnwrap();
};

describe("createSectionTitle", () => {
  it("空文字はエラーを返す", () => {
    const result = createSectionTitle("");
    expect(result.isErr()).toBe(true);
  });

  it("空白のみはエラーを返す", () => {
    const result = createSectionTitle("   ");
    expect(result.isErr()).toBe(true);
  });

  it("有効な文字列は成功する", () => {
    const result = createSectionTitle("Intro");
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe("Intro");
  });

  it("前後空白はトリミングされる", () => {
    const result = createSectionTitle("  trimmed  ");
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe("trimmed");
  });
});

describe("createSectionDisplayOrder", () => {
  it("0は有効", () => {
    const result = createSectionDisplayOrder(0);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(0);
  });

  it("正の整数は有効", () => {
    const result = createSectionDisplayOrder(5);
    expect(result.isOk()).toBe(true);
  });

  it("負数はエラーを返す", () => {
    const result = createSectionDisplayOrder(-1);
    expect(result.isErr()).toBe(true);
  });

  it("小数はエラーを返す", () => {
    const result = createSectionDisplayOrder(1.5);
    expect(result.isErr()).toBe(true);
  });
});

describe("createSectionSeriesAggregate", () => {
  it("ActiveSectionSeries を作成しイベントを返す", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const output = createSectionSeriesAggregate({
      identifier: makeSeriesIdentifier(),
      material: makeMaterialIdentifier(),
      title: makeTitle(),
      displayOrder: makeDisplayOrder(1),
      now,
    });

    expect(output.sectionSeries.type).toBe("active");
    expect(output.events).toHaveLength(1);
    expect(output.events[0].type).toBe("sectionSeriesCreated");
  });
});

describe("reviseSectionSeries", () => {
  it("タイトルと displayOrder が更新される", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const laterTime = new Date("2026-01-02T00:00:00Z");
    const { sectionSeries } = createSectionSeriesAggregate({
      identifier: makeSeriesIdentifier(),
      material: makeMaterialIdentifier(),
      title: makeTitle("Original"),
      displayOrder: makeDisplayOrder(0),
      now,
    });

    const revisedTitle = makeTitle("Revised");
    const output = reviseSectionSeries(sectionSeries, {
      title: revisedTitle,
      displayOrder: makeDisplayOrder(2),
      now: laterTime,
    });

    expect(output.sectionSeries.title).toBe(revisedTitle);
    expect(output.sectionSeries.displayOrder).toBe(2);
    expect(output.sectionSeries.updatedAt).toBe(laterTime);
    expect(output.events[0].type).toBe("sectionSeriesRevised");
  });
});

describe("retireSectionSeries", () => {
  it("DeletedSectionSeries に遷移しイベントを返す", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const deletedAt = new Date("2026-06-01T00:00:00Z");
    const { sectionSeries } = createSectionSeriesAggregate({
      identifier: makeSeriesIdentifier(),
      material: makeMaterialIdentifier(),
      title: makeTitle(),
      displayOrder: makeDisplayOrder(),
      now,
    });

    const output = retireSectionSeries(sectionSeries, deletedAt);

    expect(output.sectionSeries.type).toBe("deleted");
    expect(output.sectionSeries.deletedAt).toBe(deletedAt);
    expect(output.events[0].type).toBe("sectionSeriesRetired");
  });
});
