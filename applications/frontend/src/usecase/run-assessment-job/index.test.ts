import { describe, it, expect, vi } from "vitest";
import { okAsync, errAsync, ok, err } from "neverthrow";
import { Readable } from "stream";
import { createRunAssessmentJob, type RunAssessmentJobDependencies } from "./index";
import { notFound } from "../../domain/shared";
import { type LeasedAnalysisJob, type AnalysisJobIdentifier } from "../../domain/analysis-job";
import { type AnalysisRun, type AnalysisRunIdentifier } from "../../domain/analysis-run";
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
import {
  type ActiveSection,
  type SectionIdentifier,
  type SectionVersion,
  type SectionBodyText,
} from "../../domain/section";
import { type SectionSeriesIdentifier } from "../../domain/section-series";
import {
  type AssessmentResultDraft,
  RawEngineResponseProvider,
  createInstant,
} from "../assessment-result-draft";
import { type EntropyProvider } from "../port/entropy-provider";
import { type Clock } from "../port/clock";
import { type Logger } from "../port/logger";
import { type TransactionManager } from "../port/transaction-manager";
import { TOKENIZER_VERSION } from "../shared/tokenizer";
import { createRuleBasedImprovementMessageGenerator } from "../../acl/improvement-message/rule-based/create-rule-based-improvement-message-generator";

const makeLeasedJob = (): LeasedAnalysisJob => ({
  type: "leased",
  identifier: "01JOB" as AnalysisJobIdentifier,
  analysisRun: "01RUN" as AnalysisRunIdentifier,
  engine: "cloud",
  engineConfigJson: "{}",
  priority: 0,
  attemptCount: 1,
  maxAttempts: 3,
  leaseToken: "token-abc" as never,
  leasedUntil: new Date("2026-01-01T00:01:00Z"),
  leaseOwner: "runner-1",
  nextRunAt: new Date("2026-01-01T00:00:00Z"),
  queuedAt: new Date("2026-01-01T00:00:00Z"),
  createdAt: new Date("2026-01-01T00:00:00Z"),
});

const makeAnalysisRun = (): AnalysisRun => ({
  identifier: "01RUN" as AnalysisRunIdentifier,
  recordingAttempt: "01ATTEMPT" as RecordingAttemptIdentifier,
  mode: "cloud_only",
  status: "queued",
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

const makeActiveSection = (): ActiveSection => ({
  type: "active",
  identifier: "01SECTION" as SectionIdentifier,
  sectionSeries: "01SERIES" as SectionSeriesIdentifier,
  version: 1 as SectionVersion,
  bodyText: "Hello world this is English." as SectionBodyText,
  createdAt: new Date("2026-01-01T00:00:00Z"),
});

const makeDraft = (): AssessmentResultDraft => ({
  engine: {
    type: "cloud",
    identifier: "engine-cloud-1" as never,
    displayName: "Cloud Engine" as never,
    provider: "cloud",
    modelName: "",
    externalSendingRequired: true,
    enabled: true,
    configuration: {},
  },
  status: "normal",
  scores: {
    overall: 80,
    accuracy: 80,
    nativeLikeness: 80,
    pronunciation: 80,
    connectedSpeech: 80,
    prosody: 80,
    intelligibility: null,
    cefrOverall: null,
    cefrSegmental: null,
    cefrProsodic: null,
  },
  summary: {
    messageJa: "発音が良好です",
    messageEn: "Good pronunciation.",
  },
  findings: [],
  segments: [
    {
      textRange: { startChar: 0, endChar: 5 },
      audioRange: { startMs: 0, endMs: 1000 },
      transcript: "Hello",
      confidence: 0.9,
    },
  ],
  metadata: {
    assessmentSchemaVersion: "1" as never,
    scoringRubricVersion: "v1" as never,
    promptVersion: null,
    model: null,
    workerVersion: null,
    modelVersion: null,
    ruleSetVersion: null,
    engineSpecific: {},
  },
  tokenizerVersion: TOKENIZER_VERSION,
  rawResponse: {
    provider: RawEngineResponseProvider.OPENAI,
    capturedAt: createInstant(new Date("2026-01-01T00:00:00Z")),
    contentType: "application/json",
    body: { response: "raw data" },
    truncated: false,
    originalSizeBytes: 20,
    storedSizeBytes: 20,
  },
  perPhonemeGop: null,
  focusSounds: null,
  prosody: null,
  engineSummaryMessageJa: null,
});

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

const makeFakeStream = () => {
  const stream = new Readable({ read() {} });
  stream.push(Buffer.from("fake-audio"));
  stream.push(null);
  return stream;
};

const makeDependencies = (
  overrides?: Partial<RunAssessmentJobDependencies>,
): RunAssessmentJobDependencies => ({
  analysisJobRepository: {
    find: () => okAsync(makeLeasedJob()),
    search: () => okAsync({ items: [makeLeasedJob()] }),
    persist: () => okAsync(undefined),
    acquireLease: () => okAsync(makeLeasedJob()),
  },
  analysisRunRepository: {
    find: () => okAsync(makeAnalysisRun()),
    search: () => okAsync({ items: [], total: 0 }),
    persist: () => okAsync(undefined),
    updateStatus: () => okAsync(undefined),
  },
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
    stream: () =>
      okAsync({
        stream: makeFakeStream(),
        contentType: "audio/wav",
        contentLength: 10,
        totalBytes: 10,
        rangeStart: 0,
        rangeEnd: 9,
      }),
    delete: () => okAsync(undefined),
  },
  sectionRepository: {
    find: () => okAsync(makeActiveSection()),
    findLatestInSeries: () => errAsync(notFound("section", "x")),
    findLatestVersionNumber: () => errAsync(notFound("section", "x")),
    search: () => okAsync({ items: [], total: 0 }),
    persist: () => okAsync(undefined),
  },
  assessmentResultRepository: {
    find: () => errAsync(notFound("assessmentResult", "x")),
    search: () => okAsync({ items: [] }),
    persist: () => okAsync(undefined),
  },
  engineRegistry: {
    find: () => ok({ assess: () => okAsync(makeDraft()) }),
  },
  transactionManager: makeTransactionManager(),
  entropyProvider: makeEntropyProvider(),
  clock: makeClock(),
  logger: makeLogger(),
  improvementMessageGenerator: {
    generate: () => "テスト用改善メッセージ",
    generateFeedbackLayers: () => ({
      whatJa: "テスト用what",
      whyJa: "テスト用why",
      howJa: "テスト用how",
    }),
  },
  ...overrides,
});

describe("runAssessmentJob", () => {
  it("returns job: null when no lease acquired", async () => {
    const deps = makeDependencies({
      analysisJobRepository: {
        find: () => errAsync(notFound("analysisJob", "x")),
        search: () => okAsync({ items: [] }),
        persist: () => okAsync(undefined),
        acquireLease: () => okAsync(null),
      },
    });
    const execute = createRunAssessmentJob(deps);

    const result = await execute({ leaseOwner: "runner-1", leaseDurationSeconds: 60 });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().job).toBeNull();
  });

  it("succeeds and returns assessment result on happy path", async () => {
    ulidCounter = 0;
    const deps = makeDependencies();
    const execute = createRunAssessmentJob(deps);

    const result = await execute({ leaseOwner: "runner-1", leaseDurationSeconds: 60 });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.job?.state).toBe("succeeded");
    expect(output.result).not.toBeNull();
    expect(output.retryScheduled).toBe(false);
  });

  it("schedules retry on retryable engine failure when under max attempts", async () => {
    ulidCounter = 0;
    const deps = makeDependencies({
      engineRegistry: {
        find: () =>
          ok({
            assess: () =>
              errAsync({
                type: "assessmentEngineFailed" as const,
                engine: "cloud",
                reason: "timeout",
                failureKind: "retryable" as const,
              }),
          }),
      },
    });
    const execute = createRunAssessmentJob(deps);

    const result = await execute({ leaseOwner: "runner-1", leaseDurationSeconds: 60 });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.retryScheduled).toBe(true);
    expect(output.job?.state).toBe("queued");
  });

  it("fails permanently on nonRetryable engine failure", async () => {
    ulidCounter = 0;
    const deps = makeDependencies({
      engineRegistry: {
        find: () =>
          ok({
            assess: () =>
              errAsync({
                type: "assessmentEngineFailed" as const,
                engine: "cloud",
                reason: "unsupported format",
                failureKind: "nonRetryable" as const,
              }),
          }),
      },
    });
    const execute = createRunAssessmentJob(deps);

    const result = await execute({ leaseOwner: "runner-1", leaseDurationSeconds: 60 });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.retryScheduled).toBe(false);
    expect(output.job?.state).toBe("failed");
  });

  it("fails permanently when assessmentSchemaInvalid (nonRetryable)", async () => {
    ulidCounter = 0;
    const invalidDraft: AssessmentResultDraft = {
      ...makeDraft(),
      summary: { messageJa: "", messageEn: null }, // 日本語サマリが空 → schema invalid
    };
    const deps = makeDependencies({
      engineRegistry: {
        find: () => ok({ assess: () => okAsync(invalidDraft) }),
      },
    });
    const execute = createRunAssessmentJob(deps);

    const result = await execute({ leaseOwner: "runner-1", leaseDurationSeconds: 60 });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.retryScheduled).toBe(false);
    expect(output.job?.state).toBe("failed");
  });

  it("does not save result when job is canceled before save", async () => {
    ulidCounter = 0;
    const resultPersistSpy = vi.fn(() => okAsync(undefined));
    const deps = makeDependencies({
      analysisJobRepository: {
        // isJobCanceled は .find() を呼ぶ。
        // 1回目: lease 直後のキャンセル確認 → leased (not canceled)
        // 2回目: engine 前のキャンセル確認 → leased (not canceled)
        // 3回目: 保存直前のキャンセル確認 → canceled
        find: vi
          .fn()
          .mockReturnValueOnce(okAsync(makeLeasedJob()))
          .mockReturnValueOnce(okAsync(makeLeasedJob()))
          .mockReturnValueOnce(
            okAsync({
              ...makeLeasedJob(),
              type: "canceled" as const,
              canceledAt: new Date("2026-01-01T00:00:00Z"),
            }),
          ),
        search: () => okAsync({ items: [makeLeasedJob()] }),
        persist: vi.fn(() => okAsync(undefined)),
        acquireLease: () => okAsync(makeLeasedJob()),
      },
      assessmentResultRepository: {
        find: () => errAsync(notFound("assessmentResult", "x")),
        search: () => okAsync({ items: [] }),
        persist: resultPersistSpy,
      },
    });
    const execute = createRunAssessmentJob(deps);

    const result = await execute({ leaseOwner: "runner-1", leaseDurationSeconds: 60 });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.job?.state).toBe("canceled");
    expect(resultPersistSpy).not.toHaveBeenCalled();
  });

  it("returns validation error for empty leaseOwner", async () => {
    const deps = makeDependencies();
    const execute = createRunAssessmentJob(deps);

    const result = await execute({ leaseOwner: "", leaseDurationSeconds: 60 });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("validationFailed");
  });

  it("engine not found causes nonRetryable failure", async () => {
    ulidCounter = 0;
    const deps = makeDependencies({
      engineRegistry: {
        find: () => err({ type: "notFound" as const, resource: "engine", identifier: "cloud" }),
      },
    });
    const execute = createRunAssessmentJob(deps);

    const result = await execute({ leaseOwner: "runner-1", leaseDurationSeconds: 60 });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.job?.state).toBe("failed");
    expect(output.retryScheduled).toBe(false);
  });

  // Done When (c): OSS Worker fixture(phenomenon="omission",gop=-12.164,messageJa=null) を通して
  // domain finding の phenomenon="omission"/gop=-12.164/messageJa が非null(RuleBased生成) になること
  it("fills messageJa via RuleBased generator when finding.messageJa is null, preserves phenomenon and gop", async () => {
    ulidCounter = 0;

    const ossWorkerDraft: AssessmentResultDraft = {
      ...makeDraft(),
      engine: {
        type: "oss_worker" as const,
        identifier: "oss-worker-1" as never,
        displayName: "OSS Worker" as never,
        workerVersion: "1.0.0",
        modelName: "v1",
        rulesetVersion: "v1",
        enabled: true,
        configuration: {},
      },
      findings: [
        {
          phenomenon: "omission",
          gop: -12.164,
          category: "accuracy" as const,
          severity: "major" as const,
          textRange: { startChar: 0, endChar: 11 },
          audioRange: null,
          expected: { text: null, ipa: "h ə l oʊ w ɜː l d" },
          detected: { text: null, ipa: "f ʌ n ɔ w ɜː l d" },
          messageJa: null,
          messageEn: null,
          scoreImpact: -5,
          confidence: 0.9,
          detectedTopCandidate: null,
          nBest: null,
          matchesL1Pattern: false,
          functionalLoad: null,
          catalogId: null,
          wordPair: null,
          expectedPronunciation: null,
          insertedVowel: null,
          insertionPositionMs: null,
          feedbackLayers: null,
          dismissed: false,
          wordPositionLabel: null,
        },
      ],
    };

    const generatedMessage = "「h ə l oʊ w ɜː l d」の音が抜けています";
    const deps = makeDependencies({
      engineRegistry: {
        find: () => ok({ assess: () => okAsync(ossWorkerDraft) }),
      },
      improvementMessageGenerator: {
        generate: (input) => {
          if (input.phenomenon === "omission") {
            return generatedMessage;
          }
          return "フォールバックメッセージ";
        },
        generateFeedbackLayers: () => ({
          whatJa: "テスト用what",
          whyJa: "テスト用why",
          howJa: "テスト用how",
        }),
      },
    });
    const execute = createRunAssessmentJob(deps);

    const result = await execute({ leaseOwner: "runner-1", leaseDurationSeconds: 60 });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.job?.state).toBe("succeeded");
    expect(output.result).not.toBeNull();

    // events に AssessmentResultCreated が含まれ、その findings を検証する
    const resultCreatedEvent = output.events.find((e) => e.type === "assessmentResultCreated");
    expect(resultCreatedEvent).toBeDefined();
    if (resultCreatedEvent?.type === "assessmentResultCreated") {
      const domainFinding = resultCreatedEvent.assessmentResult.findings[0];
      expect(domainFinding).toBeDefined();
      expect(domainFinding?.phenomenon).toBe("omission");
      expect(domainFinding?.gop).toBeCloseTo(-12.164);
      expect(domainFinding?.messageJa).toBe(generatedMessage);
      expect(domainFinding?.messageJa.length).toBeGreaterThan(0);
    }
  });

  // Done When (c): messageJa が非null の場合はそのまま使われ、generator を呼ばないこと
  // low_quality パス: draft.status === "low_quality" のとき採点なし・nonRetryable 失敗になること
  it("fails nonRetryably with errorCode=low_quality_audio when draft.status is low_quality", async () => {
    ulidCounter = 0;

    const lowQualityDraft: AssessmentResultDraft = {
      ...makeDraft(),
      status: "low_quality",
    };
    const deps = makeDependencies({
      engineRegistry: {
        find: () => ok({ assess: () => okAsync(lowQualityDraft) }),
      },
    });
    const execute = createRunAssessmentJob(deps);

    const result = await execute({ leaseOwner: "runner-1", leaseDurationSeconds: 60 });

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.job?.state).toBe("failed");
    expect(output.retryScheduled).toBe(false);
    // AssessmentResult は保存されない
    expect(output.result).toBeNull();
  });

  // M-104R-c 受入: wordPositionLabel が実値で流れ resolvePositionLabel を経て
  // feedbackLayers.whatJa に語頭/語中/語末が反映されることを実 generator で assert する。
  it.each([
    { wordPositionLabel: "initial" as const, expectedPosition: "語頭" },
    { wordPositionLabel: "medial" as const, expectedPosition: "語中" },
    { wordPositionLabel: "final" as const, expectedPosition: "語末" },
  ])(
    "feedbackLayers.whatJa contains $expectedPosition when wordPositionLabel is $wordPositionLabel (real generator, substitution phenomenon)",
    async ({ wordPositionLabel, expectedPosition }) => {
      ulidCounter = 0;

      const draftWithPositionedFinding: AssessmentResultDraft = {
        ...makeDraft(),
        engine: {
          type: "oss_worker" as const,
          identifier: "oss-worker-1" as never,
          displayName: "OSS Worker" as never,
          workerVersion: "1.0.0",
          modelName: "v1",
          rulesetVersion: "v1",
          enabled: true,
          configuration: {},
        },
        findings: [
          {
            phenomenon: "substitution",
            gop: -8.5,
            category: "accuracy" as const,
            severity: "major" as const,
            textRange: { startChar: 0, endChar: 5 },
            audioRange: null,
            expected: { text: "hello", ipa: "h ɛ l oʊ" },
            detected: { text: "helo", ipa: "h ɛ l oː" },
            messageJa: null,
            messageEn: null,
            scoreImpact: -5,
            confidence: 0.9,
            detectedTopCandidate: null,
            nBest: null,
            matchesL1Pattern: false,
            functionalLoad: null,
            catalogId: null,
            wordPair: null,
            expectedPronunciation: null,
            insertedVowel: null,
            insertionPositionMs: null,
            feedbackLayers: null,
            dismissed: false,
            wordPositionLabel,
          },
        ],
      };

      const realGenerator = createRuleBasedImprovementMessageGenerator();

      const deps = makeDependencies({
        engineRegistry: {
          find: () => ok({ assess: () => okAsync(draftWithPositionedFinding) }),
        },
        improvementMessageGenerator: realGenerator,
      });
      const execute = createRunAssessmentJob(deps);

      const result = await execute({ leaseOwner: "runner-1", leaseDurationSeconds: 60 });

      expect(result.isOk()).toBe(true);
      const output = result._unsafeUnwrap();
      expect(output.job?.state).toBe("succeeded");

      const resultCreatedEvent = output.events.find((e) => e.type === "assessmentResultCreated");
      expect(resultCreatedEvent).toBeDefined();
      if (resultCreatedEvent?.type === "assessmentResultCreated") {
        const domainFinding = resultCreatedEvent.assessmentResult.findings[0];
        expect(domainFinding).toBeDefined();
        expect(domainFinding?.feedbackLayers?.whatJa).toContain(expectedPosition);
      }
    },
  );

  it("keeps existing messageJa when finding.messageJa is non-null, does not call generator", async () => {
    ulidCounter = 0;

    const existingMessage = "既存の改善メッセージ";
    let generatorCallCount = 0;

    const draftWithMessage: AssessmentResultDraft = {
      ...makeDraft(),
      findings: [
        {
          phenomenon: "substitution",
          gop: -8.0,
          category: "accuracy" as const,
          severity: "minor" as const,
          textRange: { startChar: 0, endChar: 5 },
          audioRange: null,
          expected: { text: "hello", ipa: null },
          detected: { text: "helo", ipa: null },
          messageJa: existingMessage,
          messageEn: null,
          scoreImpact: -2,
          confidence: 0.8,
          detectedTopCandidate: null,
          nBest: null,
          matchesL1Pattern: false,
          functionalLoad: null,
          catalogId: null,
          wordPair: null,
          expectedPronunciation: null,
          insertedVowel: null,
          insertionPositionMs: null,
          feedbackLayers: null,
          dismissed: false,
          wordPositionLabel: null,
        },
      ],
    };

    const deps = makeDependencies({
      engineRegistry: {
        find: () => ok({ assess: () => okAsync(draftWithMessage) }),
      },
      improvementMessageGenerator: {
        generate: () => {
          generatorCallCount++;
          return "generator-message";
        },
        generateFeedbackLayers: () => ({
          whatJa: "テスト用what",
          whyJa: "テスト用why",
          howJa: "テスト用how",
        }),
      },
    });
    const execute = createRunAssessmentJob(deps);

    const result = await execute({ leaseOwner: "runner-1", leaseDurationSeconds: 60 });

    expect(result.isOk()).toBe(true);
    expect(generatorCallCount).toBe(0);

    const resultCreatedEvent = result
      ._unsafeUnwrap()
      .events.find((e) => e.type === "assessmentResultCreated");
    if (resultCreatedEvent?.type === "assessmentResultCreated") {
      expect(resultCreatedEvent.assessmentResult.findings[0]?.messageJa).toBe(existingMessage);
    }
  });
});
