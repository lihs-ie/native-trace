import { describe, it, expect, vi } from "vitest";
import { okAsync, errAsync } from "neverthrow";
import { createSubmitPracticeAttempt, type SubmitPracticeAttemptDependencies } from "./index";
import { notFound } from "../../domain/shared";
import {
  type ActiveSection,
  type SectionIdentifier,
  type SectionVersion,
  type SectionBodyText,
} from "../../domain/section";
import { type SectionSeriesIdentifier } from "../../domain/section-series";
import { type StorageKey, type AudioMimeType } from "../../domain/audio-file";
import { type Clock } from "../port/clock";
import { type EntropyProvider } from "../port/entropy-provider";
import { type Logger } from "../port/logger";
import { type TransactionManager } from "../port/transaction-manager";

const VALID_SECTION_BODY = "Hello world, this is a valid English text for practice testing.";

const makeActiveSection = (): ActiveSection => ({
  type: "active",
  identifier: "01SECTION" as SectionIdentifier,
  sectionSeries: "01SERIES" as SectionSeriesIdentifier,
  version: 1 as SectionVersion,
  bodyText: VALID_SECTION_BODY as SectionBodyText,
  createdAt: new Date("2026-01-01T00:00:00Z"),
});

const makeAudioBuffer = () => Buffer.from("fake-audio-data");

let ulidCounter = 0;
const makeEntropyProvider = (): EntropyProvider => ({
  generateUlid: () => `01ULID${String(ulidCounter++).padStart(6, "0")}`,
  generateUuidV4: () => "00000000-0000-4000-8000-000000000000",
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
  overrides?: Partial<SubmitPracticeAttemptDependencies>,
): SubmitPracticeAttemptDependencies => ({
  sectionRepository: {
    find: () => okAsync(makeActiveSection()),
    findLatestInSeries: () => errAsync(notFound("section", "x")),
    findLatestVersionNumber: () => errAsync(notFound("section", "x")),
    search: () => okAsync({ items: [], total: 0 }),
    persist: () => okAsync(undefined),
  },
  recordingAttemptRepository: {
    find: () => errAsync(notFound("recordingAttempt", "x")),
    findSaving: () => errAsync(notFound("recordingAttempt", "x")),
    search: () => okAsync({ items: [], total: 0 }),
    persist: () => okAsync(undefined),
  },
  audioFileRepository: {
    find: () => errAsync(notFound("audioFile", "x")),
    findByRecordingAttempt: () => errAsync(notFound("audioFile", "x")),
    persist: () => okAsync(undefined),
  },
  analysisRunRepository: {
    find: () => errAsync(notFound("analysisRun", "x")),
    search: () => okAsync({ items: [], total: 0 }),
    persist: () => okAsync(undefined),
    updateStatus: () => okAsync(undefined),
  },
  analysisJobRepository: {
    find: () => errAsync(notFound("analysisJob", "x")),
    search: () => okAsync({ items: [] }),
    persist: () => okAsync(undefined),
    acquireLease: () => okAsync(null),
  },
  audioStorage: {
    save: () =>
      okAsync({
        storageKey: "key/audio.wav" as StorageKey,
        mimeType: "audio/wav" as AudioMimeType,
        sizeBytes: 16,
        durationMilliseconds: 5000,
        sha256: "abc123",
      }),
    stream: () => errAsync({ type: "audioStorageFailed" as const, reason: "not used" }),
    delete: () => okAsync(undefined),
  },
  transactionManager: makeTransactionManager(),
  entropyProvider: makeEntropyProvider(),
  clock: makeClock(),
  logger: makeLogger(),
  ...overrides,
});

const makeBrowserRecordingInput = () => ({
  section: "01SECTION",
  audioSource: {
    type: "browser_recording" as const,
    data: makeAudioBuffer(),
    mimeType: "audio/wav" as const,
    durationMilliseconds: 5000,
    startedAt: new Date("2026-01-01T00:00:00Z"),
    endedAt: new Date("2026-01-01T00:00:05Z"),
    browserEnvironment: {
      browserName: "Chrome",
      deviceType: "pc" as const,
      recordingApiType: "MediaRecorder",
      userAgent: "Mozilla/5.0",
    },
  },
  analysisMode: "cloud_only" as const,
});

describe("submitPracticeAttempt", () => {
  it("creates recording attempt, audio file, analysis run, and job on success", async () => {
    ulidCounter = 0;
    const deps = makeDependencies();
    const execute = createSubmitPracticeAttempt(deps);

    const result = await execute(makeBrowserRecordingInput());

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.recordingAttempt.state).toBe("ready");
    expect(output.analysisRun.mode).toBe("cloud_only");
    expect(output.analysisJobs).toHaveLength(1);
    expect(output.analysisJobs[0].engine).toBe("cloud");
    expect(output.analysisJobs[0].state).toBe("queued");
  });

  it("creates two jobs for comparison mode", async () => {
    ulidCounter = 0;
    const deps = makeDependencies();
    const execute = createSubmitPracticeAttempt(deps);

    const result = await execute({
      ...makeBrowserRecordingInput(),
      analysisMode: "comparison",
    });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.analysisJobs).toHaveLength(2);
    const engines = output.analysisJobs.map((j) => j.engine);
    expect(engines).toContain("cloud");
    expect(engines).toContain("oss_worker");
  });

  it("returns validation error for empty section id", async () => {
    const deps = makeDependencies();
    const execute = createSubmitPracticeAttempt(deps);

    const result = await execute({ ...makeBrowserRecordingInput(), section: "" });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("validationFailed");
  });

  it("does not call storage when validation fails", async () => {
    ulidCounter = 0;
    const saveSpy = vi.fn(() =>
      okAsync({
        storageKey: "key/audio.wav" as StorageKey,
        mimeType: "audio/wav" as AudioMimeType,
        sizeBytes: 16,
        durationMilliseconds: 5000,
        sha256: "abc123",
      }),
    );
    const deps = makeDependencies({
      audioStorage: {
        save: saveSpy,
        stream: () => errAsync({ type: "audioStorageFailed" as const, reason: "not used" }),
        delete: () => okAsync(undefined),
      },
    });
    const execute = createSubmitPracticeAttempt(deps);

    await execute({ ...makeBrowserRecordingInput(), section: "" });

    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("deletes saved audio when DB transaction fails (compensation)", async () => {
    ulidCounter = 0;
    const deleteSpy = vi.fn(() => okAsync(undefined));
    const deps = makeDependencies({
      audioStorage: {
        save: (_id, _data, _mime) =>
          okAsync({
            storageKey: "key/audio.wav" as StorageKey,
            mimeType: "audio/wav" as AudioMimeType,
            sizeBytes: 16,
            durationMilliseconds: 5000,
            sha256: "abc123",
          }),
        stream: () => errAsync({ type: "audioStorageFailed" as const, reason: "not used" }),
        delete: deleteSpy,
      },
      transactionManager: {
        execute: () => errAsync({ type: "transactionFailed" as const, reason: "DB down" }),
      },
    });
    const execute = createSubmitPracticeAttempt(deps);

    const result = await execute(makeBrowserRecordingInput());

    expect(result.isErr()).toBe(true);
    expect(deleteSpy).toHaveBeenCalledOnce();
  });

  it("rejects audio exceeding 10 minutes duration", async () => {
    const deps = makeDependencies();
    const execute = createSubmitPracticeAttempt(deps);

    const result = await execute({
      ...makeBrowserRecordingInput(),
      audioSource: {
        ...makeBrowserRecordingInput().audioSource,
        durationMilliseconds: 11 * 60 * 1000,
      },
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("validationFailed");
  });

  it("rejects audio exceeding 100 MB size", async () => {
    const deps = makeDependencies();
    const execute = createSubmitPracticeAttempt(deps);

    const bigBuffer = Buffer.alloc(101 * 1024 * 1024);
    const result = await execute({
      ...makeBrowserRecordingInput(),
      audioSource: {
        ...makeBrowserRecordingInput().audioSource,
        data: bigBuffer,
      },
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("validationFailed");
  });

  it("audio storage is called outside transaction", async () => {
    ulidCounter = 0;
    const callOrder: string[] = [];
    const deps = makeDependencies({
      audioStorage: {
        save: () => {
          callOrder.push("storage.save");
          return okAsync({
            storageKey: "key/audio.wav" as StorageKey,
            mimeType: "audio/wav" as AudioMimeType,
            sizeBytes: 16,
            durationMilliseconds: 5000,
            sha256: "abc123",
          });
        },
        stream: () => errAsync({ type: "audioStorageFailed" as const, reason: "not used" }),
        delete: () => okAsync(undefined),
      },
      transactionManager: {
        execute: (work) => {
          callOrder.push("tx.begin");
          return work().map((v) => {
            callOrder.push("tx.commit");
            return v;
          });
        },
      },
    });
    const execute = createSubmitPracticeAttempt(deps);

    await execute(makeBrowserRecordingInput());

    expect(callOrder[0]).toBe("storage.save");
    expect(callOrder[1]).toBe("tx.begin");
    expect(callOrder[2]).toBe("tx.commit");
  });

  it("creates uploaded_file recording attempt correctly", async () => {
    ulidCounter = 0;
    const deps = makeDependencies();
    const execute = createSubmitPracticeAttempt(deps);

    const result = await execute({
      section: "01SECTION",
      audioSource: {
        type: "uploaded_file" as const,
        data: makeAudioBuffer(),
        mimeType: "audio/mp4" as const,
        durationMilliseconds: 3000,
        originalFileName: "recording.mp4",
      },
      analysisMode: "oss_worker_only" as const,
    });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.analysisJobs[0].engine).toBe("oss_worker");
  });
});
