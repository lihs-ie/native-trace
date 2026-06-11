import { describe, it, expect, vi } from "vitest";
import { okAsync, errAsync } from "neverthrow";
import { createReassessPracticeAttempt, type ReassessPracticeAttemptDependencies } from "./index";
import { notFound } from "../../domain/shared";
import {
  type ReadyRecordingAttempt,
  type RecordingAttemptIdentifier,
  type RecordingDuration,
} from "../../domain/recording-attempt";
import { type AudioFileIdentifier } from "../../domain/audio-file";
import { type SectionIdentifier } from "../../domain/section";
import { type Clock } from "../port/clock";
import { type EntropyProvider } from "../port/entropy-provider";
import { type Logger } from "../port/logger";
import { type TransactionManager } from "../port/transaction-manager";

const makeReadyAttempt = (): ReadyRecordingAttempt => ({
  type: "ready",
  identifier: "01ATTEMPT" as RecordingAttemptIdentifier,
  section: "01SECTION" as SectionIdentifier,
  audioFile: "01AUDIOFILE" as AudioFileIdentifier,
  origin: {
    type: "uploaded_file",
    originalFileName: "test.wav" as never,
    uploadedAt: new Date("2026-01-01T00:00:00Z"),
  },
  duration: 5000 as RecordingDuration,
  createdAt: new Date("2026-01-01T00:00:00Z"),
});

let ulidCounter = 0;
const makeEntropyProvider = (): EntropyProvider => ({
  generateUlid: () => `01ULID${String(ulidCounter++).padStart(6, "0")}`,
  generateUuidV4: () => "00000000-0000-4000-8000-000000000000",
});
const makeClock = (): Clock => ({ now: () => new Date("2026-01-01T00:00:00Z") });
const makeLogger = (): Logger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});
const makeTransactionManager = (): TransactionManager => ({ execute: (work) => work() });

const makeDependencies = (
  overrides?: Partial<ReassessPracticeAttemptDependencies>,
): ReassessPracticeAttemptDependencies => ({
  recordingAttemptRepository: {
    find: () => okAsync(makeReadyAttempt()),
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
  analysisJobRepository: {
    find: () => errAsync(notFound("analysisJob", "x")),
    search: () => okAsync({ items: [] }),
    persist: () => okAsync(undefined),
    acquireLease: () => okAsync(null),
  },
  transactionManager: makeTransactionManager(),
  entropyProvider: makeEntropyProvider(),
  clock: makeClock(),
  logger: makeLogger(),
  ...overrides,
});

describe("reassessPracticeAttempt", () => {
  it("creates new AnalysisRun and jobs without overwriting past results", async () => {
    ulidCounter = 0;
    const persistSpy = vi.fn(() => okAsync(undefined));
    const deps = makeDependencies({
      analysisRunRepository: {
        find: () => errAsync(notFound("analysisRun", "x")),
        search: () => okAsync({ items: [], total: 0 }),
        persist: persistSpy,
        updateStatus: () => okAsync(undefined),
      },
    });
    const execute = createReassessPracticeAttempt(deps);

    const result = await execute({
      recordingAttempt: "01ATTEMPT",
      analysisMode: "cloud_only",
    });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.analysisRun.mode).toBe("cloud_only");
    expect(output.analysisJobs).toHaveLength(1);
    expect(output.analysisJobs[0].engine).toBe("cloud");
    // AnalysisRun が新たに persist された
    expect(persistSpy).toHaveBeenCalledOnce();
  });

  it("creates two jobs for comparison mode", async () => {
    ulidCounter = 0;
    const deps = makeDependencies();
    const execute = createReassessPracticeAttempt(deps);

    const result = await execute({
      recordingAttempt: "01ATTEMPT",
      analysisMode: "comparison",
    });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.analysisJobs).toHaveLength(2);
    const engines = output.analysisJobs.map((j) => j.engine);
    expect(engines).toContain("cloud");
    expect(engines).toContain("oss_worker");
  });

  it("returns notFound error for non-ready recording attempt", async () => {
    const deps = makeDependencies({
      recordingAttemptRepository: {
        find: () => errAsync(notFound("recordingAttempt", "01ATTEMPT")),
        findSaving: () => errAsync(notFound("recordingAttempt", "x")),
        search: () => okAsync({ items: [], total: 0 }),
        persist: () => okAsync(undefined),
      },
    });
    const execute = createReassessPracticeAttempt(deps);

    const result = await execute({
      recordingAttempt: "01ATTEMPT",
      analysisMode: "cloud_only",
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("notFound");
  });

  it("returns validation error for empty recordingAttempt id", async () => {
    const deps = makeDependencies();
    const execute = createReassessPracticeAttempt(deps);

    const result = await execute({ recordingAttempt: "", analysisMode: "cloud_only" });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("validationFailed");
  });

  it("emits AnalysisRunStarted and AnalysisJobQueued events", async () => {
    ulidCounter = 0;
    const deps = makeDependencies();
    const execute = createReassessPracticeAttempt(deps);

    const result = await execute({
      recordingAttempt: "01ATTEMPT",
      analysisMode: "cloud_only",
    });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    const eventTypes = output.events.map((e) => e.type);
    expect(eventTypes).toContain("analysisRunStarted");
    expect(eventTypes).toContain("analysisJobQueued");
  });
});
