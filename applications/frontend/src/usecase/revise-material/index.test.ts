import { describe, it, expect, vi } from "vitest";
import { okAsync, errAsync } from "neverthrow";
import { createReviseMaterial, type ReviseMaterialDependencies } from "./index";
import { type TransactionManager } from "../port/transaction-manager";
import { type Clock } from "../port/clock";
import { type Logger } from "../port/logger";
import {
  type ActiveMaterial,
  type MaterialIdentifier,
  type MaterialTitle,
} from "../../domain/material";
import { notFound } from "../../domain/shared";

const makeActiveMaterial = (overrides?: Partial<ActiveMaterial>): ActiveMaterial => ({
  type: "active",
  identifier: "01HXYZ" as MaterialIdentifier,
  title: "Original Title" as MaterialTitle,
  source: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

const makePassthroughTransactionManager = (): TransactionManager => ({
  execute: (work) => work(),
});

const makeClock = (): Clock => ({
  now: () => new Date("2026-02-01T00:00:00Z"),
});

const makeLogger = (): Logger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const makeDependencies = (
  material: ActiveMaterial,
  overrides?: Partial<ReviseMaterialDependencies>,
): ReviseMaterialDependencies => ({
  materialRepository: {
    find: () => okAsync(material),
    search: () => okAsync({ items: [], total: 0 }),
    persist: () => okAsync(undefined),
  },
  transactionManager: makePassthroughTransactionManager(),
  clock: makeClock(),
  logger: makeLogger(),
  ...overrides,
});

describe("reviseMaterial", () => {
  it("revises title when only title is provided", async () => {
    const material = makeActiveMaterial();
    const deps = makeDependencies(material);
    const execute = createReviseMaterial(deps);

    const result = await execute({ material: "01HXYZ", title: "New Title" });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().material.title).toBe("New Title");
    expect(result._unsafeUnwrap().events[0].type).toBe("materialRevised");
  });

  it("validation first: no title and no source fails before repository is called", async () => {
    let findCalled = false;
    const material = makeActiveMaterial();
    const deps = makeDependencies(material, {
      materialRepository: {
        find: () => {
          findCalled = true;
          return okAsync(material);
        },
        search: () => okAsync({ items: [], total: 0 }),
        persist: () => okAsync(undefined),
      },
    });
    const execute = createReviseMaterial(deps);

    const result = await execute({ material: "01HXYZ" });

    expect(result.isErr()).toBe(true);
    expect(findCalled).toBe(false);
  });

  it("validation first: empty material ID fails", async () => {
    let findCalled = false;
    const material = makeActiveMaterial();
    const deps = makeDependencies(material, {
      materialRepository: {
        find: () => {
          findCalled = true;
          return okAsync(material);
        },
        search: () => okAsync({ items: [], total: 0 }),
        persist: () => okAsync(undefined),
      },
    });
    const execute = createReviseMaterial(deps);

    const result = await execute({ material: "", title: "New Title" });

    expect(result.isErr()).toBe(true);
    expect(findCalled).toBe(false);
  });

  it("domain rule: returns notFound if material does not exist", async () => {
    const material = makeActiveMaterial();
    const deps = makeDependencies(material, {
      materialRepository: {
        find: () => errAsync(notFound("material", "01HXYZ")),
        search: () => okAsync({ items: [], total: 0 }),
        persist: () => okAsync(undefined),
      },
    });
    const execute = createReviseMaterial(deps);

    const result = await execute({ material: "01HXYZ", title: "New Title" });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("notFound");
  });

  it("revises source to null when source is set to null", async () => {
    const material = makeActiveMaterial({
      source: { sourceType: "ted", url: null, sourceTitle: null, speakerName: null },
    });
    const deps = makeDependencies(material);
    const execute = createReviseMaterial(deps);

    const result = await execute({ material: "01HXYZ", source: null });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().material.sourceType).toBeNull();
  });

  it("keeps existing title when only source is updated", async () => {
    const material = makeActiveMaterial({ title: "Existing Title" as MaterialTitle });
    const deps = makeDependencies(material);
    const execute = createReviseMaterial(deps);

    const result = await execute({
      material: "01HXYZ",
      source: { sourceType: "youtube" },
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().material.title).toBe("Existing Title");
  });
});
