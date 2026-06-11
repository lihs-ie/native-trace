import { describe, it, expect, vi, beforeEach } from "vitest";
import { okAsync, errAsync } from "neverthrow";
import { createDefinePracticeSection, type DefinePracticeSectionDependencies } from "./index";
import { type TransactionManager } from "../port/transaction-manager";
import { type EntropyProvider } from "../port/entropy-provider";
import { type Clock } from "../port/clock";
import { type Logger } from "../port/logger";
import {
  type ActiveMaterial,
  type MaterialIdentifier,
  type MaterialTitle,
} from "../../domain/material";
import { notFound } from "../../domain/shared";

const VALID_BODY_TEXT = "Hello world, this is a sample English text for practice.";

const makeActiveMaterial = (): ActiveMaterial => ({
  type: "active",
  identifier: "01MATERIAL" as MaterialIdentifier,
  title: "Test Material" as MaterialTitle,
  source: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
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
  now: () => new Date("2026-01-01T00:00:00Z"),
});

const makeLogger = (): Logger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const makeDependencies = (
  overrides?: Partial<DefinePracticeSectionDependencies>,
): DefinePracticeSectionDependencies => ({
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
  transactionManager: makePassthroughTransactionManager(),
  entropyProvider: makeEntropyProvider(),
  clock: makeClock(),
  logger: makeLogger(),
  ...overrides,
});

describe("definePracticeSection", () => {
  beforeEach(() => {
    ulidCounter = 0;
  });

  it("creates section series and initial section", async () => {
    const deps = makeDependencies();
    const execute = createDefinePracticeSection(deps);

    const result = await execute({
      material: "01MATERIAL",
      title: "Chapter 1",
      bodyText: VALID_BODY_TEXT,
      displayOrder: 0,
    });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.sectionSeries.title).toBe("Chapter 1");
    expect(output.sectionSeries.displayOrder).toBe(0);
    expect(output.section.version).toBe(1);
    expect(output.section.bodyText).toBe(VALID_BODY_TEXT);
    // events include both sectionSeriesCreated and sectionCreated
    expect(output.events.some((e) => e.type === "sectionSeriesCreated")).toBe(true);
    expect(output.events.some((e) => e.type === "sectionCreated")).toBe(true);
  });

  it("validation first: empty material fails before repository is called", async () => {
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
    const execute = createDefinePracticeSection(deps);

    const result = await execute({
      material: "",
      title: "Chapter 1",
      bodyText: VALID_BODY_TEXT,
      displayOrder: 0,
    });

    expect(result.isErr()).toBe(true);
    expect(findCalled).toBe(false);
  });

  it("validation first: empty body text fails before repository is called", async () => {
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
    const execute = createDefinePracticeSection(deps);

    const result = await execute({
      material: "01MATERIAL",
      title: "Chapter 1",
      bodyText: "",
      displayOrder: 0,
    });

    expect(result.isErr()).toBe(true);
    expect(findCalled).toBe(false);
  });

  it("validation first: body text with insufficient english chars fails before repository is called", async () => {
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
    const execute = createDefinePracticeSection(deps);

    const result = await execute({
      material: "01MATERIAL",
      title: "Chapter 1",
      bodyText: "これは日本語テキストです。英語がほとんどありません。", // insufficient English
      displayOrder: 0,
    });

    expect(result.isErr()).toBe(true);
    expect(findCalled).toBe(false);
  });

  it("domain rule: fails if material does not exist", async () => {
    const deps = makeDependencies({
      materialRepository: {
        find: () => errAsync(notFound("material", "01MATERIAL")),
        search: () => okAsync({ items: [], total: 0 }),
        persist: () => okAsync(undefined),
      },
    });
    const execute = createDefinePracticeSection(deps);

    const result = await execute({
      material: "01MATERIAL",
      title: "Chapter 1",
      bodyText: VALID_BODY_TEXT,
      displayOrder: 0,
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("notFound");
  });

  it("both section series and section are persisted", async () => {
    const persistedSeries: string[] = [];
    const persistedSections: string[] = [];

    const deps = makeDependencies({
      sectionSeriesRepository: {
        find: () => errAsync(notFound("sectionSeries", "x")),
        search: () => okAsync({ items: [], total: 0 }),
        persist: (ss) => {
          persistedSeries.push(ss.identifier as string);
          return okAsync(undefined);
        },
      },
      sectionRepository: {
        find: () => errAsync(notFound("section", "x")),
        findLatestInSeries: () => errAsync(notFound("section", "x")),
        findLatestVersionNumber: () => errAsync(notFound("section", "x")),
        search: () => okAsync({ items: [], total: 0 }),
        persist: (s) => {
          persistedSections.push(s.identifier as string);
          return okAsync(undefined);
        },
      },
    });
    const execute = createDefinePracticeSection(deps);

    const result = await execute({
      material: "01MATERIAL",
      title: "Chapter 1",
      bodyText: VALID_BODY_TEXT,
      displayOrder: 0,
    });

    expect(result.isOk()).toBe(true);
    expect(persistedSeries).toHaveLength(1);
    expect(persistedSections).toHaveLength(1);
  });
});
