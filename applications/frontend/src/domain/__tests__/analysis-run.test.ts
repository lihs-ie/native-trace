import { describe, it, expect } from "vitest";
import { deriveAnalysisRunStatus, createAnalysisRun } from "../analysis-run";
import {
  createAnalysisJob,
  leaseAnalysisJob,
  startAnalysisJob,
  completeAnalysisJob,
  failAnalysisJob,
  cancelAnalysisJob,
  createAnalysisJobIdentifier,
  createAnalysisLeaseToken,
  type AnalysisJob,
} from "../analysis-job";
import { createAnalysisRunIdentifier } from "../analysis-run";
import { createRecordingAttemptIdentifier } from "../recording-attempt";
import { type NonEmptyList } from "../shared";

const makeJobId = (suffix: string) => {
  const id = createAnalysisJobIdentifier(`01HJOB00000000${suffix}`);
  if (!id) throw new Error("null id");
  return id;
};
const makeRunId = () => {
  const id = createAnalysisRunIdentifier("01HRUN000000000001");
  if (!id) throw new Error("null id");
  return id;
};
const makeLeaseToken = () => {
  const token = createAnalysisLeaseToken("test-token");
  if (!token) throw new Error("null token");
  return token;
};
const makeQueuedJob = (suffix = "0001") => {
  const now = new Date();
  return createAnalysisJob({
    identifier: makeJobId(suffix),
    analysisRun: makeRunId(),
    engine: "cloud",
    engineConfigJson: "{}",
    now,
  }).analysisJob;
};
const makeLeasedJob = (suffix = "0001"): AnalysisJob => {
  const now = new Date();
  const queued = makeQueuedJob(suffix);
  return leaseAnalysisJob(
    queued,
    makeLeaseToken(),
    "runner-1",
    new Date(now.getTime() + 60000),
    now,
  ).analysisJob;
};
const makeRunningJob = (suffix = "0001"): AnalysisJob => {
  const now = new Date();
  const leased = makeLeasedJob(suffix);
  if (leased.type !== "leased") throw new Error("expected leased");
  return startAnalysisJob(leased, now).analysisJob;
};
const makeSucceededJob = (suffix = "0001"): AnalysisJob => {
  const now = new Date();
  const running = makeRunningJob(suffix);
  if (running.type !== "running") throw new Error("expected running");
  return completeAnalysisJob(running, now).analysisJob;
};
const makeFailedJob = (suffix = "0001"): AnalysisJob => {
  const now = new Date();
  const running = makeRunningJob(suffix);
  if (running.type !== "running") throw new Error("expected running");
  return failAnalysisJob(running, null, null, now).analysisJob;
};
const makeCanceledJob = (suffix = "0001"): AnalysisJob => {
  const now = new Date();
  const queued = makeQueuedJob(suffix);
  return cancelAnalysisJob(queued, now).analysisJob;
};

describe("deriveAnalysisRunStatus", () => {
  it("running が含まれる → running", () => {
    const jobs: NonEmptyList<AnalysisJob> = [
      makeRunningJob("0001"),
      makeQueuedJob("0002"),
    ];
    expect(deriveAnalysisRunStatus(jobs)).toBe("running");
  });

  it("leased が含まれる → running", () => {
    const jobs: NonEmptyList<AnalysisJob> = [makeLeasedJob("0001")];
    expect(deriveAnalysisRunStatus(jobs)).toBe("running");
  });

  it("queued のみ（実行中なし）→ queued", () => {
    const jobs: NonEmptyList<AnalysisJob> = [makeQueuedJob("0001")];
    expect(deriveAnalysisRunStatus(jobs)).toBe("queued");
  });

  it("全 succeeded → succeeded", () => {
    const jobs: NonEmptyList<AnalysisJob> = [
      makeSucceededJob("0001"),
      makeSucceededJob("0002"),
    ];
    expect(deriveAnalysisRunStatus(jobs)).toBe("succeeded");
  });

  it("1件 succeeded + 残り failed/canceled → partial_succeeded", () => {
    const jobs: NonEmptyList<AnalysisJob> = [
      makeSucceededJob("0001"),
      makeFailedJob("0002"),
      makeCanceledJob("0003"),
    ];
    expect(deriveAnalysisRunStatus(jobs)).toBe("partial_succeeded");
  });

  it("全 canceled → canceled", () => {
    const jobs: NonEmptyList<AnalysisJob> = [
      makeCanceledJob("0001"),
      makeCanceledJob("0002"),
    ];
    expect(deriveAnalysisRunStatus(jobs)).toBe("canceled");
  });

  it("succeeded なし + failed → failed", () => {
    const jobs: NonEmptyList<AnalysisJob> = [
      makeFailedJob("0001"),
      makeCanceledJob("0002"),
    ];
    expect(deriveAnalysisRunStatus(jobs)).toBe("failed");
  });
});

describe("createAnalysisRun", () => {
  it("AnalysisRun を作成しイベントを返す", () => {
    const recordingAttemptId = createRecordingAttemptIdentifier(
      "01HREC000000000001",
    );
    if (!recordingAttemptId) throw new Error("null id");
    const runId = makeRunId();
    const now = new Date("2026-01-01T00:00:00Z");

    const output = createAnalysisRun({
      identifier: runId,
      recordingAttempt: recordingAttemptId,
      mode: "cloud_only",
      now,
    });

    expect(output.analysisRun.mode).toBe("cloud_only");
    expect(output.events).toHaveLength(1);
    expect(output.events[0].type).toBe("analysisRunStarted");
  });
});
