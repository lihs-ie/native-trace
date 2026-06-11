import { describe, it, expect, vi } from "vitest";
import { okAsync, errAsync } from "neverthrow";
import { createDiscardRecordingAttempt, type DiscardRecordingAttemptDependencies } from "./index";
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
import { type Clock } from "../port/clock";
import { type Logger } from "../port/logger";
import { type TransactionManager } from "../port/transaction-manager";

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
  sizeBytes: 1024,
  durationMilliseconds: 5000,
  sha256: "abc",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
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
  overrides?: Partial<DiscardRecordingAttemptDependencies>,
): DiscardRecordingAttemptDependencies => ({
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
  audioStorage: {
    save: () => errAsync({ type: "audioStorageFailed" as const, reason: "not used" }),
    stream: () => errAsync({ type: "audioStorageFailed" as const, reason: "not used" }),
    delete: () => okAsync(undefined),
  },
  analysisRunRepository: {
    find: () => errAsync(notFound("analysisRun", "x")),
    search: () => okAsync({ items: [], total: 0 }),
    persist: () => okAsync(undefined),
    updateStatus: () => okAsync(undefined),
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

describe("discardRecordingAttempt", () => {
  it("logically deletes attempt and physically deletes audio on success", async () => {
    const deleteSpy = vi.fn(() => okAsync(undefined));
    const persistSpy = vi.fn(() => okAsync(undefined));
    const deps = makeDependencies({
      audioStorage: {
        save: () => errAsync({ type: "audioStorageFailed" as const, reason: "not used" }),
        stream: () => errAsync({ type: "audioStorageFailed" as const, reason: "not used" }),
        delete: deleteSpy,
      },
      audioFileRepository: {
        find: () => okAsync(makeStoredAudioFile()),
        findByRecordingAttempt: () => okAsync(makeStoredAudioFile()),
        persist: persistSpy,
      },
    });
    const execute = createDiscardRecordingAttempt(deps);

    const result = await execute({ recordingAttempt: "01ATTEMPT" });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.recordingAttempt.state).toBe("deleted");
    expect(output.audioPhysicallyDeleted).toBe(true);
    expect(deleteSpy).toHaveBeenCalledOnce();
  });

  it("DB commit happens before physical delete", async () => {
    const callOrder: string[] = [];
    const deps = makeDependencies({
      transactionManager: {
        execute: (work) => {
          callOrder.push("tx.begin");
          return work().map((v) => {
            callOrder.push("tx.commit");
            return v;
          });
        },
      },
      audioStorage: {
        save: () => errAsync({ type: "audioStorageFailed" as const, reason: "not used" }),
        stream: () => errAsync({ type: "audioStorageFailed" as const, reason: "not used" }),
        delete: () => {
          callOrder.push("storage.delete");
          return okAsync(undefined);
        },
      },
    });
    const execute = createDiscardRecordingAttempt(deps);

    await execute({ recordingAttempt: "01ATTEMPT" });

    expect(callOrder[0]).toBe("tx.begin");
    expect(callOrder[1]).toBe("tx.commit");
    expect(callOrder[2]).toBe("storage.delete");
  });

  it("marks audio file as delete_failed when physical delete fails", async () => {
    const persistSpy = vi.fn((_audioFile: { type: string }) => okAsync(undefined));
    const deps = makeDependencies({
      audioStorage: {
        save: () => errAsync({ type: "audioStorageFailed" as const, reason: "not used" }),
        stream: () => errAsync({ type: "audioStorageFailed" as const, reason: "not used" }),
        delete: () => errAsync({ type: "audioStorageFailed" as const, reason: "disk error" }),
      },
      audioFileRepository: {
        find: () => okAsync(makeStoredAudioFile()),
        findByRecordingAttempt: () => okAsync(makeStoredAudioFile()),
        persist: persistSpy,
      },
    });
    const execute = createDiscardRecordingAttempt(deps);

    const result = await execute({ recordingAttempt: "01ATTEMPT" });

    expect(result.isErr()).toBe(true);
    // AudioFile が deleteFailed で persist された
    const lastCall = persistSpy.mock.calls[persistSpy.mock.calls.length - 1];
    expect(lastCall[0].type).toBe("deleteFailed");
  });

  it("returns validation error for empty recordingAttempt id", async () => {
    const deps = makeDependencies();
    const execute = createDiscardRecordingAttempt(deps);

    const result = await execute({ recordingAttempt: "" });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("validationFailed");
  });

  it("returns notFound error for non-ready recording attempt", async () => {
    const deps = makeDependencies({
      recordingAttemptRepository: {
        find: () => errAsync(notFound("recordingAttempt", "01ATTEMPT")),
        findSaving: () => errAsync(notFound("recordingAttempt", "x")),
        search: () => okAsync({ items: [], total: 0 }),
        persist: () => okAsync(undefined),
      },
    });
    const execute = createDiscardRecordingAttempt(deps);

    const result = await execute({ recordingAttempt: "01ATTEMPT" });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("notFound");
  });
});
