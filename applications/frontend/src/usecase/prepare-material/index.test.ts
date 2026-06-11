import { describe, it, expect, vi } from "vitest";
import { okAsync, errAsync } from "neverthrow";
import { createPrepareMaterial, type PrepareMaterialDependencies } from "./index";
import { type TransactionManager } from "../port/transaction-manager";
import { type EntropyProvider } from "../port/entropy-provider";
import { type Clock } from "../port/clock";
import { type Logger } from "../port/logger";
import {
  type ActiveMaterial,
  type MaterialIdentifier,
  type MaterialTitle,
} from "../../domain/material";
import { validationFailed } from "../../domain/shared";

const makeActiveMaterial = (): ActiveMaterial => ({
  type: "active",
  identifier: "01HXYZTEST01" as MaterialIdentifier,
  title: "Test" as MaterialTitle,
  source: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
});

const makePassthroughTransactionManager = (): TransactionManager => ({
  execute: (work) => work(),
});

const makeEntropyProvider = (): EntropyProvider => ({
  generateUlid: () => "01HXYZTEST01",
  generateUuidV4: () => "00000000-0000-4000-8000-000000000000",
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
  overrides?: Partial<PrepareMaterialDependencies>,
): PrepareMaterialDependencies => ({
  materialRepository: {
    find: () => okAsync(makeActiveMaterial()),
    search: () => okAsync({ items: [], total: 0 }),
    persist: () => okAsync(undefined),
  },
  transactionManager: makePassthroughTransactionManager(),
  entropyProvider: makeEntropyProvider(),
  clock: makeClock(),
  logger: makeLogger(),
  ...overrides,
});

describe("prepareMaterial", () => {
  it("creates a material and returns DTO with events", async () => {
    const deps = makeDependencies();
    const execute = createPrepareMaterial(deps);

    const result = await execute({ title: "My New Material" });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.material.title).toBe("My New Material");
    expect(output.material.sourceType).toBeNull();
    expect(output.events).toHaveLength(1);
    expect(output.events[0].type).toBe("materialCreated");
  });

  it("validation first: empty title fails before repository is called", async () => {
    let persistCalled = false;
    const deps = makeDependencies({
      materialRepository: {
        find: () => okAsync(makeActiveMaterial()),
        search: () => okAsync({ items: [], total: 0 }),
        persist: () => {
          persistCalled = true;
          return okAsync(undefined);
        },
      },
    });
    const execute = createPrepareMaterial(deps);

    const result = await execute({ title: "" });

    expect(result.isErr()).toBe(true);
    expect(persistCalled).toBe(false);
  });

  it("validation first: whitespace-only title fails before repository is called", async () => {
    let persistCalled = false;
    const deps = makeDependencies({
      materialRepository: {
        find: () => okAsync(makeActiveMaterial()),
        search: () => okAsync({ items: [], total: 0 }),
        persist: () => {
          persistCalled = true;
          return okAsync(undefined);
        },
      },
    });
    const execute = createPrepareMaterial(deps);

    const result = await execute({ title: "   " });

    expect(result.isErr()).toBe(true);
    expect(persistCalled).toBe(false);
  });

  it("creates material with source when provided", async () => {
    const deps = makeDependencies();
    const execute = createPrepareMaterial(deps);

    const result = await execute({
      title: "TED Talk Material",
      source: {
        sourceType: "ted",
        sourceUrl: "https://example.com",
        sourceTitle: "My TED Talk",
        speakerName: "John Doe",
      },
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().material.sourceType).toBe("ted");
  });

  it("propagates persistence error", async () => {
    const deps = makeDependencies({
      materialRepository: {
        find: () => okAsync(makeActiveMaterial()),
        search: () => okAsync({ items: [], total: 0 }),
        persist: () => errAsync(validationFailed("db", "db error")),
      },
    });
    const execute = createPrepareMaterial(deps);

    const result = await execute({ title: "Some Title" });

    expect(result.isErr()).toBe(true);
  });

  it("identifier in output matches generated ULID", async () => {
    const deps = makeDependencies();
    const execute = createPrepareMaterial(deps);

    const result = await execute({ title: "Test" });

    expect(result._unsafeUnwrap().material.identifier).toBe("01HXYZTEST01");
  });
});
