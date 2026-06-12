import { describe, it, expect } from "vitest";
import { okAsync, errAsync } from "neverthrow";
import { createViewPracticeWorkspace } from "./index";
import { type ViewPracticeWorkspaceDependencies } from "./index";
import { notFound } from "../../domain/shared";
import {
  type ActiveSection,
  type SectionIdentifier,
  type SectionVersion,
  type SectionBodyText,
} from "../../domain/section";
import { type SectionSeriesIdentifier } from "../../domain/section-series";
import {
  type ReadyRecordingAttempt,
  type RecordingAttemptIdentifier,
  type RecordingDuration,
} from "../../domain/recording-attempt";
import { type AnalysisRun, type AnalysisRunIdentifier } from "../../domain/analysis-run";
import {
  type AudioFileIdentifier,
  type StorageKey,
  type AudioMimeType,
} from "../../domain/audio-file";

const makeActiveSection = (bodyText = "Hello world this is an English text."): ActiveSection => ({
  type: "active",
  identifier: "01SECTION" as SectionIdentifier,
  sectionSeries: "01SERIES" as SectionSeriesIdentifier,
  version: 1 as SectionVersion,
  bodyText: bodyText as SectionBodyText,
  createdAt: new Date("2026-01-01T00:00:00Z"),
});

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

const makeAnalysisRun = (): AnalysisRun => ({
  identifier: "01RUN" as AnalysisRunIdentifier,
  recordingAttempt: "01ATTEMPT" as RecordingAttemptIdentifier,
  mode: "cloud_only",
  createdAt: new Date("2026-01-01T00:00:00Z"),
});

const makeDependencies = (
  overrides?: Partial<ViewPracticeWorkspaceDependencies>,
): ViewPracticeWorkspaceDependencies => ({
  sectionRepository: {
    find: () => okAsync(makeActiveSection()),
    findLatestInSeries: () => errAsync(notFound("section", "x")),
    findLatestVersionNumber: () => errAsync(notFound("section", "x")),
    search: () => okAsync({ items: [], total: 0 }),
    persist: () => okAsync(undefined),
  },
  recordingAttemptRepository: {
    find: () => okAsync(makeReadyAttempt()),
    findSaving: () => errAsync(notFound("recordingAttempt", "x")),
    search: () => okAsync({ items: [makeReadyAttempt()], total: 1 }),
    persist: () => okAsync(undefined),
  },
  analysisRunRepository: {
    find: () => okAsync(makeAnalysisRun()),
    search: () => okAsync({ items: [makeAnalysisRun()], total: 1 }),
    persist: () => okAsync(undefined),
    updateStatus: () => okAsync(undefined),
  },
  analysisJobRepository: {
    find: () => errAsync(notFound("analysisJob", "x")),
    search: () => okAsync({ items: [] }),
    persist: () => okAsync(undefined),
    acquireLease: () => okAsync(null),
  },
  assessmentResultRepository: {
    find: () => errAsync(notFound("assessmentResult", "x")),
    search: () => okAsync({ items: [] }),
    persist: () => okAsync(undefined),
  },
  findingDismissalRepository: {
    record: () => okAsync(undefined),
    restore: () => okAsync(undefined),
    findActiveDismissedIdentifiers: () => okAsync(new Set<string>()),
    findActiveDismissedIdentifiersByResults: () => okAsync(new Map<string, ReadonlySet<string>>()),
  },
  audioFileRepository: {
    find: () =>
      okAsync({
        type: "stored" as const,
        identifier: "01AUDIOFILE" as AudioFileIdentifier,
        recordingAttempt: "01ATTEMPT" as RecordingAttemptIdentifier,
        storageKey: "key/audio.wav" as StorageKey,
        mimeType: "audio/wav" as AudioMimeType,
        sizeBytes: 1024,
        durationMilliseconds: 5000,
        sha256: "abc",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      }),
    findByRecordingAttempt: () =>
      okAsync({
        type: "stored" as const,
        identifier: "01AUDIOFILE" as AudioFileIdentifier,
        recordingAttempt: "01ATTEMPT" as RecordingAttemptIdentifier,
        storageKey: "key/audio.wav" as StorageKey,
        mimeType: "audio/wav" as AudioMimeType,
        sizeBytes: 1024,
        durationMilliseconds: 5000,
        sha256: "abc",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      }),
    persist: () => okAsync(undefined),
  },
  ...overrides,
});

describe("viewPracticeWorkspace", () => {
  it("returns section tokens derived from body text", async () => {
    const deps = makeDependencies();
    const execute = createViewPracticeWorkspace(deps);

    const result = await execute({ section: "01SECTION" });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.section.identifier).toBe("01SECTION");
    expect(output.sectionTokens.length).toBeGreaterThan(0);
    expect(output.sectionTokens[0].tokenIndex).toBe(0);
    expect(output.sectionTokens[0].text).toBe("Hello");
  });

  it("returns empty highlightRangesByEngine when no succeeded jobs", async () => {
    const deps = makeDependencies();
    const execute = createViewPracticeWorkspace(deps);

    const result = await execute({ section: "01SECTION" });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.highlightRangesByEngine).toHaveLength(0);
  });

  it("returns null latestAnalysisRun when no ready attempts", async () => {
    const deps = makeDependencies({
      recordingAttemptRepository: {
        find: () => errAsync(notFound("recordingAttempt", "x")),
        findSaving: () => errAsync(notFound("recordingAttempt", "x")),
        search: () => okAsync({ items: [], total: 0 }),
        persist: () => okAsync(undefined),
      },
    });
    const execute = createViewPracticeWorkspace(deps);

    const result = await execute({ section: "01SECTION" });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.latestAnalysisRun).toBeNull();
  });

  it("returns validation error for empty section id", async () => {
    const deps = makeDependencies();
    const execute = createViewPracticeWorkspace(deps);

    const result = await execute({ section: "" });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("validationFailed");
  });

  it("does not merge results across engines (comparison mode)", async () => {
    const mockResults = [
      {
        identifier: "01RESULT" as never,
        analysisJob: "01JOB" as never,
        scores: {
          overall: 80 as never,
          accuracy: 80 as never,
          nativeLikeness: 80 as never,
          pronunciation: 80 as never,
          connectedSpeech: 80 as never,
          prosody: 80 as never,
          intelligibility: null,
          cefrOverall: null,
          cefrSegmental: null,
          cefrProsodic: null,
        },
        summary: { overallCommentJa: "よい", overallCommentEn: null },
        findings: [],
        segments: [
          { textRange: { startOffset: 0, endOffset: 5 }, audioRange: null, word: "Hello" },
        ] as never,
        metadata: {
          engineName: "cloud",
          engineVersion: "1.0",
          modelName: null,
          promptVersion: null,
          schemaVersion: "1",
        },
        tokenizerVersion: "v1" as never,
        raw: { data: {} },
        engineSnapshot: {
          type: "cloud" as const,
          identifier: "engine-cloud-1",
          displayName: "Cloud Engine",
          modelName: null,
        },
        createdAt: new Date("2026-01-01T00:00:00Z"),
        perPhonemeGop: null,
        focusSounds: null,
        prosody: null,
        engineSummaryMessageJa: null,
      },
      {
        identifier: "02RESULT" as never,
        analysisJob: "02JOB" as never,
        scores: {
          overall: 75 as never,
          accuracy: 75 as never,
          nativeLikeness: 75 as never,
          pronunciation: 75 as never,
          connectedSpeech: 75 as never,
          prosody: 75 as never,
          intelligibility: null,
          cefrOverall: null,
          cefrSegmental: null,
          cefrProsodic: null,
        },
        summary: { overallCommentJa: "良好", overallCommentEn: null },
        findings: [],
        segments: [
          { textRange: { startOffset: 0, endOffset: 5 }, audioRange: null, word: "Hello" },
        ] as never,
        metadata: {
          engineName: "oss",
          engineVersion: "1.0",
          modelName: null,
          promptVersion: null,
          schemaVersion: "1",
        },
        tokenizerVersion: "v1" as never,
        raw: { data: {} },
        engineSnapshot: {
          type: "oss_worker" as const,
          identifier: "engine-oss-1",
          displayName: "OSS Worker",
          modelName: null,
        },
        createdAt: new Date("2026-01-01T00:00:00Z"),
        perPhonemeGop: null,
        focusSounds: null,
        prosody: null,
        engineSummaryMessageJa: null,
      },
    ];

    const deps = makeDependencies({
      analysisJobRepository: {
        find: () => errAsync(notFound("analysisJob", "x")),
        search: () =>
          okAsync({
            items: [
              {
                type: "succeeded" as const,
                identifier: "01JOB" as never,
                analysisRun: "01RUN" as never,
                engine: "cloud" as const,
                engineConfigJson: "{}",
                completedAt: new Date("2026-01-01T00:00:00Z"),
                queuedAt: new Date("2026-01-01T00:00:00Z"),
                createdAt: new Date("2026-01-01T00:00:00Z"),
              },
              {
                type: "succeeded" as const,
                identifier: "02JOB" as never,
                analysisRun: "01RUN" as never,
                engine: "oss_worker" as const,
                engineConfigJson: "{}",
                completedAt: new Date("2026-01-01T00:00:00Z"),
                queuedAt: new Date("2026-01-01T00:00:00Z"),
                createdAt: new Date("2026-01-01T00:00:00Z"),
              },
            ],
          }),
        persist: () => okAsync(undefined),
        acquireLease: () => okAsync(null),
      },
      assessmentResultRepository: {
        find: () => errAsync(notFound("assessmentResult", "x")),
        search: () => okAsync({ items: mockResults }),
        persist: () => okAsync(undefined),
      },
    });
    const execute = createViewPracticeWorkspace(deps);

    const result = await execute({ section: "01SECTION" });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    // 比較モードでもエンジン別に別々の EngineHighlightRangesOutput として返す（統合しない）
    expect(output.highlightRangesByEngine).toHaveLength(2);
    const engineIds = output.highlightRangesByEngine.map((h) => h.analysisEngine);
    expect(engineIds).toContain("engine-cloud-1");
    expect(engineIds).toContain("engine-oss-1");
  });
});
