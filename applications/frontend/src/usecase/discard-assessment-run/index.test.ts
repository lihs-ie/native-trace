import { describe, it, expect, vi } from "vitest";
import { okAsync, errAsync } from "neverthrow";
import { createDiscardAssessmentRun, type DiscardAssessmentRunDependencies } from "./index";
import { notFound } from "../../domain/shared";
import { type AnalysisRun, type AnalysisRunIdentifier } from "../../domain/analysis-run";
import { type QueuedAnalysisJob, type AnalysisJobIdentifier } from "../../domain/analysis-job";
import { type RecordingAttemptIdentifier } from "../../domain/recording-attempt";
import { type Clock } from "../port/clock";
import { type Logger } from "../port/logger";
import { type TransactionManager } from "../port/transaction-manager";

const makeAnalysisRun = (): AnalysisRun => ({
  identifier: "01RUN" as AnalysisRunIdentifier,
  recordingAttempt: "01ATTEMPT" as RecordingAttemptIdentifier,
  mode: "cloud_only",
  createdAt: new Date("2026-01-01T00:00:00Z"),
});

const makeQueuedJob = (id: string): QueuedAnalysisJob => ({
  type: "queued",
  identifier: id as AnalysisJobIdentifier,
  analysisRun: "01RUN" as AnalysisRunIdentifier,
  engine: "cloud",
  engineConfigJson: "{}",
  priority: 0,
  attemptCount: 0,
  maxAttempts: 3,
  nextRunAt: new Date("2026-01-01T00:00:00Z"),
  queuedAt: new Date("2026-01-01T00:00:00Z"),
  createdAt: new Date("2026-01-01T00:00:00Z"),
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
  overrides?: Partial<DiscardAssessmentRunDependencies>,
): DiscardAssessmentRunDependencies => ({
  analysisRunRepository: {
    find: () => okAsync(makeAnalysisRun()),
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
  assessmentResultRepository: {
    find: () => errAsync(notFound("assessmentResult", "x")),
    search: () => okAsync({ items: [] }),
    persist: () => okAsync(undefined),
  },
  transactionManager: makeTransactionManager(),
  clock: makeClock(),
  logger: makeLogger(),
  ...overrides,
});

describe("discardAssessmentRun", () => {
  it("marks run as discarded", async () => {
    const updateStatusSpy = vi.fn(() => okAsync(undefined));
    const deps = makeDependencies({
      analysisRunRepository: {
        find: () => okAsync(makeAnalysisRun()),
        search: () => okAsync({ items: [], total: 0 }),
        persist: () => okAsync(undefined),
        updateStatus: updateStatusSpy,
      },
    });
    const execute = createDiscardAssessmentRun(deps);

    const result = await execute({ analysisRun: "01RUN" });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().analysisRun.discarded).toBe(true);
    expect(updateStatusSpy).toHaveBeenCalledWith("01RUN", "canceled");
  });

  it("cancels pending jobs under the run", async () => {
    const jobPersistSpy = vi.fn((_job: { type: string }) => okAsync(undefined));
    const deps = makeDependencies({
      analysisJobRepository: {
        find: () => errAsync(notFound("analysisJob", "x")),
        search: () => okAsync({ items: [makeQueuedJob("01JOB"), makeQueuedJob("02JOB")] }),
        persist: jobPersistSpy,
        acquireLease: () => okAsync(null),
      },
    });
    const execute = createDiscardAssessmentRun(deps);

    const result = await execute({ analysisRun: "01RUN" });

    expect(result.isOk()).toBe(true);
    // 2つのジョブが canceled で persist された
    expect(jobPersistSpy).toHaveBeenCalledTimes(2);
    const persistedTypes = jobPersistSpy.mock.calls.map((c) => c[0].type);
    expect(persistedTypes.every((t: string) => t === "canceled")).toBe(true);
  });

  it("returns validation error for empty analysisRun id", async () => {
    const deps = makeDependencies();
    const execute = createDiscardAssessmentRun(deps);

    const result = await execute({ analysisRun: "" });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("validationFailed");
  });

  it("returns notFound when run does not exist", async () => {
    const deps = makeDependencies({
      analysisRunRepository: {
        find: () => errAsync(notFound("analysisRun", "missing")),
        search: () => okAsync({ items: [], total: 0 }),
        persist: () => okAsync(undefined),
        updateStatus: () => okAsync(undefined),
      },
    });
    const execute = createDiscardAssessmentRun(deps);

    const result = await execute({ analysisRun: "missing" });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("notFound");
  });
});
