import { describe, it, expect } from "vitest";
import { okAsync, errAsync } from "neverthrow";
import {
  createReviewPracticeHistory,
  type ReviewPracticeHistoryDependencies,
} from "./index";
import { notFound } from "../../domain/shared";
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
import { type MaterialIdentifier } from "../../domain/material";

const makeSectionSeries = (): ActiveSectionSeries => ({
  type: "active",
  identifier: "01SERIES" as SectionSeriesIdentifier,
  material: "01MATERIAL" as MaterialIdentifier,
  title: "Chapter 1" as SectionTitle,
  displayOrder: 0 as SectionDisplayOrder,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
});

const makeSection = (): ActiveSection => ({
  type: "active",
  identifier: "01SECTION" as SectionIdentifier,
  sectionSeries: "01SERIES" as SectionSeriesIdentifier,
  version: 1 as SectionVersion,
  bodyText: "Hello world this is English practice." as SectionBodyText,
  createdAt: new Date("2026-01-01T00:00:00Z"),
});

const makeDependencies = (
  overrides?: Partial<ReviewPracticeHistoryDependencies>,
): ReviewPracticeHistoryDependencies => ({
  sectionSeriesRepository: {
    find: () => okAsync(makeSectionSeries()),
    search: () => okAsync({ items: [], total: 0 }),
    persist: () => okAsync(undefined),
  },
  sectionRepository: {
    find: () => okAsync(makeSection()),
    findLatestInSeries: () => okAsync(makeSection()),
    findLatestVersionNumber: () => okAsync(1),
    search: () => okAsync({ items: [makeSection()], total: 1 }),
    persist: () => okAsync(undefined),
  },
  recordingAttemptRepository: {
    find: () => errAsync(notFound("recordingAttempt", "x")),
    findSaving: () => errAsync(notFound("recordingAttempt", "x")),
    search: () => okAsync({ items: [], total: 0 }),
    persist: () => okAsync(undefined),
  },
  analysisRunRepository: {
    find: () => errAsync(notFound("analysisRun", "x")),
    search: () => okAsync({ items: [], total: 0 }),
    persist: () => okAsync(undefined),
    updateStatus: () => okAsync(undefined),
  },
  assessmentResultRepository: {
    find: () => errAsync(notFound("assessmentResult", "x")),
    search: () => okAsync({ items: [] }),
    persist: () => okAsync(undefined),
  },
  ...overrides,
});

describe("reviewPracticeHistory", () => {
  it("returns history grouped by sectionSeries", async () => {
    const deps = makeDependencies();
    const execute = createReviewPracticeHistory(deps);

    const result = await execute({ sectionSeries: "01SERIES" });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.sectionSeriesGroups).toHaveLength(1);
    expect(output.sectionSeriesGroups[0].sectionSeriesIdentifier).toBe("01SERIES");
    expect(output.sectionSeriesGroups[0].title).toBe("Chapter 1");
  });

  it("returns section versions with recording attempts", async () => {
    const deps = makeDependencies();
    const execute = createReviewPracticeHistory(deps);

    const result = await execute({ sectionSeries: "01SERIES" });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.sectionSeriesGroups[0].sectionVersions).toHaveLength(1);
    expect(output.sectionSeriesGroups[0].sectionVersions[0].version).toBe(1);
    expect(output.sectionSeriesGroups[0].sectionVersions[0].recordingAttempts).toHaveLength(0);
  });

  it("returns pagination metadata", async () => {
    const deps = makeDependencies();
    const execute = createReviewPracticeHistory(deps);

    const result = await execute({
      sectionSeries: "01SERIES",
      pagination: { offset: 0, limit: 10 },
    });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.page.offset).toBe(0);
    expect(output.page.limit).toBe(10);
  });

  it("returns validation error for empty sectionSeries id", async () => {
    const deps = makeDependencies();
    const execute = createReviewPracticeHistory(deps);

    const result = await execute({ sectionSeries: "" });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("validationFailed");
  });

  it("returns notFound when sectionSeries does not exist", async () => {
    const deps = makeDependencies({
      sectionSeriesRepository: {
        find: () => errAsync(notFound("sectionSeries", "missing")),
        search: () => okAsync({ items: [], total: 0 }),
        persist: () => okAsync(undefined),
      },
    });
    const execute = createReviewPracticeHistory(deps);

    const result = await execute({ sectionSeries: "missing" });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("notFound");
  });
});
