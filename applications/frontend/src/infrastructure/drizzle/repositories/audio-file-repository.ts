import { eq } from "drizzle-orm";
import { type DrizzleDatabase } from "../client";
import { audioFiles } from "../schema";
import { type AudioFileRepository } from "../../../usecase/port/audio-file-repository";
import {
  type AudioFile,
  type StoredAudioFile,
  type AudioFileIdentifier,
  type AudioMimeType,
  type StorageKey,
  createAudioFileIdentifier,
} from "../../../domain/audio-file";
import { type RecordingAttemptIdentifier } from "../../../domain/recording-attempt";
import { notFound } from "../../../domain/shared";
import { okAsync, errAsync } from "neverthrow";
import { tryPersistence, tryPersistenceResult } from "./try-persistence";

type AudioFileRow = typeof audioFiles.$inferSelect;

const rowToStoredAudioFile = (row: AudioFileRow): StoredAudioFile => {
  const identifier = createAudioFileIdentifier(row.identifier);
  if (!identifier) throw new Error(`Invalid AudioFileIdentifier: ${row.identifier}`);

  return {
    type: "stored",
    identifier,
    recordingAttempt: row.recordingAttempt as RecordingAttemptIdentifier,
    storageKey: row.storageKey as StorageKey,
    mimeType: row.mimeType as AudioMimeType,
    sizeBytes: row.sizeBytes,
    durationMilliseconds: row.durationMilliseconds,
    sha256: row.sha256,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
};

const audioFileToRow = (audioFile: AudioFile): AudioFileRow => {
  const now = new Date().toISOString();

  if (audioFile.type === "stored") {
    return {
      identifier: String(audioFile.identifier),
      recordingAttempt: String(audioFile.recordingAttempt),
      storageKey: String(audioFile.storageKey),
      mimeType: String(audioFile.mimeType),
      sizeBytes: audioFile.sizeBytes,
      durationMilliseconds: audioFile.durationMilliseconds,
      sha256: audioFile.sha256,
      status: "stored",
      sampleRate: null,
      channelCount: null,
      physicalDeletedAt: null,
      deleteFailureReason: null,
      createdAt: audioFile.createdAt.toISOString(),
      updatedAt: audioFile.updatedAt.toISOString(),
      deletedAt: null,
    };
  }

  if (audioFile.type === "deletionPending") {
    return {
      identifier: String(audioFile.identifier),
      recordingAttempt: String(audioFile.recordingAttempt),
      storageKey: String(audioFile.storageKey),
      mimeType: "audio/webm",
      sizeBytes: 1,
      durationMilliseconds: 1,
      sha256: "0".repeat(64),
      status: "deletion_pending",
      sampleRate: null,
      channelCount: null,
      physicalDeletedAt: null,
      deleteFailureReason: null,
      createdAt: audioFile.requestedAt.toISOString(),
      updatedAt: audioFile.requestedAt.toISOString(),
      deletedAt: null,
    };
  }

  if (audioFile.type === "deleted") {
    return {
      identifier: String(audioFile.identifier),
      recordingAttempt: String(audioFile.recordingAttempt),
      storageKey: "",
      mimeType: "audio/webm",
      sizeBytes: 1,
      durationMilliseconds: 1,
      sha256: "0".repeat(64),
      status: "physically_deleted",
      sampleRate: null,
      channelCount: null,
      physicalDeletedAt: audioFile.deletedAt.toISOString(),
      deleteFailureReason: null,
      createdAt: audioFile.deletedAt.toISOString(),
      updatedAt: now,
      deletedAt: audioFile.deletedAt.toISOString(),
    };
  }

  // deleteFailed
  return {
    identifier: String(audioFile.identifier),
    recordingAttempt: String(audioFile.recordingAttempt),
    storageKey: String(audioFile.storageKey),
    mimeType: "audio/webm",
    sizeBytes: 1,
    durationMilliseconds: 1,
    sha256: "0".repeat(64),
    status: "delete_failed",
    sampleRate: null,
    channelCount: null,
    physicalDeletedAt: null,
    deleteFailureReason: audioFile.failureReason,
    createdAt: audioFile.failedAt.toISOString(),
    updatedAt: now,
    deletedAt: null,
  };
};

export const createDrizzleAudioFileRepository = (db: DrizzleDatabase): AudioFileRepository => ({
  find: (identifier: AudioFileIdentifier) => {
    return tryPersistenceResult(() => {
      const row = db
        .select()
        .from(audioFiles)
        .where(eq(audioFiles.identifier, String(identifier)))
        .get();

      if (!row || row.status !== "stored") {
        return errAsync(notFound("StoredAudioFile", String(identifier)));
      }

      return okAsync(rowToStoredAudioFile(row));
    });
  },

  findByRecordingAttempt: (recordingAttempt: RecordingAttemptIdentifier) => {
    return tryPersistenceResult(() => {
      const row = db
        .select()
        .from(audioFiles)
        .where(eq(audioFiles.recordingAttempt, String(recordingAttempt)))
        .get();

      if (!row || row.status !== "stored") {
        return errAsync(notFound("StoredAudioFile", String(recordingAttempt)));
      }

      return okAsync(rowToStoredAudioFile(row));
    });
  },

  persist: (audioFile: AudioFile) => {
    return tryPersistence(() => {
      const row = audioFileToRow(audioFile);
      db.insert(audioFiles)
        .values(row)
        .onConflictDoUpdate({
          target: audioFiles.identifier,
          set: {
            status: row.status,
            physicalDeletedAt: row.physicalDeletedAt,
            deleteFailureReason: row.deleteFailureReason,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
          },
        })
        .run();
      return undefined;
    });
  },
});
