import { type Brand, type NonEmptyList, createNonEmptyBrandedString } from "./shared";
import { type RecordingAttemptIdentifier } from "./recording-attempt";

export type AudioFileIdentifier = Brand<string, "AudioFileIdentifier">;
export type AudioMimeType = Brand<string, "AudioMimeType">;
export type StorageKey = Brand<string, "StorageKey">;

export const createAudioFileIdentifier = (value: string): AudioFileIdentifier | null =>
  createNonEmptyBrandedString<AudioFileIdentifier>(value);

export const SUPPORTED_AUDIO_MIME_TYPES = [
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
] as const;

export const createAudioMimeType = (value: string): AudioMimeType | null =>
  (SUPPORTED_AUDIO_MIME_TYPES as readonly string[]).includes(value)
    ? (value as AudioMimeType)
    : null;

export const createStorageKey = (value: string): StorageKey | null =>
  createNonEmptyBrandedString<StorageKey>(value);

export type StoredAudioFile = Readonly<{
  type: "stored";
  identifier: AudioFileIdentifier;
  recordingAttempt: RecordingAttemptIdentifier;
  storageKey: StorageKey;
  mimeType: AudioMimeType;
  sizeBytes: number;
  durationMilliseconds: number;
  sha256: string;
  createdAt: Date;
  updatedAt: Date;
}>;

export type DeletionPendingAudioFile = Readonly<{
  type: "deletionPending";
  identifier: AudioFileIdentifier;
  recordingAttempt: RecordingAttemptIdentifier;
  storageKey: StorageKey;
  requestedAt: Date;
}>;

export type DeletedAudioFile = Readonly<{
  type: "deleted";
  identifier: AudioFileIdentifier;
  recordingAttempt: RecordingAttemptIdentifier;
  deletedAt: Date;
}>;

export type DeleteFailedAudioFile = Readonly<{
  type: "deleteFailed";
  identifier: AudioFileIdentifier;
  recordingAttempt: RecordingAttemptIdentifier;
  storageKey: StorageKey;
  failedAt: Date;
  failureReason: string;
}>;

export type AudioFile =
  | StoredAudioFile
  | DeletionPendingAudioFile
  | DeletedAudioFile
  | DeleteFailedAudioFile;

export type AudioFileDeletionRequested = Readonly<{
  type: "audioFileDeletionRequested";
  audioFile: DeletionPendingAudioFile;
  occurredAt: Date;
}>;

export type AudioFileDeleted = Readonly<{
  type: "audioFileDeleted";
  audioFile: DeletedAudioFile;
  occurredAt: Date;
}>;

export type RequestAudioFileDeletionOutput = Readonly<{
  audioFile: DeletionPendingAudioFile;
  events: NonEmptyList<AudioFileDeletionRequested>;
}>;

export const requestAudioFileDeletion = (
  audioFile: StoredAudioFile,
  now: Date,
): RequestAudioFileDeletionOutput => {
  const pending: DeletionPendingAudioFile = {
    type: "deletionPending",
    identifier: audioFile.identifier,
    recordingAttempt: audioFile.recordingAttempt,
    storageKey: audioFile.storageKey,
    requestedAt: now,
  };
  return {
    audioFile: pending,
    events: [
      {
        type: "audioFileDeletionRequested",
        audioFile: pending,
        occurredAt: now,
      },
    ],
  };
};
