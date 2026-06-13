import { describe, it, expect } from "vitest";
import { okAsync, errAsync } from "neverthrow";
import { createViewMaterialPracticePlan, type ViewMaterialPracticePlanDependencies } from "./index";
import type { MaterialDetailStatsRepository } from "../../usecase/port/material-detail-stats-repository";
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
import {
  type ActiveSection,
  type SectionIdentifier,
  type SectionVersion,
  type SectionBodyText,
} from "../../domain/section";
import { notFound } from "../../domain/shared";

const makeActiveMaterial = (): ActiveMaterial => ({
  type: "active",
  identifier: "01MATERIAL" as MaterialIdentifier,
  title: "My Material" as MaterialTitle,
  source: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
});

const makeActiveSeries = (order: number = 0): ActiveSectionSeries => ({
  type: "active",
  identifier: `01SERIES${order}` as SectionSeriesIdentifier,
  material: "01MATERIAL" as MaterialIdentifier,
  title: `Series ${order}` as SectionTitle,
  displayOrder: order as SectionDisplayOrder,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
});

const makeActiveSection = (seriesId: string, version: number = 1): ActiveSection => ({
  type: "active",
  identifier: `01SECT${version}` as SectionIdentifier,
  sectionSeries: seriesId as SectionSeriesIdentifier,
  version: version as SectionVersion,
  bodyText: "Hello world sample text for testing." as SectionBodyText,
  createdAt: new Date("2026-01-01T00:00:00Z"),
});

const makeEmptyMaterialDetailStatsRepository = (): MaterialDetailStatsRepository => ({
  findStatsBySectionSeries: (_identifiers, _latestBodyTextBySeries) => okAsync(new Map()),
});

const makeDependencies = (
  overrides: Partial<ViewMaterialPracticePlanDependencies> = {},
): ViewMaterialPracticePlanDependencies => ({
  materialRepository: {
    find: () => okAsync(makeActiveMaterial()),
    search: () => okAsync({ items: [], total: 0 }),
    persist: () => okAsync(undefined),
  },
  sectionSeriesRepository: {
    find: () => errAsync(notFound("sectionSeries", "x")),
    search: () => okAsync({ items: [], total: 0 }),
    persist: () => okAsync(undefined),
  },
  sectionRepository: {
    find: () => errAsync(notFound("section", "x")),
    findLatestInSeries: () => errAsync(notFound("section", "x")),
    findLatestVersionNumber: () => errAsync(notFound("section", "x")),
    search: () => okAsync({ items: [], total: 0 }),
    persist: () => okAsync(undefined),
  },
  materialDetailStatsRepository: makeEmptyMaterialDetailStatsRepository(),
  ...overrides,
});

describe("viewMaterialPracticePlan", () => {
  it("returns material with empty series when no sections exist", async () => {
    const deps = makeDependencies();
    const execute = createViewMaterialPracticePlan(deps);

    const result = await execute({ material: "01MATERIAL" });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.material.identifier).toBe("01MATERIAL");
    expect(output.sectionSeriesItems).toHaveLength(0);
  });

  it("returns section series with latest section", async () => {
    const series = makeActiveSeries(0);
    const section = makeActiveSection(series.identifier, 1);

    const deps = makeDependencies({
      sectionSeriesRepository: {
        find: () => errAsync(notFound("sectionSeries", "x")),
        search: () => okAsync({ items: [series], total: 1 }),
        persist: () => okAsync(undefined),
      },
      sectionRepository: {
        find: () => errAsync(notFound("section", "x")),
        findLatestInSeries: () => okAsync(section),
        findLatestVersionNumber: () => okAsync(1),
        search: () => okAsync({ items: [section], total: 1 }),
        persist: () => okAsync(undefined),
      },
    });
    const execute = createViewMaterialPracticePlan(deps);

    const result = await execute({ material: "01MATERIAL" });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.sectionSeriesItems).toHaveLength(1);
    expect(output.sectionSeriesItems[0].title).toBe("Series 0");
    expect(output.sectionSeriesItems[0].latestSection).not.toBeNull();
    expect(output.sectionSeriesItems[0].latestSection!.version).toBe(1);
  });

  it("latestSection is null when series has no sections", async () => {
    const series = makeActiveSeries(0);

    const deps = makeDependencies({
      sectionSeriesRepository: {
        find: () => errAsync(notFound("sectionSeries", "x")),
        search: () => okAsync({ items: [series], total: 1 }),
        persist: () => okAsync(undefined),
      },
    });
    const execute = createViewMaterialPracticePlan(deps);

    const result = await execute({ material: "01MATERIAL" });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.sectionSeriesItems[0].latestSection).toBeNull();
  });

  it("validation first: empty material ID fails before repository is called", async () => {
    let findCalled = false;
    const deps = makeDependencies({
      materialRepository: {
        find: () => {
          findCalled = true;
          return okAsync(makeActiveMaterial());
        },
        search: () => okAsync({ items: [], total: 0 }),
        persist: () => okAsync(undefined),
      },
    });
    const execute = createViewMaterialPracticePlan(deps);

    const result = await execute({ material: "" });

    expect(result.isErr()).toBe(true);
    expect(findCalled).toBe(false);
  });

  it("domain rule: returns notFound if material does not exist", async () => {
    const deps = makeDependencies({
      materialRepository: {
        find: () => errAsync(notFound("material", "01MATERIAL")),
        search: () => okAsync({ items: [], total: 0 }),
        persist: () => okAsync(undefined),
      },
    });
    const execute = createViewMaterialPracticePlan(deps);

    const result = await execute({ material: "01MATERIAL" });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("notFound");
  });

  it("includes version summaries for all section versions", async () => {
    const series = makeActiveSeries(0);
    const section1 = makeActiveSection(series.identifier, 1);
    const section2 = makeActiveSection(series.identifier, 2);

    const deps = makeDependencies({
      sectionSeriesRepository: {
        find: () => errAsync(notFound("sectionSeries", "x")),
        search: () => okAsync({ items: [series], total: 1 }),
        persist: () => okAsync(undefined),
      },
      sectionRepository: {
        find: () => errAsync(notFound("section", "x")),
        findLatestInSeries: () => okAsync(section2),
        findLatestVersionNumber: () => okAsync(2),
        search: () => okAsync({ items: [section2, section1], total: 2 }),
        persist: () => okAsync(undefined),
      },
    });
    const execute = createViewMaterialPracticePlan(deps);

    const result = await execute({ material: "01MATERIAL" });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.sectionSeriesItems[0].versionSummaries).toHaveLength(2);
    expect(output.sectionSeriesItems[0].latestSection!.version).toBe(2);
  });
});
