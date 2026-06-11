import { describe, it, expect, vi } from "vitest";
import { okAsync, errAsync } from "neverthrow";
import { createRetireMaterial, type RetireMaterialDependencies } from "./index";
import { type SectionSeriesPage } from "../port/section-series-repository";
import { type TransactionManager } from "../port/transaction-manager";
import { type Clock } from "../port/clock";
import { type Logger } from "../port/logger";
import {
  type ActiveMaterial,
  type MaterialIdentifier,
  type MaterialTitle,
} from "../../domain/material";
import {
  type ActiveSectionSeries,
  type SectionSeriesIdentifier,
  type SectionTitle,
  type SectionDisplayOrder,
} from "../../domain/section-series";
import { notFound } from "../../domain/shared";

const makeActiveMaterial = (overrides?: Partial<ActiveMaterial>): ActiveMaterial => ({
  type: "active",
  identifier: "01MATERIAL" as MaterialIdentifier,
  title: "Test Material" as MaterialTitle,
  source: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

const makeActiveSectionSeries = (
  overrides?: Partial<ActiveSectionSeries>,
): ActiveSectionSeries => ({
  type: "active",
  identifier: "01SRSERIES" as SectionSeriesIdentifier,
  material: "01MATERIAL" as MaterialIdentifier,
  title: "Series 1" as SectionTitle,
  displayOrder: 0 as SectionDisplayOrder,
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
  seriesPage: SectionSeriesPage,
  overrides?: Partial<RetireMaterialDependencies>,
): RetireMaterialDependencies => ({
  materialRepository: {
    find: () => okAsync(material),
    search: () => okAsync({ items: [], total: 0 }),
    persist: () => okAsync(undefined),
  },
  sectionSeriesRepository: {
    find: () => errAsync(notFound("sectionSeries", "x")),
    search: () => okAsync(seriesPage),
    persist: () => okAsync(undefined),
  },
  transactionManager: makePassthroughTransactionManager(),
  clock: makeClock(),
  logger: makeLogger(),
  ...overrides,
});

describe("retireMaterial", () => {
  it("retires material and returns deleted material output", async () => {
    const material = makeActiveMaterial();
    const deps = makeDependencies(material, { items: [], total: 0 });
    const execute = createRetireMaterial(deps);

    const result = await execute({ material: "01MATERIAL" });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.material.identifier).toBe("01MATERIAL");
    expect(typeof output.material.deletedAt).toBe("string");
    expect(output.events[0].type).toBe("materialRetired");
  });

  it("also retires active section series in same transaction", async () => {
    const material = makeActiveMaterial();
    const series = makeActiveSectionSeries();
    const deps = makeDependencies(material, { items: [series], total: 1 });
    const execute = createRetireMaterial(deps);

    const result = await execute({ material: "01MATERIAL" });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.retiredSectionSeriesCount).toBe(1);
    const seriesRetiredEvents = output.events.filter((e) => e.type === "sectionSeriesRetired");
    expect(seriesRetiredEvents).toHaveLength(1);
  });

  it("validation first: empty material ID fails before repository is called", async () => {
    let findCalled = false;
    const material = makeActiveMaterial();
    const deps = makeDependencies(
      material,
      { items: [], total: 0 },
      {
        materialRepository: {
          find: () => {
            findCalled = true;
            return okAsync(material);
          },
          search: () => okAsync({ items: [], total: 0 }),
          persist: () => okAsync(undefined),
        },
      },
    );
    const execute = createRetireMaterial(deps);

    const result = await execute({ material: "" });

    expect(result.isErr()).toBe(true);
    expect(findCalled).toBe(false);
  });

  it("domain rule: returns notFound if material does not exist", async () => {
    const material = makeActiveMaterial();
    const deps = makeDependencies(
      material,
      { items: [], total: 0 },
      {
        materialRepository: {
          find: () => errAsync(notFound("material", "01MATERIAL")),
          search: () => okAsync({ items: [], total: 0 }),
          persist: () => okAsync(undefined),
        },
      },
    );
    const execute = createRetireMaterial(deps);

    const result = await execute({ material: "01MATERIAL" });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("notFound");
  });
});
