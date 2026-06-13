import { describe, it, expect, vi } from "vitest";
import { okAsync, errAsync } from "neverthrow";
import { createCancelAssessmentRun, type CancelAssessmentRunDependencies } from "./index";
import { notFound } from "../../domain/shared";
import { type AnalysisRun, type AnalysisRunIdentifier } from "../../domain/analysis-run";
import { type RecordingAttemptIdentifier } from "../../domain/recording-attempt";
import {
  type QueuedAnalysisJob,
  type SucceededAnalysisJob,
  type AnalysisJobIdentifier,
} from "../../domain/analysis-job";
import { type Clock } from "../port/clock";
import { type Logger } from "../port/logger";
import { type TransactionManager } from "../port/transaction-manager";

const makeAnalysisRun = (): AnalysisRun => ({
  identifier: "01RUN" as AnalysisRunIdentifier,
  recordingAttempt: "01ATTEMPT" as RecordingAttemptIdentifier,
  mode: "comparison",
  status: "running",
  createdAt: new Date("2026-01-01T00:00:00Z"),
});

const makeQueuedJob = (identifier: string): QueuedAnalysisJob => ({
  type: "queued",
  identifier: identifier as AnalysisJobIdentifier,
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

const makeSucceededJob = (identifier: string): SucceededAnalysisJob => ({
  type: "succeeded",
  identifier: identifier as AnalysisJobIdentifier,
  analysisRun: "01RUN" as AnalysisRunIdentifier,
  engine: "oss_worker",
  engineConfigJson: "{}",
  completedAt: new Date("2026-01-01T00:00:00Z"),
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
  overrides?: Partial<CancelAssessmentRunDependencies>,
): CancelAssessmentRunDependencies => ({
  analysisRunRepository: {
    find: () => okAsync(makeAnalysisRun()),
    search: () => okAsync({ items: [], total: 0 }),
    persist: () => okAsync(undefined),
    updateStatus: () => okAsync(undefined),
  },
  analysisJobRepository: {
    find: () => errAsync(notFound("analysisJob", "x")),
    search: () => okAsync({ items: [makeQueuedJob("01JOB")] }),
    persist: () => okAsync(undefined),
    acquireLease: () => okAsync(null),
  },
  transactionManager: makeTransactionManager(),
  clock: makeClock(),
  logger: makeLogger(),
  ...overrides,
});

describe("cancelAssessmentRun", () => {
  it("cancels queued jobs and returns updated run status", async () => {
    const deps = makeDependencies();
    const execute = createCancelAssessmentRun(deps);

    const result = await execute({ analysisRun: "01RUN" });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.canceledJobs).toHaveLength(1);
    expect(output.canceledJobs[0].identifier).toBe("01JOB");
    expect(output.events[0].type).toBe("analysisJobCanceled");
  });

  it("recalculates run status using deriveAnalysisRunStatus (not always canceled)", async () => {
    // one succeeded + one queued → after cancel → partial_succeeded
    const deps = makeDependencies({
      analysisJobRepository: {
        find: () => errAsync(notFound("analysisJob", "x")),
        search: () =>
          okAsync({
            items: [makeSucceededJob("01JOB"), makeQueuedJob("02JOB")],
          }),
        persist: () => okAsync(undefined),
        acquireLease: () => okAsync(null),
      },
    });
    const execute = createCancelAssessmentRun(deps);

    const result = await execute({ analysisRun: "01RUN" });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.analysisRun.status).toBe("partial_succeeded");
    expect(output.canceledJobs).toHaveLength(1);
    expect(output.canceledJobs[0].identifier).toBe("02JOB");
  });

  it("returns error when no cancelable jobs exist", async () => {
    const deps = makeDependencies({
      analysisJobRepository: {
        find: () => errAsync(notFound("analysisJob", "x")),
        search: () => okAsync({ items: [makeSucceededJob("01JOB")] }),
        persist: () => okAsync(undefined),
        acquireLease: () => okAsync(null),
      },
    });
    const execute = createCancelAssessmentRun(deps);

    const result = await execute({ analysisRun: "01RUN" });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("validationFailed");
  });

  it("returns validation error for empty analysisRun id", async () => {
    const deps = makeDependencies();
    const execute = createCancelAssessmentRun(deps);

    const result = await execute({ analysisRun: "" });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("validationFailed");
  });

  it("all queued jobs → run status becomes canceled", async () => {
    const deps = makeDependencies({
      analysisJobRepository: {
        find: () => errAsync(notFound("analysisJob", "x")),
        search: () => okAsync({ items: [makeQueuedJob("01JOB"), makeQueuedJob("02JOB")] }),
        persist: () => okAsync(undefined),
        acquireLease: () => okAsync(null),
      },
    });
    const execute = createCancelAssessmentRun(deps);

    const result = await execute({ analysisRun: "01RUN" });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().analysisRun.status).toBe("canceled");
    expect(result._unsafeUnwrap().canceledJobs).toHaveLength(2);
  });
});
