import { type NonEmptyList } from "./shared";
import { type RecordingAttemptIdentifier } from "./recording-attempt";
import { type AnalysisJob } from "./analysis-job";

declare const __brand: unique symbol;
type Brand<T, B> = T & { readonly [__brand]: B };

export type AnalysisRunIdentifier = Brand<string, "AnalysisRunIdentifier">;

export const createAnalysisRunIdentifier = (value: string): AnalysisRunIdentifier | null =>
  value.trim().length > 0 ? (value as AnalysisRunIdentifier) : null;

export type AnalysisMode = "cloud_only" | "oss_worker_only" | "comparison";
export type AnalysisRunStatus =
  | "queued"
  | "running"
  | "partial_succeeded"
  | "succeeded"
  | "failed"
  | "canceled";

export type AnalysisRun = Readonly<{
  identifier: AnalysisRunIdentifier;
  recordingAttempt: RecordingAttemptIdentifier;
  mode: AnalysisMode;
  status: AnalysisRunStatus;
  createdAt: Date;
}>;

export type AnalysisRunStarted = Readonly<{
  type: "analysisRunStarted";
  analysisRun: AnalysisRun;
  recordingAttempt: RecordingAttemptIdentifier;
  mode: AnalysisMode;
  occurredAt: Date;
}>;

export type CreateAnalysisRunOutput = Readonly<{
  analysisRun: AnalysisRun;
  events: NonEmptyList<AnalysisRunStarted>;
}>;

export const createAnalysisRun = (
  input: Readonly<{
    identifier: AnalysisRunIdentifier;
    recordingAttempt: RecordingAttemptIdentifier;
    mode: AnalysisMode;
    status?: AnalysisRunStatus;
    now: Date;
  }>,
): CreateAnalysisRunOutput => {
  const analysisRun: AnalysisRun = {
    identifier: input.identifier,
    recordingAttempt: input.recordingAttempt,
    mode: input.mode,
    status: input.status ?? "queued",
    createdAt: input.now,
  };
  return {
    analysisRun,
    events: [
      {
        type: "analysisRunStarted",
        analysisRun,
        recordingAttempt: input.recordingAttempt,
        mode: input.mode,
        occurredAt: input.now,
      },
    ],
  };
};

export const deriveAnalysisRunStatus = (jobs: NonEmptyList<AnalysisJob>): AnalysisRunStatus => {
  const statuses = jobs.map((j) => j.type);
  if (statuses.some((s) => s === "running" || s === "leased")) return "running";
  if (statuses.some((s) => s === "queued")) return "queued";
  if (statuses.every((s) => s === "succeeded")) return "succeeded";
  if (
    statuses.some((s) => s === "succeeded") &&
    statuses.every((s) => s === "succeeded" || s === "failed" || s === "canceled")
  )
    return "partial_succeeded";
  if (statuses.every((s) => s === "canceled")) return "canceled";
  return "failed";
};
