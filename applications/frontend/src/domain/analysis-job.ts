import { err, ok } from "neverthrow";
import { type Result } from "neverthrow";
import {
  type Brand,
  type DomainError,
  type NonEmptyList,
  createNonEmptyBrandedString,
  invalidStateTransition,
} from "./shared";
import { type AnalysisRunIdentifier } from "./analysis-run";

export type AnalysisJobIdentifier = Brand<string, "AnalysisJobIdentifier">;
export type AnalysisLeaseToken = Brand<string, "AnalysisLeaseToken">;

export const createAnalysisJobIdentifier = (value: string): AnalysisJobIdentifier | null =>
  createNonEmptyBrandedString<AnalysisJobIdentifier>(value);

export const createAnalysisLeaseToken = (value: string): AnalysisLeaseToken | null =>
  createNonEmptyBrandedString<AnalysisLeaseToken>(value);

export type EngineType = "cloud" | "oss_worker";

/** retryAnalysisJob の再試行までの待機時間（ミリ秒）。 */
export const ANALYSIS_JOB_RETRY_DELAY_MILLISECONDS = 30_000;

/** AnalysisJob の既定最大試行回数（呼び出し側で指定がない場合のデフォルト）。 */
export const DEFAULT_ANALYSIS_JOB_MAX_ATTEMPTS = 3;

export type QueuedAnalysisJob = Readonly<{
  type: "queued";
  identifier: AnalysisJobIdentifier;
  analysisRun: AnalysisRunIdentifier;
  engine: EngineType;
  engineConfigJson: string;
  priority: number;
  attemptCount: number;
  maxAttempts: number;
  nextRunAt: Date;
  queuedAt: Date;
  createdAt: Date;
}>;

export type LeasedAnalysisJob = Readonly<{
  type: "leased";
  identifier: AnalysisJobIdentifier;
  analysisRun: AnalysisRunIdentifier;
  engine: EngineType;
  engineConfigJson: string;
  priority: number;
  attemptCount: number;
  maxAttempts: number;
  leaseToken: AnalysisLeaseToken;
  leasedUntil: Date;
  leaseOwner: string;
  nextRunAt: Date;
  queuedAt: Date;
  createdAt: Date;
}>;

export type RunningAnalysisJob = Readonly<{
  type: "running";
  identifier: AnalysisJobIdentifier;
  analysisRun: AnalysisRunIdentifier;
  engine: EngineType;
  engineConfigJson: string;
  priority: number;
  attemptCount: number;
  maxAttempts: number;
  leaseToken: AnalysisLeaseToken;
  leasedUntil: Date;
  leaseOwner: string;
  startedAt: Date;
  queuedAt: Date;
  createdAt: Date;
}>;

export type SucceededAnalysisJob = Readonly<{
  type: "succeeded";
  identifier: AnalysisJobIdentifier;
  analysisRun: AnalysisRunIdentifier;
  engine: EngineType;
  engineConfigJson: string;
  completedAt: Date;
  queuedAt: Date;
  createdAt: Date;
}>;

export type FailedAnalysisJob = Readonly<{
  type: "failed";
  identifier: AnalysisJobIdentifier;
  analysisRun: AnalysisRunIdentifier;
  engine: EngineType;
  engineConfigJson: string;
  completedAt: Date;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  queuedAt: Date;
  createdAt: Date;
}>;

export type CanceledAnalysisJob = Readonly<{
  type: "canceled";
  identifier: AnalysisJobIdentifier;
  analysisRun: AnalysisRunIdentifier;
  engine: EngineType;
  engineConfigJson: string;
  canceledAt: Date;
  queuedAt: Date;
  createdAt: Date;
}>;

export type AnalysisJob =
  | QueuedAnalysisJob
  | LeasedAnalysisJob
  | RunningAnalysisJob
  | SucceededAnalysisJob
  | FailedAnalysisJob
  | CanceledAnalysisJob;

// ドメインイベント
export type AnalysisJobQueued = Readonly<{
  type: "analysisJobQueued";
  analysisJob: QueuedAnalysisJob;
  occurredAt: Date;
}>;
export type AnalysisJobLeased = Readonly<{
  type: "analysisJobLeased";
  analysisJob: LeasedAnalysisJob;
  occurredAt: Date;
}>;
export type AnalysisJobStarted = Readonly<{
  type: "analysisJobStarted";
  analysisJob: RunningAnalysisJob;
  occurredAt: Date;
}>;
export type AnalysisJobSucceeded = Readonly<{
  type: "analysisJobSucceeded";
  analysisJob: SucceededAnalysisJob;
  occurredAt: Date;
}>;
export type AnalysisJobFailed = Readonly<{
  type: "analysisJobFailed";
  analysisJob: FailedAnalysisJob;
  occurredAt: Date;
}>;
export type AnalysisJobCanceled = Readonly<{
  type: "analysisJobCanceled";
  analysisJob: CanceledAnalysisJob;
  occurredAt: Date;
}>;

export type CreateAnalysisJobOutput = Readonly<{
  analysisJob: QueuedAnalysisJob;
  events: NonEmptyList<AnalysisJobQueued>;
}>;

export const createAnalysisJob = (
  input: Readonly<{
    identifier: AnalysisJobIdentifier;
    analysisRun: AnalysisRunIdentifier;
    engine: EngineType;
    engineConfigJson: string;
    priority?: number;
    maxAttempts?: number;
    now: Date;
  }>,
): CreateAnalysisJobOutput => {
  const job: QueuedAnalysisJob = {
    type: "queued",
    identifier: input.identifier,
    analysisRun: input.analysisRun,
    engine: input.engine,
    engineConfigJson: input.engineConfigJson,
    priority: input.priority ?? 0,
    attemptCount: 0,
    maxAttempts: input.maxAttempts ?? DEFAULT_ANALYSIS_JOB_MAX_ATTEMPTS,
    nextRunAt: input.now,
    queuedAt: input.now,
    createdAt: input.now,
  };
  return {
    analysisJob: job,
    events: [{ type: "analysisJobQueued", analysisJob: job, occurredAt: input.now }],
  };
};

export type LeaseAnalysisJobOutput = Readonly<{
  analysisJob: LeasedAnalysisJob;
  events: NonEmptyList<AnalysisJobLeased>;
}>;

export const leaseAnalysisJob = (
  job: QueuedAnalysisJob,
  leaseToken: AnalysisLeaseToken,
  leaseOwner: string,
  leasedUntil: Date,
  now: Date,
): LeaseAnalysisJobOutput => {
  const leased: LeasedAnalysisJob = {
    ...job,
    type: "leased",
    leaseToken,
    leasedUntil,
    leaseOwner,
    attemptCount: job.attemptCount + 1,
  };
  return {
    analysisJob: leased,
    events: [{ type: "analysisJobLeased", analysisJob: leased, occurredAt: now }],
  };
};

export type StartAnalysisJobOutput = Readonly<{
  analysisJob: RunningAnalysisJob;
  events: NonEmptyList<AnalysisJobStarted>;
}>;

export const startAnalysisJob = (job: LeasedAnalysisJob, now: Date): StartAnalysisJobOutput => {
  const running: RunningAnalysisJob = {
    ...job,
    type: "running",
    startedAt: now,
  };
  return {
    analysisJob: running,
    events: [{ type: "analysisJobStarted", analysisJob: running, occurredAt: now }],
  };
};

export type CompleteAnalysisJobOutput = Readonly<{
  analysisJob: SucceededAnalysisJob;
  events: NonEmptyList<AnalysisJobSucceeded>;
}>;

export const completeAnalysisJob = (
  job: RunningAnalysisJob,
  now: Date,
): CompleteAnalysisJobOutput => {
  const succeeded: SucceededAnalysisJob = {
    type: "succeeded",
    identifier: job.identifier,
    analysisRun: job.analysisRun,
    engine: job.engine,
    engineConfigJson: job.engineConfigJson,
    completedAt: now,
    queuedAt: job.queuedAt,
    createdAt: job.createdAt,
  };
  return {
    analysisJob: succeeded,
    events: [
      {
        type: "analysisJobSucceeded",
        analysisJob: succeeded,
        occurredAt: now,
      },
    ],
  };
};

export type FailAnalysisJobOutput = Readonly<{
  analysisJob: FailedAnalysisJob;
  events: NonEmptyList<AnalysisJobFailed>;
}>;

export const failAnalysisJob = (
  job: RunningAnalysisJob,
  errorCode: string | null,
  errorMessage: string | null,
  now: Date,
): FailAnalysisJobOutput => {
  const failed: FailedAnalysisJob = {
    type: "failed",
    identifier: job.identifier,
    analysisRun: job.analysisRun,
    engine: job.engine,
    engineConfigJson: job.engineConfigJson,
    completedAt: now,
    lastErrorCode: errorCode,
    lastErrorMessage: errorMessage,
    queuedAt: job.queuedAt,
    createdAt: job.createdAt,
  };
  return {
    analysisJob: failed,
    events: [{ type: "analysisJobFailed", analysisJob: failed, occurredAt: now }],
  };
};

export type CancelAnalysisJobOutput = Readonly<{
  analysisJob: CanceledAnalysisJob;
  events: NonEmptyList<AnalysisJobCanceled>;
}>;

export const cancelAnalysisJob = (
  job: QueuedAnalysisJob | LeasedAnalysisJob | RunningAnalysisJob,
  now: Date,
): CancelAnalysisJobOutput => {
  const canceled: CanceledAnalysisJob = {
    type: "canceled",
    identifier: job.identifier,
    analysisRun: job.analysisRun,
    engine: job.engine,
    engineConfigJson: job.engineConfigJson,
    canceledAt: now,
    queuedAt: job.queuedAt,
    createdAt: job.createdAt,
  };
  return {
    analysisJob: canceled,
    events: [
      {
        type: "analysisJobCanceled",
        analysisJob: canceled,
        occurredAt: now,
      },
    ],
  };
};

export type RetryAnalysisJobOutput = Readonly<{
  analysisJob: QueuedAnalysisJob;
  events: NonEmptyList<AnalysisJobQueued>;
}>;

export const retryAnalysisJob = (
  job: LeasedAnalysisJob | RunningAnalysisJob,
  failureKind: "retryable" | "nonRetryable",
  now: Date,
): Result<RetryAnalysisJobOutput, DomainError> => {
  if (failureKind !== "retryable") {
    return err(invalidStateTransition(job.type, "queued", "retryable 失敗のみ再試行できます"));
  }
  if (job.attemptCount >= job.maxAttempts) {
    return err(
      invalidStateTransition(
        job.type,
        "queued",
        `試行回数が上限（${job.maxAttempts}回）に達しています`,
      ),
    );
  }
  const queued: QueuedAnalysisJob = {
    type: "queued",
    identifier: job.identifier,
    analysisRun: job.analysisRun,
    engine: job.engine,
    engineConfigJson: job.engineConfigJson,
    priority: job.priority,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    nextRunAt: new Date(now.getTime() + ANALYSIS_JOB_RETRY_DELAY_MILLISECONDS), // 30 秒後に再試行
    queuedAt: now,
    createdAt: job.createdAt,
  };
  return ok({
    analysisJob: queued,
    events: [{ type: "analysisJobQueued", analysisJob: queued, occurredAt: now }],
  });
};
