import { describe, it, expect } from "vitest";
import {
  createAnalysisJobIdentifier,
  createAnalysisLeaseToken,
  createAnalysisJob,
  leaseAnalysisJob,
  startAnalysisJob,
  completeAnalysisJob,
  failAnalysisJob,
  cancelAnalysisJob,
  retryAnalysisJob,
} from "../analysis-job";
import { createAnalysisRunIdentifier } from "../analysis-run";

const makeJobIdentifier = () => {
  const id = createAnalysisJobIdentifier("01HJOB000000000001");
  if (id === null) throw new Error("unexpected null");
  return id;
};

const makeRunIdentifier = () => {
  const id = createAnalysisRunIdentifier("01HRUN000000000001");
  if (id === null) throw new Error("unexpected null");
  return id;
};

const makeLeaseToken = () => {
  const token = createAnalysisLeaseToken("test-lease-token-uuid");
  if (token === null) throw new Error("unexpected null");
  return token;
};

const makeQueuedJob = (maxAttempts = 3) => {
  const now = new Date("2026-01-01T00:00:00Z");
  const output = createAnalysisJob({
    identifier: makeJobIdentifier(),
    analysisRun: makeRunIdentifier(),
    engine: "cloud",
    engineConfigJson: "{}",
    maxAttempts,
    now,
  });
  return { job: output.analysisJob, now };
};

describe("createAnalysisJob", () => {
  it("QueuedAnalysisJob を作成しイベントを返す", () => {
    const { job } = makeQueuedJob();
    expect(job.type).toBe("queued");
    expect(job.attemptCount).toBe(0);
    expect(job.priority).toBe(0);
  });
});

describe("leaseAnalysisJob", () => {
  it("Queued → Leased に遷移する", () => {
    const { job, now } = makeQueuedJob();
    const leasedUntil = new Date(now.getTime() + 60000);
    const output = leaseAnalysisJob(
      job,
      makeLeaseToken(),
      "runner-1",
      leasedUntil,
      now,
    );

    expect(output.analysisJob.type).toBe("leased");
    expect(output.analysisJob.attemptCount).toBe(1);
    expect(output.analysisJob.leaseOwner).toBe("runner-1");
    expect(output.events[0].type).toBe("analysisJobLeased");
  });
});

describe("startAnalysisJob", () => {
  it("Leased → Running に遷移する", () => {
    const { job, now } = makeQueuedJob();
    const leasedUntil = new Date(now.getTime() + 60000);
    const { analysisJob: leased } = leaseAnalysisJob(
      job,
      makeLeaseToken(),
      "runner-1",
      leasedUntil,
      now,
    );
    const output = startAnalysisJob(leased, now);

    expect(output.analysisJob.type).toBe("running");
    expect(output.analysisJob.startedAt).toBe(now);
    expect(output.events[0].type).toBe("analysisJobStarted");
  });
});

describe("completeAnalysisJob", () => {
  it("Running → Succeeded に遷移する", () => {
    const { job, now } = makeQueuedJob();
    const leasedUntil = new Date(now.getTime() + 60000);
    const { analysisJob: leased } = leaseAnalysisJob(
      job,
      makeLeaseToken(),
      "runner-1",
      leasedUntil,
      now,
    );
    const { analysisJob: running } = startAnalysisJob(leased, now);
    const completedAt = new Date(now.getTime() + 5000);
    const output = completeAnalysisJob(running, completedAt);

    expect(output.analysisJob.type).toBe("succeeded");
    expect(output.analysisJob.completedAt).toBe(completedAt);
    expect(output.events[0].type).toBe("analysisJobSucceeded");
  });
});

describe("failAnalysisJob", () => {
  it("Running → Failed に遷移する", () => {
    const { job, now } = makeQueuedJob();
    const leasedUntil = new Date(now.getTime() + 60000);
    const { analysisJob: leased } = leaseAnalysisJob(
      job,
      makeLeaseToken(),
      "runner-1",
      leasedUntil,
      now,
    );
    const { analysisJob: running } = startAnalysisJob(leased, now);
    const failedAt = new Date(now.getTime() + 1000);
    const output = failAnalysisJob(running, "ERR_TIMEOUT", "timeout occurred", failedAt);

    expect(output.analysisJob.type).toBe("failed");
    expect(output.analysisJob.lastErrorCode).toBe("ERR_TIMEOUT");
    expect(output.analysisJob.lastErrorMessage).toBe("timeout occurred");
    expect(output.events[0].type).toBe("analysisJobFailed");
  });
});

describe("cancelAnalysisJob", () => {
  it("Queued → Canceled に遷移する", () => {
    const { job, now } = makeQueuedJob();
    const output = cancelAnalysisJob(job, now);

    expect(output.analysisJob.type).toBe("canceled");
    expect(output.events[0].type).toBe("analysisJobCanceled");
  });
});

describe("retryAnalysisJob", () => {
  it("retryable かつ試行回数未満なら Queued に戻る", () => {
    const { job, now } = makeQueuedJob(3);
    const leasedUntil = new Date(now.getTime() + 60000);
    const { analysisJob: leased } = leaseAnalysisJob(
      job,
      makeLeaseToken(),
      "runner-1",
      leasedUntil,
      now,
    );
    const retryNow = new Date(now.getTime() + 2000);
    const result = retryAnalysisJob(leased, "retryable", retryNow);

    expect(result.isOk()).toBe(true);
    const retried = result._unsafeUnwrap();
    expect(retried.analysisJob.type).toBe("queued");
    expect(retried.events[0].type).toBe("analysisJobQueued");
  });

  it("nonRetryable はエラーを返す", () => {
    const { job, now } = makeQueuedJob(3);
    const leasedUntil = new Date(now.getTime() + 60000);
    const { analysisJob: leased } = leaseAnalysisJob(
      job,
      makeLeaseToken(),
      "runner-1",
      leasedUntil,
      now,
    );
    const result = retryAnalysisJob(leased, "nonRetryable", now);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("invalidStateTransition");
    }
  });

  it("試行回数上限に達している場合はエラーを返す", () => {
    // maxAttempts=1 で 1 回 lease 済み → attemptCount=1 = maxAttempts
    const { job, now } = makeQueuedJob(1);
    const leasedUntil = new Date(now.getTime() + 60000);
    const { analysisJob: leased } = leaseAnalysisJob(
      job,
      makeLeaseToken(),
      "runner-1",
      leasedUntil,
      now,
    );
    // attemptCount=1 >= maxAttempts=1
    const result = retryAnalysisJob(leased, "retryable", now);

    expect(result.isErr()).toBe(true);
  });
});
