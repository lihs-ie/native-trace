import { describe, it, expect } from "vitest";
import { okAsync, errAsync } from "neverthrow";
import { createBrowsePracticeMaterials } from "./index";
import { type MaterialRepository, type MaterialPage } from "../port/material-repository";
import { notFound } from "../../domain/shared";
import {
  type ActiveMaterial,
  type MaterialIdentifier,
  type MaterialTitle,
} from "../../domain/material";

const makeActiveMaterial = (overrides?: Partial<ActiveMaterial>): ActiveMaterial => ({
  type: "active",
  identifier: "01HXYZ" as MaterialIdentifier,
  title: "Test Material" as MaterialTitle,
  source: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
  ...overrides,
});

const makeMaterialRepository = (page: MaterialPage): MaterialRepository => ({
  find: () => okAsync(makeActiveMaterial()),
  search: () => okAsync(page),
  persist: () => okAsync(undefined),
});

describe("browsePracticeMaterials", () => {
  it("returns material list with page metadata", async () => {
    const material = makeActiveMaterial();
    const repository = makeMaterialRepository({ items: [material], total: 1 });
    const execute = createBrowsePracticeMaterials({ materialRepository: repository });

    const result = await execute({ pagination: { offset: 0, limit: 10 } });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.materials).toHaveLength(1);
    expect(output.materials[0].identifier).toBe("01HXYZ");
    expect(output.materials[0].title).toBe("Test Material");
    expect(output.page.offset).toBe(0);
    expect(output.page.limit).toBe(10);
    expect(output.page.total).toBe(1);
  });

  it("uses default pagination when not provided", async () => {
    const repository = makeMaterialRepository({ items: [], total: 0 });
    const execute = createBrowsePracticeMaterials({ materialRepository: repository });

    const result = await execute({});

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.page.offset).toBe(0);
    expect(output.page.limit).toBe(20);
  });

  it("validation first: negative offset fails before repository is called", async () => {
    let repositoryCalled = false;
    const repository: MaterialRepository = {
      find: () => okAsync(makeActiveMaterial()),
      search: () => {
        repositoryCalled = true;
        return okAsync({ items: [], total: 0 });
      },
      persist: () => okAsync(undefined),
    };

    const execute = createBrowsePracticeMaterials({ materialRepository: repository });
    const result = await execute({ pagination: { offset: -1 } });

    expect(result.isErr()).toBe(true);
    expect(repositoryCalled).toBe(false);
  });

  it("propagates repository error", async () => {
    const repository: MaterialRepository = {
      find: () => okAsync(makeActiveMaterial()),
      search: () => errAsync(notFound("material", "x")),
      persist: () => okAsync(undefined),
    };

    const execute = createBrowsePracticeMaterials({ materialRepository: repository });
    const result = await execute({});

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("notFound");
  });

  it("maps source type to output", async () => {
    const material = makeActiveMaterial({
      source: { sourceType: "ted", url: null, sourceTitle: null, speakerName: null },
    });
    const repository = makeMaterialRepository({ items: [material], total: 1 });
    const execute = createBrowsePracticeMaterials({ materialRepository: repository });

    const result = await execute({});
    expect(result._unsafeUnwrap().materials[0].sourceType).toBe("ted");
  });

  it("validation first: limit over 100 fails before repository is called", async () => {
    let repositoryCalled = false;
    const repository: MaterialRepository = {
      find: () => okAsync(makeActiveMaterial()),
      search: () => {
        repositoryCalled = true;
        return okAsync({ items: [], total: 0 });
      },
      persist: () => okAsync(undefined),
    };

    const execute = createBrowsePracticeMaterials({ materialRepository: repository });
    const result = await execute({ pagination: { limit: 200 } });

    expect(result.isErr()).toBe(true);
    expect(repositoryCalled).toBe(false);
  });
});
