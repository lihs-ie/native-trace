import { type NonEmptyList } from "./shared";
import { type SectionIdentifier } from "./section";
import { type AudioFileIdentifier } from "./audio-file";

declare const __brand: unique symbol;
type Brand<T, B> = T & { readonly [__brand]: B };

export type RecordingAttemptIdentifier = Brand<
  string,
  "RecordingAttemptIdentifier"
>;
export type RecordingDuration = Brand<number, "RecordingDuration">;
export type OriginalFileName = Brand<string, "OriginalFileName">;
export type RecordingFailureReason = Brand<string, "RecordingFailureReason">;

export const createRecordingAttemptIdentifier = (
  value: string,
): RecordingAttemptIdentifier | null =>
  value.trim().length > 0 ? (value as RecordingAttemptIdentifier) : null;

export const createRecordingDuration = (
  milliseconds: number,
): RecordingDuration | null =>
  milliseconds > 0 ? (milliseconds as RecordingDuration) : null;

export const createOriginalFileName = (
  value: string,
): OriginalFileName | null =>
  value.trim().length > 0 ? (value as OriginalFileName) : null;

export const createRecordingFailureReason = (
  value: string,
): RecordingFailureReason => value as RecordingFailureReason;

export type BrowserInfo = Readonly<{
  browserName: string;
  deviceType: "pc" | "mobile";
  recordingApiType: string;
  userAgent: string;
}>;

export type RecordingOrigin =
  | Readonly<{
      type: "browser_recording";
      startedAt: Date;
      endedAt: Date;
      browserInfo: BrowserInfo;
    }>
  | Readonly<{
      type: "uploaded_file";
      originalFileName: OriginalFileName;
      uploadedAt: Date;
    }>;

export type SavingRecordingAttempt = Readonly<{
  type: "saving";
  identifier: RecordingAttemptIdentifier;
  section: SectionIdentifier;
  inputKind: RecordingOrigin["type"];
  createdAt: Date;
}>;

export type ReadyRecordingAttempt = Readonly<{
  type: "ready";
  identifier: RecordingAttemptIdentifier;
  section: SectionIdentifier;
  audioFile: AudioFileIdentifier;
  origin: RecordingOrigin;
  duration: RecordingDuration;
  createdAt: Date;
}>;

export type FailedRecordingAttempt = Readonly<{
  type: "failed";
  identifier: RecordingAttemptIdentifier;
  section: SectionIdentifier;
  inputKind: RecordingOrigin["type"];
  failedAt: Date;
  failureReason: RecordingFailureReason;
}>;

export type DeletedRecordingAttempt = Readonly<{
  type: "deleted";
  identifier: RecordingAttemptIdentifier;
  section: SectionIdentifier;
  deletedAt: Date;
}>;

export type RecordingAttempt =
  | SavingRecordingAttempt
  | ReadyRecordingAttempt
  | FailedRecordingAttempt
  | DeletedRecordingAttempt;

export type RecordingAttemptStarted = Readonly<{
  type: "recordingAttemptStarted";
  recordingAttempt: SavingRecordingAttempt;
  section: SectionIdentifier;
  occurredAt: Date;
}>;

export type RecordingAttemptSaved = Readonly<{
  type: "recordingAttemptSaved";
  recordingAttempt: ReadyRecordingAttempt;
  audioFile: AudioFileIdentifier;
  occurredAt: Date;
}>;

export type RecordingAttemptFailed = Readonly<{
  type: "recordingAttemptFailed";
  recordingAttempt: FailedRecordingAttempt;
  failureReason: RecordingFailureReason;
  occurredAt: Date;
}>;

export type RecordingAttemptDeleted = Readonly<{
  type: "recordingAttemptDeleted";
  recordingAttempt: DeletedRecordingAttempt;
  occurredAt: Date;
}>;

export type StartRecordingAttemptOutput = Readonly<{
  recordingAttempt: SavingRecordingAttempt;
  events: NonEmptyList<RecordingAttemptStarted>;
}>;

export const startRecordingAttempt = (
  input: Readonly<{
    identifier: RecordingAttemptIdentifier;
    section: SectionIdentifier;
    inputKind: RecordingOrigin["type"];
    now: Date;
  }>,
): StartRecordingAttemptOutput => {
  const recordingAttempt: SavingRecordingAttempt = {
    type: "saving",
    identifier: input.identifier,
    section: input.section,
    inputKind: input.inputKind,
    createdAt: input.now,
  };
  return {
    recordingAttempt,
    events: [
      {
        type: "recordingAttemptStarted",
        recordingAttempt,
        section: input.section,
        occurredAt: input.now,
      },
    ],
  };
};

export type RecordingMetadata = Readonly<{
  origin: RecordingOrigin;
  duration: RecordingDuration;
}>;

export type MarkRecordingAttemptReadyOutput = Readonly<{
  recordingAttempt: ReadyRecordingAttempt;
  events: NonEmptyList<RecordingAttemptSaved>;
}>;

export const markRecordingAttemptReady = (
  savingAttempt: SavingRecordingAttempt,
  audioFile: AudioFileIdentifier,
  metadata: RecordingMetadata,
): MarkRecordingAttemptReadyOutput => {
  const recordingAttempt: ReadyRecordingAttempt = {
    type: "ready",
    identifier: savingAttempt.identifier,
    section: savingAttempt.section,
    audioFile,
    origin: metadata.origin,
    duration: metadata.duration,
    createdAt: savingAttempt.createdAt,
  };
  return {
    recordingAttempt,
    events: [
      {
        type: "recordingAttemptSaved",
        recordingAttempt,
        audioFile,
        occurredAt: new Date(),
      },
    ],
  };
};

export type MarkRecordingAttemptFailedOutput = Readonly<{
  recordingAttempt: FailedRecordingAttempt;
  events: NonEmptyList<RecordingAttemptFailed>;
}>;

export const markRecordingAttemptFailed = (
  savingAttempt: SavingRecordingAttempt,
  failureReason: RecordingFailureReason,
  now: Date,
): MarkRecordingAttemptFailedOutput => {
  const recordingAttempt: FailedRecordingAttempt = {
    type: "failed",
    identifier: savingAttempt.identifier,
    section: savingAttempt.section,
    inputKind: savingAttempt.inputKind,
    failedAt: now,
    failureReason,
  };
  return {
    recordingAttempt,
    events: [
      {
        type: "recordingAttemptFailed",
        recordingAttempt,
        failureReason,
        occurredAt: now,
      },
    ],
  };
};

export type DeleteRecordingAttemptOutput = Readonly<{
  recordingAttempt: DeletedRecordingAttempt;
  events: NonEmptyList<RecordingAttemptDeleted>;
}>;

export const deleteRecordingAttempt = (
  attempt: ReadyRecordingAttempt,
  now: Date,
): DeleteRecordingAttemptOutput => {
  const recordingAttempt: DeletedRecordingAttempt = {
    type: "deleted",
    identifier: attempt.identifier,
    section: attempt.section,
    deletedAt: now,
  };
  return {
    recordingAttempt,
    events: [
      {
        type: "recordingAttemptDeleted",
        recordingAttempt,
        occurredAt: now,
      },
    ],
  };
};
