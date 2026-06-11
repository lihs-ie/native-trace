import { describe, it, expect, vi, beforeEach } from "vitest";
import { okAsync, errAsync } from "neverthrow";
import { createRevisePracticeSection, type RevisePracticeSectionDependencies } from "./index";
import { type TransactionManager } from "../port/transaction-manager";
import { type EntropyProvider } from "../port/entropy-provider";
import { type Clock } from "../port/clock";
import { type Logger } from "../port/logger";
import { type MaterialIdentifier } from "../../domain/material";
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

const VALID_BODY_TEXT = "Hello world, this is a sample English text for practice.";
const VALID_BODY_TEXT_V2 =
  "The quick brown fox jumps over the lazy dog, a classic English pangram.";

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

const makeActiveSection = (version: number = 1): ActiveSection => ({
  type: "active",
  identifier: `01SECT${version}` as SectionIdentifier,
  sectionSeries: "01SERIES001" as SectionSeriesIdentifier,
  version: version as SectionVersion,
  bodyText: VALID_BODY_TEXT as SectionBodyText,
  createdAt: new Date("2026-01-01T00:00:00Z"),
});

let ulidCounter = 0;

const makeEntropyProvider = (): EntropyProvider => ({
  generateUlid: () => `01ULID${String(ulidCounter++).padStart(6, "0")}`,
  generateUuidV4: () => "00000000-0000-4000-8000-000000000000",
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
  latestSection: ActiveSection,
  overrides?: Partial<RevisePracticeSectionDependencies>,
): RevisePracticeSectionDependencies => ({
  sectionSeriesRepository: {
    find: () => okAsync(series),
    search: () => okAsync({ items: [], total: 0 }),
    persist: () => okAsync(undefined),
  },
  sectionRepository: {
    find: () => errAsync(notFound("section", "x")),
    findLatestInSeries: () => okAsync(latestSection),
    findLatestVersionNumber: () => okAsync(latestSection.version as number),
    search: () => okAsync({ items: [], total: 0 }),
    persist: () => okAsync(undefined),
  },
  transactionManager: makePassthroughTransactionManager(),
  entropyProvider: makeEntropyProvider(),
  clock: makeClock(),
  logger: makeLogger(),
  ...overrides,
});

describe("revisePracticeSection", () => {
  beforeEach(() => {
    ulidCounter = 0;
  });

  it("body text change creates new section version", async () => {
    const series = makeActiveSeries();
    const section = makeActiveSection(1);
    const deps = makeDependencies(series, section);
    const execute = createRevisePracticeSection(deps);

    const result = await execute({
      sectionSeries: "01SERIES001",
      bodyText: VALID_BODY_TEXT_V2,
    });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.newSection).not.toBeNull();
    expect(output.newSection!.version).toBe(2);
    expect(output.newSection!.bodyText).toBe(VALID_BODY_TEXT_V2);
    expect(output.previousLatestSection).not.toBeNull();
    expect(output.previousLatestSection!.version).toBe(1);
    expect(output.events.some((e) => e.type === "sectionCreated")).toBe(true);
  });

  it("metadata-only change does not create new section version (newSection is null)", async () => {
    const series = makeActiveSeries();
    const section = makeActiveSection(1);
    const deps = makeDependencies(series, section);
    const execute = createRevisePracticeSection(deps);

    const result = await execute({
      sectionSeries: "01SERIES001",
      title: "New Chapter Title",
    });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.newSection).toBeNull();
    expect(output.previousLatestSection).toBeNull();
    expect(output.sectionSeries.title).toBe("New Chapter Title");
    expect(output.events.some((e) => e.type === "sectionSeriesRevised")).toBe(true);
    expect(output.events.some((e) => e.type === "sectionCreated")).toBe(false);
  });

  it("display order change alone does not create new section", async () => {
    const series = makeActiveSeries();
    const section = makeActiveSection(1);
    const deps = makeDependencies(series, section);
    const execute = createRevisePracticeSection(deps);

    const result = await execute({
      sectionSeries: "01SERIES001",
      displayOrder: 2,
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().newSection).toBeNull();
    expect(result._unsafeUnwrap().sectionSeries.displayOrder).toBe(2);
  });

  it("validation first: no fields specified fails before repository is called", async () => {
    let findCalled = false;
    const series = makeActiveSeries();
    const section = makeActiveSection(1);
    const deps = makeDependencies(series, section, {
      sectionSeriesRepository: {
        find: () => {
          findCalled = true;
          return okAsync(series);
        },
        search: () => okAsync({ items: [], total: 0 }),
        persist: () => okAsync(undefined),
      },
    });
    const execute = createRevisePracticeSection(deps);

    const result = await execute({ sectionSeries: "01SERIES001" });

    expect(result.isErr()).toBe(true);
    expect(findCalled).toBe(false);
  });

  it("domain rule: returns notFound if section series does not exist", async () => {
    const series = makeActiveSeries();
    const section = makeActiveSection(1);
    const deps = makeDependencies(series, section, {
      sectionSeriesRepository: {
        find: () => errAsync(notFound("sectionSeries", "01SERIES001")),
        search: () => okAsync({ items: [], total: 0 }),
        persist: () => okAsync(undefined),
      },
    });
    const execute = createRevisePracticeSection(deps);

    const result = await execute({
      sectionSeries: "01SERIES001",
      title: "New Title",
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("notFound");
  });

  it("validation first: insufficient english body text fails before repository is called", async () => {
    let findCalled = false;
    const series = makeActiveSeries();
    const section = makeActiveSection(1);
    const deps = makeDependencies(series, section, {
      sectionSeriesRepository: {
        find: () => {
          findCalled = true;
          return okAsync(series);
        },
        search: () => okAsync({ items: [], total: 0 }),
        persist: () => okAsync(undefined),
      },
    });
    const execute = createRevisePracticeSection(deps);

    const result = await execute({
      sectionSeries: "01SERIES001",
      bodyText: "これは日本語テキストです。英語がほとんどありません。",
    });

    expect(result.isErr()).toBe(true);
    expect(findCalled).toBe(false);
  });

  it("new section version is previous + 1", async () => {
    const series = makeActiveSeries();
    const section = makeActiveSection(3); // already on version 3
    const deps = makeDependencies(series, section, {
      sectionRepository: {
        find: () => errAsync(notFound("section", "x")),
        findLatestInSeries: () => okAsync(section),
        findLatestVersionNumber: () => okAsync(3),
        search: () => okAsync({ items: [], total: 0 }),
        persist: () => okAsync(undefined),
      },
    });
    const execute = createRevisePracticeSection(deps);

    const result = await execute({
      sectionSeries: "01SERIES001",
      bodyText: VALID_BODY_TEXT_V2,
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().newSection!.version).toBe(4);
  });
});
