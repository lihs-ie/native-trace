import { describe, it, expect, vi } from "vitest";
import { okAsync, errAsync } from "neverthrow";
import {
  createRetirePracticeSectionSeries,
  type RetirePracticeSectionSeriesDependencies,
} from "./index";
import { type TransactionManager } from "../port/transaction-manager";
import { type Clock } from "../port/clock";
import { type Logger } from "../port/logger";
import { type MaterialIdentifier } from "../../domain/material";
import {
  type ActiveSectionSeries,
  type SectionSeriesIdentifier,
  type SectionTitle,
  type SectionDisplayOrder,
} from "../../domain/section-series";
import { notFound } from "../../domain/shared";

const makeActiveSeries = (overrides?: Partial<ActiveSectionSeries>): ActiveSectionSeries => ({
  type: "active",
  identifier: "01SERIES001" as SectionSeriesIdentifier,
  material: "01MATERIAL" as MaterialIdentifier,
  title: "Chapter 1" as SectionTitle,
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
  series: ActiveSectionSeries,
  overrides?: Partial<RetirePracticeSectionSeriesDependencies>,
): RetirePracticeSectionSeriesDependencies => ({
  sectionSeriesRepository: {
    find: () => okAsync(series),
    search: () => okAsync({ items: [], total: 0 }),
    persist: () => okAsync(undefined),
  },
  transactionManager: makePassthroughTransactionManager(),
  clock: makeClock(),
  logger: makeLogger(),
  ...overrides,
});

describe("retirePracticeSectionSeries", () => {
  it("retires active section series and returns deleted output", async () => {
    const series = makeActiveSeries();
    const deps = makeDependencies(series);
    const execute = createRetirePracticeSectionSeries(deps);

    const result = await execute({ sectionSeries: "01SERIES001" });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.sectionSeries.identifier).toBe("01SERIES001");
    expect(output.sectionSeries.title).toBe("Chapter 1");
    expect(typeof output.sectionSeries.deletedAt).toBe("string");
    expect(output.events[0].type).toBe("sectionSeriesRetired");
  });

  it("validation first: empty sectionSeries ID fails before repository is called", async () => {
    let findCalled = false;
    const series = makeActiveSeries();
    const deps = makeDependencies(series, {
      sectionSeriesRepository: {
        find: () => {
          findCalled = true;
          return okAsync(series);
        },
        search: () => okAsync({ items: [], total: 0 }),
        persist: () => okAsync(undefined),
      },
    });
    const execute = createRetirePracticeSectionSeries(deps);

    const result = await execute({ sectionSeries: "" });

    expect(result.isErr()).toBe(true);
    expect(findCalled).toBe(false);
  });

  it("domain rule: returns notFound if section series does not exist", async () => {
    const series = makeActiveSeries();
    const deps = makeDependencies(series, {
      sectionSeriesRepository: {
        find: () => errAsync(notFound("sectionSeries", "01SERIES001")),
        search: () => okAsync({ items: [], total: 0 }),
        persist: () => okAsync(undefined),
      },
    });
    const execute = createRetirePracticeSectionSeries(deps);

    const result = await execute({ sectionSeries: "01SERIES001" });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("notFound");
  });

  it("deletedAt in output matches clock.now()", async () => {
    const series = makeActiveSeries();
    const expectedDate = new Date("2026-02-01T00:00:00Z");
    const deps = makeDependencies(series);
    const execute = createRetirePracticeSectionSeries(deps);

    const result = await execute({ sectionSeries: "01SERIES001" });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().sectionSeries.deletedAt).toBe(expectedDate.toISOString());
  });
});
