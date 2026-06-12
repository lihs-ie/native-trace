import { describe, it, expect } from "vitest";
import { okAsync, errAsync } from "neverthrow";
import { createReviewPracticeHistory, type ReviewPracticeHistoryDependencies } from "./index";
import { notFound } from "../../domain/shared";
import {
  type ActiveSectionSeries,
  type SectionSeriesIdentifier,
  type SectionTitle,
  type SectionDisplayOrder,
} from "../../domain/section-series";
import {
  type ActiveSection,
  type SectionIdentifier,
  type SectionVersion,
  type SectionBodyText,
} from "../../domain/section";
import { type MaterialIdentifier } from "../../domain/material";
import { type AnalysisRun, type AnalysisRunIdentifier } from "../../domain/analysis-run";
import {
  type AssessmentResult,
  type AssessmentResultIdentifier,
  type Score0To100,
  type Confidence0To1,
  type TokenizerVersion,
} from "../../domain/assessment-result";
import {
  type RecordingAttempt,
  type RecordingAttemptIdentifier,
} from "../../domain/recording-attempt";
import { type AnalysisJobIdentifier } from "../../domain/analysis-job";
import { type AudioFileIdentifier } from "../../domain/audio-file";
import { type RecordingDuration } from "../../domain/recording-attempt";

const makeReadyRecordingAttempt = (): RecordingAttempt => ({
  type: "ready",
  identifier: "01ATTEMPT" as RecordingAttemptIdentifier,
  section: "01SECTION" as SectionIdentifier,
  audioFile: "01AUDIO" as AudioFileIdentifier,
  origin: {
    type: "browser_recording",
    startedAt: new Date("2026-01-02T00:00:00Z"),
    endedAt: new Date("2026-01-02T00:01:00Z"),
    browserInfo: {
      browserName: "Chrome",
      deviceType: "pc",
      recordingApiType: "MediaRecorder",
      userAgent: "Mozilla/5.0",
    },
  },
  duration: 60000 as RecordingDuration,
  createdAt: new Date("2026-01-02T00:00:00Z"),
});

const makeAnalysisRun = (): AnalysisRun => ({
  identifier: "01ANALYSISRUN" as AnalysisRunIdentifier,
  recordingAttempt: "01ATTEMPT" as RecordingAttemptIdentifier,
  mode: "cloud_only",
  createdAt: new Date("2026-01-02T00:01:00Z"),
});

const makeAssessmentResult = (overallScore: number): AssessmentResult => ({
  identifier: "01RESULT" as AssessmentResultIdentifier,
  analysisJob: "01JOB" as AnalysisJobIdentifier,
  scores: {
    overall: overallScore as Score0To100,
    accuracy: 80 as Score0To100,
    nativeLikeness: 75 as Score0To100,
    pronunciation: 82 as Score0To100,
    connectedSpeech: 70 as Score0To100,
    prosody: 78 as Score0To100,
    intelligibility: null,
    cefrOverall: null,
    cefrSegmental: null,
    cefrProsodic: null,
  },
  summary: {
    overallCommentJa: "発音は概ね良好です",
    overallCommentEn: "Pronunciation is generally good.",
  },
  findings: [],
  segments: [
    {
      textRange: { startOffset: 0, endOffset: 5 },
      audioRange: null,
      transcript: "Hello",
      confidence: 0.95 as Confidence0To1,
    },
  ],
  metadata: {
    engineName: "openai-whisper",
    engineVersion: "1.0.0",
    modelName: "gpt-4o-audio",
    promptVersion: "v1",
    schemaVersion: "1",
  },
  tokenizerVersion: "v1" as TokenizerVersion,
  raw: { data: {} },
  engineSnapshot: {
    type: "cloud",
    identifier: "01ENGINE",
    displayName: "Cloud Engine",
    modelName: "gpt-4o-audio",
  },
  createdAt: new Date("2026-01-02T00:02:00Z"),
  perPhonemeGop: null,
  focusSounds: null,
  prosody: null,
  engineSummaryMessageJa: null,
});

const makeSectionSeries = (): ActiveSectionSeries => ({
  type: "active",
  identifier: "01SERIES" as SectionSeriesIdentifier,
  material: "01MATERIAL" as MaterialIdentifier,
  title: "Chapter 1" as SectionTitle,
  displayOrder: 0 as SectionDisplayOrder,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
});

const makeSection = (): ActiveSection => ({
  type: "active",
  identifier: "01SECTION" as SectionIdentifier,
  sectionSeries: "01SERIES" as SectionSeriesIdentifier,
  version: 1 as SectionVersion,
  bodyText: "Hello world this is English practice." as SectionBodyText,
  createdAt: new Date("2026-01-01T00:00:00Z"),
});

const makeDependencies = (
  overrides?: Partial<ReviewPracticeHistoryDependencies>,
): ReviewPracticeHistoryDependencies => ({
  sectionSeriesRepository: {
    find: () => okAsync(makeSectionSeries()),
    search: () => okAsync({ items: [], total: 0 }),
    persist: () => okAsync(undefined),
  },
  sectionRepository: {
    find: () => okAsync(makeSection()),
    findLatestInSeries: () => okAsync(makeSection()),
    findLatestVersionNumber: () => okAsync(1),
    search: () => okAsync({ items: [makeSection()], total: 1 }),
    persist: () => okAsync(undefined),
  },
  recordingAttemptRepository: {
    find: () => errAsync(notFound("recordingAttempt", "x")),
    findSaving: () => errAsync(notFound("recordingAttempt", "x")),
    search: () => okAsync({ items: [], total: 0 }),
    persist: () => okAsync(undefined),
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
  ...overrides,
});

describe("reviewPracticeHistory", () => {
  it("returns history grouped by sectionSeries", async () => {
    const deps = makeDependencies();
    const execute = createReviewPracticeHistory(deps);

    const result = await execute({ sectionSeries: "01SERIES" });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.sectionSeriesGroups).toHaveLength(1);
    expect(output.sectionSeriesGroups[0].sectionSeriesIdentifier).toBe("01SERIES");
    expect(output.sectionSeriesGroups[0].title).toBe("Chapter 1");
  });

  it("returns section versions with recording attempts", async () => {
    const deps = makeDependencies();
    const execute = createReviewPracticeHistory(deps);

    const result = await execute({ sectionSeries: "01SERIES" });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.sectionSeriesGroups[0].sectionVersions).toHaveLength(1);
    expect(output.sectionSeriesGroups[0].sectionVersions[0].version).toBe(1);
    expect(output.sectionSeriesGroups[0].sectionVersions[0].recordingAttempts).toHaveLength(0);
  });

  it("returns pagination metadata", async () => {
    const deps = makeDependencies();
    const execute = createReviewPracticeHistory(deps);

    const result = await execute({
      sectionSeries: "01SERIES",
      pagination: { offset: 0, limit: 10 },
    });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.page.offset).toBe(0);
    expect(output.page.limit).toBe(10);
  });

  it("returns validation error for empty sectionSeries id", async () => {
    const deps = makeDependencies();
    const execute = createReviewPracticeHistory(deps);

    const result = await execute({ sectionSeries: "" });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("validationFailed");
  });

  it("returns notFound when sectionSeries does not exist", async () => {
    const deps = makeDependencies({
      sectionSeriesRepository: {
        find: () => errAsync(notFound("sectionSeries", "missing")),
        search: () => okAsync({ items: [], total: 0 }),
        persist: () => okAsync(undefined),
      },
    });
    const execute = createReviewPracticeHistory(deps);

    const result = await execute({ sectionSeries: "missing" });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("notFound");
  });

  it("passthrough: assessmentResults[].overallScore is preserved in analysisRuns output", async () => {
    const expectedOverallScore = 85;
    const deps = makeDependencies({
      recordingAttemptRepository: {
        find: () => errAsync(notFound("recordingAttempt", "x")),
        findSaving: () => errAsync(notFound("recordingAttempt", "x")),
        search: () => okAsync({ items: [makeReadyRecordingAttempt()], total: 1 }),
        persist: () => okAsync(undefined),
      },
      analysisRunRepository: {
        find: () => errAsync(notFound("analysisRun", "x")),
        search: () => okAsync({ items: [makeAnalysisRun()], total: 1 }),
        persist: () => okAsync(undefined),
        updateStatus: () => okAsync(undefined),
      },
      assessmentResultRepository: {
        find: () => errAsync(notFound("assessmentResult", "x")),
        search: () => okAsync({ items: [makeAssessmentResult(expectedOverallScore)] }),
        persist: () => okAsync(undefined),
      },
    });
    const execute = createReviewPracticeHistory(deps);

    const result = await execute({ sectionSeries: "01SERIES" });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    const sectionVersion = output.sectionSeriesGroups[0].sectionVersions[0];
    expect(sectionVersion.recordingAttempts).toHaveLength(1);
    const analysisRun = sectionVersion.recordingAttempts[0].analysisRuns[0];
    expect(analysisRun).toBeDefined();
    expect(analysisRun.assessmentResults).toHaveLength(1);
    expect(analysisRun.assessmentResults[0].overallScore).toBe(expectedOverallScore);
    expect(analysisRun.assessmentResults[0].identifier).toBe("01RESULT");
  });
});
