import { describe, it, expect } from "vitest";
import { okAsync, errAsync } from "neverthrow";
import { createOpenRecordingAudio, type OpenRecordingAudioDependencies } from "./index";
import { notFound } from "../../domain/shared";
import {
  type ReadyRecordingAttempt,
  type RecordingAttemptIdentifier,
  type RecordingDuration,
} from "../../domain/recording-attempt";
import {
  type StoredAudioFile,
  type AudioFileIdentifier,
  type StorageKey,
  type AudioMimeType,
} from "../../domain/audio-file";
import { type SectionIdentifier } from "../../domain/section";

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

const makeStoredAudioFile = (): StoredAudioFile => ({
  type: "stored",
  identifier: "01AUDIOFILE" as AudioFileIdentifier,
  recordingAttempt: "01ATTEMPT" as RecordingAttemptIdentifier,
  storageKey: "key/audio.wav" as StorageKey,
  mimeType: "audio/wav" as AudioMimeType,
  sizeBytes: 2048,
  durationMilliseconds: 5000,
  sha256: "abc",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
});

const makeDependencies = (
  overrides?: Partial<OpenRecordingAudioDependencies>,
): OpenRecordingAudioDependencies => ({
  recordingAttemptRepository: {
    find: () => okAsync(makeReadyAttempt()),
    findSaving: () => errAsync(notFound("recordingAttempt", "x")),
    search: () => okAsync({ items: [], total: 0 }),
    persist: () => okAsync(undefined),
  },
  audioFileRepository: {
    find: () => okAsync(makeStoredAudioFile()),
    findByRecordingAttempt: () => okAsync(makeStoredAudioFile()),
    persist: () => okAsync(undefined),
  },
  ...overrides,
});

describe("openRecordingAudio", () => {
  it("returns audio file metadata for a ready recording attempt", async () => {
    const deps = makeDependencies();
    const execute = createOpenRecordingAudio(deps);

    const result = await execute({ recordingAttempt: "01ATTEMPT" });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.audioFile.identifier).toBe("01AUDIOFILE");
    expect(output.storageKey).toBe("key/audio.wav");
    expect(output.mimeType).toBe("audio/wav");
    expect(output.sizeBytes).toBe(2048);
  });

  it("returns validation error for empty recordingAttempt id", async () => {
    const deps = makeDependencies();
    const execute = createOpenRecordingAudio(deps);

    const result = await execute({ recordingAttempt: "" });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("validationFailed");
  });

  it("returns notFound when recording attempt does not exist", async () => {
    const deps = makeDependencies({
      recordingAttemptRepository: {
        find: () => errAsync(notFound("recordingAttempt", "missing")),
        findSaving: () => errAsync(notFound("recordingAttempt", "x")),
        search: () => okAsync({ items: [], total: 0 }),
        persist: () => okAsync(undefined),
      },
    });
    const execute = createOpenRecordingAudio(deps);

    const result = await execute({ recordingAttempt: "missing" });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("notFound");
  });
});
