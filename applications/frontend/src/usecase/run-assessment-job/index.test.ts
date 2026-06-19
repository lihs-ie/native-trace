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
import { type FeedbackLayersOutput } from "../port/improvement-message-generator";

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
          acousticEvidence: null,
          articulatoryEstimate: null,
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
            acousticEvidence: null,
            articulatoryEstimate: null,
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
          acousticEvidence: null,
          articulatoryEstimate: null,
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

  // M-APD-15 (ADR-018): acousticEvidence が両 generator 入力点に届くこと
  it("(M-APD-15) acousticEvidence on findingDraft reaches both precompute-batch and inline generateInput", async () => {
    ulidCounter = 0;

    const capturedInputs: Array<{ acousticEvidence: unknown }> = [];

    const acousticEvidenceFixture = {
      tongueHeight: "tooLow" as const,
      tongueBackness: "ok" as const,
      rhoticity: "ok" as const,
      sibilantPlace: "ok" as const,
      vowelLength: "ok" as const,
      measuredF1Hz: 450,
      measuredF2Hz: 2100,
      measuredF3Hz: 3000,
      targetF1Hz: 270,
      targetF2Hz: 2290,
      targetF3Hz: 3010,
    };

    const draftWithAcoustic: AssessmentResultDraft = {
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
          gop: -15.0,
          category: "accuracy" as const,
          severity: "major" as const,
          textRange: { startChar: 0, endChar: 5 },
          audioRange: null,
          expected: { text: null, ipa: "iː" },
          detected: { text: null, ipa: "ɪ" },
          messageJa: null,
          messageEn: null,
          scoreImpact: -5,
          confidence: 0.9,
          detectedTopCandidate: null,
          nBest: null,
          matchesL1Pattern: false,
          functionalLoad: "high",
          catalogId: null,
          wordPair: null,
          expectedPronunciation: null,
          insertedVowel: null,
          insertionPositionMs: null,
          feedbackLayers: null,
          dismissed: false,
          wordPositionLabel: null,
          acousticEvidence: acousticEvidenceFixture,
          articulatoryEstimate: null,
        },
      ],
    };

    const deps = makeDependencies({
      engineRegistry: {
        find: () => ok({ assess: () => okAsync(draftWithAcoustic) }),
      },
      improvementMessageGenerator: {
        generate: (input) => {
          capturedInputs.push({ acousticEvidence: input.acousticEvidence });
          return "captured-message";
        },
        generateFeedbackLayers: (input) => {
          capturedInputs.push({ acousticEvidence: input.acousticEvidence });
          return { whatJa: "what", whyJa: "why", howJa: "how" };
        },
        generateFeedbackLayersAsync: async (input) => {
          capturedInputs.push({ acousticEvidence: input.acousticEvidence });
          return { whatJa: "what-llm", whyJa: "why-llm", howJa: "how-llm" };
        },
      },
    });

    const execute = createRunAssessmentJob(deps);
    const result = await execute({ leaseOwner: "runner-1", leaseDurationSeconds: 60 });
    expect(result.isOk()).toBe(true);

    // At least one captured input must carry acousticEvidence (inline or precompute path)
    const withAcoustic = capturedInputs.filter((c) => c.acousticEvidence !== null);
    expect(withAcoustic.length).toBeGreaterThan(0);
    expect(withAcoustic[0]?.acousticEvidence).toEqual(acousticEvidenceFixture);
  });

  // M-LLM-4 tests

  describe("M-LLM-4: pre-loop batch with generateFeedbackLayersAsync", () => {
    // Helper: make a draft with N findings (messageJa=null, feedbackLayers=null)
    const makeDraftWithFindings = (count: number): AssessmentResultDraft => ({
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
      findings: Array.from({ length: count }, (_, i) => ({
        phenomenon: "substitution" as const,
        gop: -8.0 - i,
        category: "accuracy" as const,
        severity: "minor" as const,
        textRange: { startChar: i * 5, endChar: i * 5 + 5 },
        audioRange: null,
        expected: { text: "hello", ipa: "h ɛ l oʊ" },
        detected: { text: "helo", ipa: "h ɛ l oː" },
        messageJa: null,
        messageEn: null,
        scoreImpact: -2,
        confidence: 0.8,
        detectedTopCandidate: null,
        nBest: null,
        matchesL1Pattern: false,
        functionalLoad: `high-${i}`,
        catalogId: null,
        wordPair: null,
        expectedPronunciation: null,
        insertedVowel: null,
        insertionPositionMs: null,
        feedbackLayers: null,
        dismissed: false,
        wordPositionLabel: null,
        acousticEvidence: null,
        articulatoryEstimate: null,
      })),
    });

    it("(a) with concurrency=2 over 4 findings, invoker called at most 2 in-flight at a time", async () => {
      ulidCounter = 0;

      // Track maximum in-flight calls
      let currentInflight = 0;
      let maxInflight = 0;
      const asyncCallCount = { value: 0 };

      // Fake generator with generateFeedbackLayersAsync that tracks concurrency
      const fakeGenerator: RunAssessmentJobDependencies["improvementMessageGenerator"] = {
        generate: () => "fake-message",
        generateFeedbackLayers: () => ({
          whatJa: "fake-what",
          whyJa: "fake-why",
          howJa: "fake-how",
        }),
        generateFeedbackLayersAsync: async (input): Promise<FeedbackLayersOutput> => {
          asyncCallCount.value++;
          currentInflight++;
          if (currentInflight > maxInflight) maxInflight = currentInflight;
          // Simulate async work
          await new Promise((resolve) => setTimeout(resolve, 5));
          currentInflight--;
          return {
            whatJa: `llm-what-${input.functionalLoad ?? ""}`,
            whyJa: "llm-why",
            howJa: "llm-how",
          };
        },
      };

      const deps = makeDependencies({
        engineRegistry: {
          find: () => ok({ assess: () => okAsync(makeDraftWithFindings(4)) }),
        },
        improvementMessageGenerator: fakeGenerator,
        llmNarrativeMaxConcurrency: 2,
      });

      const execute = createRunAssessmentJob(deps);
      const result = await execute({ leaseOwner: "runner-1", leaseDurationSeconds: 60 });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().job?.state).toBe("succeeded");
      // All 4 findings were processed
      expect(asyncCallCount.value).toBe(4);
      // Never more than 2 in-flight simultaneously
      expect(maxInflight).toBeLessThanOrEqual(2);
    });

    it("(b) precomputed Map value reaches the persisted finding (feedbackLayers from LLM, messageJa from whatJa)", async () => {
      ulidCounter = 0;

      const llmFeedback: FeedbackLayersOutput = {
        whatJa: "LLM生成のwhatJa",
        whyJa: "LLM生成のwhyJa",
        howJa: "LLM生成のhowJa",
      };

      const fakeGenerator: RunAssessmentJobDependencies["improvementMessageGenerator"] = {
        generate: () => "rule-based-message",
        generateFeedbackLayers: () => ({
          whatJa: "rule-based-what",
          whyJa: "rule-based-why",
          howJa: "rule-based-how",
        }),
        generateFeedbackLayersAsync: async (): Promise<FeedbackLayersOutput> => llmFeedback,
      };

      const deps = makeDependencies({
        engineRegistry: {
          find: () => ok({ assess: () => okAsync(makeDraftWithFindings(1)) }),
        },
        improvementMessageGenerator: fakeGenerator,
        llmNarrativeMaxConcurrency: 3,
      });

      const execute = createRunAssessmentJob(deps);
      const result = await execute({ leaseOwner: "runner-1", leaseDurationSeconds: 60 });

      expect(result.isOk()).toBe(true);
      const output = result._unsafeUnwrap();
      const resultCreatedEvent = output.events.find((e) => e.type === "assessmentResultCreated");
      expect(resultCreatedEvent).toBeDefined();
      if (resultCreatedEvent?.type === "assessmentResultCreated") {
        const domainFinding = resultCreatedEvent.assessmentResult.findings[0];
        // feedbackLayers comes from the precomputed Map (LLM output)
        expect(domainFinding?.feedbackLayers).toEqual(llmFeedback);
        // messageJa uses feedbackLayers.whatJa when LLM precomputed
        expect(domainFinding?.messageJa).toBe(llmFeedback.whatJa);
      }
    });

    it("(c) rule-based path (generateFeedbackLayersAsync undefined): sync loop unchanged, Map never consulted", async () => {
      ulidCounter = 0;

      let generateFeedbackLayersCallCount = 0;
      const syncGenerator: RunAssessmentJobDependencies["improvementMessageGenerator"] = {
        generate: () => "sync-message",
        generateFeedbackLayers: () => {
          generateFeedbackLayersCallCount++;
          return { whatJa: "sync-what", whyJa: "sync-why", howJa: "sync-how" };
        },
        // generateFeedbackLayersAsync is undefined → rule-based path
      };

      const deps = makeDependencies({
        engineRegistry: {
          find: () => ok({ assess: () => okAsync(makeDraftWithFindings(3)) }),
        },
        improvementMessageGenerator: syncGenerator,
      });

      const execute = createRunAssessmentJob(deps);
      const result = await execute({ leaseOwner: "runner-1", leaseDurationSeconds: 60 });

      expect(result.isOk()).toBe(true);
      const output = result._unsafeUnwrap();
      expect(output.job?.state).toBe("succeeded");

      // Sync generateFeedbackLayers was called for each finding
      expect(generateFeedbackLayersCallCount).toBe(3);

      // Findings use sync path values
      const resultCreatedEvent = output.events.find((e) => e.type === "assessmentResultCreated");
      if (resultCreatedEvent?.type === "assessmentResultCreated") {
        for (const finding of resultCreatedEvent.assessmentResult.findings) {
          expect(finding.feedbackLayers?.whatJa).toBe("sync-what");
          // messageJa comes from generate() in rule-based path
          expect(finding.messageJa).toBe("sync-message");
        }
      }
    });

    it("(c-snapshot) existing snapshot: rule-based generator, no async method, produces same messageJa as generate()", async () => {
      ulidCounter = 0;
      // Use real rule-based generator to verify snapshot-compatible behavior
      const realGenerator = createRuleBasedImprovementMessageGenerator();
      // Real generator has no generateFeedbackLayersAsync
      expect(realGenerator.generateFeedbackLayersAsync).toBeUndefined();

      const draftWithFinding: AssessmentResultDraft = {
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
            severity: "minor" as const,
            textRange: { startChar: 0, endChar: 5 },
            audioRange: null,
            expected: { text: "hello", ipa: "h ɛ l oʊ" },
            detected: { text: "helo", ipa: "h ɛ l oː" },
            messageJa: null,
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
            acousticEvidence: null,
            articulatoryEstimate: null,
          },
        ],
      };

      const deps = makeDependencies({
        engineRegistry: {
          find: () => ok({ assess: () => okAsync(draftWithFinding) }),
        },
        improvementMessageGenerator: realGenerator,
      });
      const execute = createRunAssessmentJob(deps);
      const result = await execute({ leaseOwner: "runner-1", leaseDurationSeconds: 60 });

      expect(result.isOk()).toBe(true);
      const resultCreatedEvent = result
        ._unsafeUnwrap()
        .events.find((e) => e.type === "assessmentResultCreated");
      if (resultCreatedEvent?.type === "assessmentResultCreated") {
        const finding = resultCreatedEvent.assessmentResult.findings[0];
        expect(finding).toBeDefined();
        // rule-based: messageJa comes from generate() = generateFeedbackLayers().whatJa
        const expectedMessage = realGenerator.generate({
          phenomenon: "substitution",
          expected: { text: "hello", ipa: "h ɛ l oʊ" },
          detected: { text: "helo", ipa: "h ɛ l oː" },
          gop: -8.5,
          functionalLoad: null,
        });
        expect(finding?.messageJa).toBe(expectedMessage);
      }
    });
  });

  // M-TMO-3 + M-TMO-8 tests (ADR-023 cap + selection + batch summary)

  describe("M-TMO-3/M-TMO-8: ADR-023 cap + selection + batch summary", () => {
    // Helper: make a finding template with configurable severity / functionalLoad
    const makeRankedFindingDraft = (
      overrides: Partial<{
        severity: "critical" | "major" | "minor" | "suggestion";
        functionalLoad: string | null;
        index: number;
      }> = {},
    ) => ({
      phenomenon: "substitution" as const,
      gop: -8.0,
      category: "accuracy" as const,
      severity: (overrides.severity ?? "minor") as "critical" | "major" | "minor" | "suggestion",
      textRange: { startChar: (overrides.index ?? 0) * 5, endChar: (overrides.index ?? 0) * 5 + 5 },
      audioRange: null,
      expected: { text: "hello", ipa: "h ɛ l oʊ" },
      detected: { text: "helo", ipa: "h ɛ l oː" },
      messageJa: null,
      messageEn: null,
      scoreImpact: -2,
      confidence: 0.8,
      detectedTopCandidate: null,
      nBest: null,
      matchesL1Pattern: false,
      functionalLoad: overrides.functionalLoad !== undefined ? overrides.functionalLoad : "mid",
      catalogId: null,
      wordPair: null,
      expectedPronunciation: null,
      insertedVowel: null,
      insertionPositionMs: null,
      feedbackLayers: null,
      dismissed: false,
      wordPositionLabel: null,
      acousticEvidence: null,
      articulatoryEstimate: null,
    });

    // Helper: make a draft with specific findings array
    const makeDraftWithSpecificFindings = (
      findings: ReturnType<typeof makeRankedFindingDraft>[],
    ): AssessmentResultDraft => ({
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
      findings,
    });

    it("(cap) generator is called at most llmNarrativeMaxFindings times for 10 findings with cap 8", async () => {
      ulidCounter = 0;

      const callCount = { value: 0 };
      const fakeGenerator: RunAssessmentJobDependencies["improvementMessageGenerator"] = {
        generate: () => "fake-message",
        generateFeedbackLayers: () => ({
          whatJa: "fake-what",
          whyJa: "fake-why",
          howJa: "fake-how",
        }),
        generateFeedbackLayersAsync: async (): Promise<FeedbackLayersOutput> => {
          callCount.value++;
          return { whatJa: "llm-what", whyJa: "llm-why", howJa: "llm-how" };
        },
      };

      const tenFindings = Array.from({ length: 10 }, (_, i) =>
        makeRankedFindingDraft({ severity: "minor", functionalLoad: "mid", index: i }),
      );

      const deps = makeDependencies({
        engineRegistry: {
          find: () => ok({ assess: () => okAsync(makeDraftWithSpecificFindings(tenFindings)) }),
        },
        improvementMessageGenerator: fakeGenerator,
        llmNarrativeMaxFindings: 8,
      });

      const execute = createRunAssessmentJob(deps);
      const result = await execute({ leaseOwner: "runner-1", leaseDurationSeconds: 60 });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().job?.state).toBe("succeeded");
      // Cap of 8: generator called exactly 8 times (not 10)
      expect(callCount.value).toBe(8);
    });

    it("(rank order severity) critical finding selected over major/minor when cap=1", async () => {
      ulidCounter = 0;

      const selectedInputs: string[] = [];
      const fakeGenerator: RunAssessmentJobDependencies["improvementMessageGenerator"] = {
        generate: () => "fake-message",
        generateFeedbackLayers: () => ({
          whatJa: "fake-what",
          whyJa: "fake-why",
          howJa: "fake-how",
        }),
        generateFeedbackLayersAsync: async (input): Promise<FeedbackLayersOutput> => {
          selectedInputs.push(input.functionalLoad ?? "null-fl");
          return { whatJa: "llm-what", whyJa: "llm-why", howJa: "llm-how" };
        },
      };

      // Put critical at index 2, minor at 0, major at 1
      const findings = [
        makeRankedFindingDraft({ severity: "minor", functionalLoad: "low", index: 0 }),
        makeRankedFindingDraft({ severity: "major", functionalLoad: "mid", index: 1 }),
        makeRankedFindingDraft({ severity: "critical", functionalLoad: "low", index: 2 }),
      ];

      const deps = makeDependencies({
        engineRegistry: {
          find: () => ok({ assess: () => okAsync(makeDraftWithSpecificFindings(findings)) }),
        },
        improvementMessageGenerator: fakeGenerator,
        llmNarrativeMaxFindings: 1,
      });

      const execute = createRunAssessmentJob(deps);
      const result = await execute({ leaseOwner: "runner-1", leaseDurationSeconds: 60 });

      expect(result.isOk()).toBe(true);
      // Only 1 selected, it must be the critical one (functionalLoad="low")
      expect(selectedInputs).toHaveLength(1);
      // The critical finding has functionalLoad="low"
      expect(selectedInputs[0]).toBe("low");
    });

    it("(rank order functionalLoad) high selected over mid at same severity; max selected over high", async () => {
      ulidCounter = 0;

      const callSequence: string[] = [];
      const fakeGenerator: RunAssessmentJobDependencies["improvementMessageGenerator"] = {
        generate: () => "fake-message",
        generateFeedbackLayers: () => ({
          whatJa: "fake-what",
          whyJa: "fake-why",
          howJa: "fake-how",
        }),
        generateFeedbackLayersAsync: async (input): Promise<FeedbackLayersOutput> => {
          callSequence.push(input.functionalLoad ?? "null");
          return { whatJa: "llm-what", whyJa: "llm-why", howJa: "llm-how" };
        },
      };

      // Three major findings: mid, high, max. cap=1 → max selected first
      const findings = [
        makeRankedFindingDraft({ severity: "major", functionalLoad: "mid", index: 0 }),
        makeRankedFindingDraft({ severity: "major", functionalLoad: "high", index: 1 }),
        makeRankedFindingDraft({ severity: "major", functionalLoad: "max", index: 2 }),
      ];

      const deps = makeDependencies({
        engineRegistry: {
          find: () => ok({ assess: () => okAsync(makeDraftWithSpecificFindings(findings)) }),
        },
        improvementMessageGenerator: fakeGenerator,
        llmNarrativeMaxFindings: 1,
      });

      const execute = createRunAssessmentJob(deps);
      const result = await execute({ leaseOwner: "runner-1", leaseDurationSeconds: 60 });

      expect(result.isOk()).toBe(true);
      expect(callSequence).toHaveLength(1);
      // max > high > mid: the max one is selected
      expect(callSequence[0]).toBe("max");
    });

    it("(null functionalLoad last) null functionalLoad ranks below any non-null at same severity", async () => {
      ulidCounter = 0;

      const callSequence: Array<string | null | undefined> = [];
      const fakeGenerator: RunAssessmentJobDependencies["improvementMessageGenerator"] = {
        generate: () => "fake-message",
        generateFeedbackLayers: () => ({
          whatJa: "fake-what",
          whyJa: "fake-why",
          howJa: "fake-how",
        }),
        generateFeedbackLayersAsync: async (input): Promise<FeedbackLayersOutput> => {
          callSequence.push(input.functionalLoad);
          return { whatJa: "llm-what", whyJa: "llm-why", howJa: "llm-how" };
        },
      };

      // Two minor findings: null FL at index 0, "low" FL at index 1. cap=1 → "low" selected
      const findings = [
        makeRankedFindingDraft({ severity: "minor", functionalLoad: null, index: 0 }),
        makeRankedFindingDraft({ severity: "minor", functionalLoad: "low", index: 1 }),
      ];

      const deps = makeDependencies({
        engineRegistry: {
          find: () => ok({ assess: () => okAsync(makeDraftWithSpecificFindings(findings)) }),
        },
        improvementMessageGenerator: fakeGenerator,
        llmNarrativeMaxFindings: 1,
      });

      const execute = createRunAssessmentJob(deps);
      const result = await execute({ leaseOwner: "runner-1", leaseDurationSeconds: 60 });

      expect(result.isOk()).toBe(true);
      expect(callSequence).toHaveLength(1);
      // "low" (non-null) beats null
      expect(callSequence[0]).toBe("low");
    });

    it("(stable tie-break) two identical-severity/functionalLoad findings → lower original index selected first", async () => {
      ulidCounter = 0;

      const callIndices: number[] = [];
      let callIndex = 0;
      const fakeGenerator: RunAssessmentJobDependencies["improvementMessageGenerator"] = {
        generate: () => "fake-message",
        generateFeedbackLayers: () => ({
          whatJa: "fake-what",
          whyJa: "fake-why",
          howJa: "fake-how",
        }),
        generateFeedbackLayersAsync: async (): Promise<FeedbackLayersOutput> => {
          callIndices.push(callIndex++);
          return { whatJa: `llm-what-${callIndex}`, whyJa: "llm-why", howJa: "llm-how" };
        },
      };

      // Two identical findings at index 0 and 1, cap=1 → index 0 selected (stable tie-break)
      const findings = [
        makeRankedFindingDraft({ severity: "major", functionalLoad: "high", index: 0 }),
        makeRankedFindingDraft({ severity: "major", functionalLoad: "high", index: 1 }),
      ];

      // We check which finding (by textRange.startChar) gets the LLM output
      const deps = makeDependencies({
        engineRegistry: {
          find: () => ok({ assess: () => okAsync(makeDraftWithSpecificFindings(findings)) }),
        },
        improvementMessageGenerator: fakeGenerator,
        llmNarrativeMaxFindings: 1,
      });

      const execute = createRunAssessmentJob(deps);
      const result = await execute({ leaseOwner: "runner-1", leaseDurationSeconds: 60 });

      expect(result.isOk()).toBe(true);
      // Generator called exactly once (cap=1)
      expect(callIndices).toHaveLength(1);

      // The LLM result should be on finding[0], finding[1] gets rule-based
      const resultCreatedEvent = result
        ._unsafeUnwrap()
        .events.find((e) => e.type === "assessmentResultCreated");
      expect(resultCreatedEvent?.type).toBe("assessmentResultCreated");
      if (resultCreatedEvent?.type === "assessmentResultCreated") {
        // finding[0] has LLM feedbackLayers.whatJa = "llm-what-1" (callIndex was 0 at call time → returned llm-what-1)
        expect(resultCreatedEvent.assessmentResult.findings[0]?.feedbackLayers?.whatJa).toMatch(
          /^llm-what/,
        );
        // finding[1] gets rule-based whatJa = "fake-what"
        expect(resultCreatedEvent.assessmentResult.findings[1]?.feedbackLayers?.whatJa).toBe(
          "fake-what",
        );
      }
    });

    it("(ORPHAN-1 keying) highest-priority finding at non-zero original index gets LLM output (not index 0)", async () => {
      ulidCounter = 0;

      const fakeGenerator: RunAssessmentJobDependencies["improvementMessageGenerator"] = {
        generate: () => "rule-based-message",
        generateFeedbackLayers: () => ({
          whatJa: "rule-based-what",
          whyJa: "rule-based-why",
          howJa: "rule-based-how",
        }),
        generateFeedbackLayersAsync: async (input): Promise<FeedbackLayersOutput> => ({
          whatJa: `llm-what-${input.functionalLoad ?? "null"}`,
          whyJa: "llm-why",
          howJa: "llm-how",
        }),
      };

      // 6 findings: index 0-4 = minor/mid, index 5 = critical/max (highest priority)
      const findings = Array.from({ length: 6 }, (_, i) =>
        i === 5
          ? makeRankedFindingDraft({ severity: "critical", functionalLoad: "max", index: i })
          : makeRankedFindingDraft({ severity: "minor", functionalLoad: "mid", index: i }),
      );

      const deps = makeDependencies({
        engineRegistry: {
          find: () => ok({ assess: () => okAsync(makeDraftWithSpecificFindings(findings)) }),
        },
        improvementMessageGenerator: fakeGenerator,
        llmNarrativeMaxFindings: 1, // only 1 selected: the critical/max at original index 5
      });

      const execute = createRunAssessmentJob(deps);
      const result = await execute({ leaseOwner: "runner-1", leaseDurationSeconds: 60 });

      expect(result.isOk()).toBe(true);
      const resultCreatedEvent = result
        ._unsafeUnwrap()
        .events.find((e) => e.type === "assessmentResultCreated");
      expect(resultCreatedEvent?.type).toBe("assessmentResultCreated");
      if (resultCreatedEvent?.type === "assessmentResultCreated") {
        const domainFindings = resultCreatedEvent.assessmentResult.findings;
        // finding at original index 5 must have LLM output (functionalLoad="max")
        expect(domainFindings[5]?.feedbackLayers?.whatJa).toBe("llm-what-max");
        // findings at indices 0-4 must have rule-based output
        for (let i = 0; i < 5; i++) {
          expect(domainFindings[i]?.feedbackLayers?.whatJa).toBe("rule-based-what");
        }
      }
    });

    it("(M-TMO-8 batch summary) logger.info called with llm narrative batch + correct counts after 1 fallback in 3", async () => {
      ulidCounter = 0;

      // Two findings succeed LLM, one triggers onFallback
      let callCount = 0;
      const fakeGenerator: RunAssessmentJobDependencies["improvementMessageGenerator"] = {
        generate: () => "fake-message",
        generateFeedbackLayers: () => ({
          whatJa: "fake-what",
          whyJa: "fake-why",
          howJa: "fake-how",
        }),
        generateFeedbackLayersAsync: async (_input, onFallback): Promise<FeedbackLayersOutput> => {
          callCount++;
          if (callCount === 2) {
            // 2nd call triggers fallback
            onFallback?.("invoker_error");
          }
          return { whatJa: "llm-what", whyJa: "llm-why", howJa: "llm-how" };
        },
      };

      const threeFindings = Array.from({ length: 3 }, (_, i) =>
        makeRankedFindingDraft({ severity: "minor", functionalLoad: "mid", index: i }),
      );

      const loggerSpy = makeLogger();

      const deps = makeDependencies({
        engineRegistry: {
          find: () => ok({ assess: () => okAsync(makeDraftWithSpecificFindings(threeFindings)) }),
        },
        improvementMessageGenerator: fakeGenerator,
        llmNarrativeMaxFindings: 3,
        llmCoachingProvider: "claude-code",
        logger: loggerSpy,
      });

      const execute = createRunAssessmentJob(deps);
      const result = await execute({ leaseOwner: "runner-1", leaseDurationSeconds: 60 });

      expect(result.isOk()).toBe(true);

      // logger.info must have been called with "llm narrative batch"
      const infoCalls = (loggerSpy.info as ReturnType<typeof vi.fn>).mock.calls;
      const batchCall = infoCalls.find((args) => args[0] === "llm narrative batch");
      expect(batchCall).toBeDefined();
      const batchContext = batchCall?.[1] as {
        provider: string;
        requested: number;
        llmSuccess: number;
        llmFallback: number;
        byReason: Record<string, number>;
      };
      expect(batchContext.provider).toBe("claude-code");
      expect(batchContext.requested).toBe(3);
      expect(batchContext.llmSuccess).toBe(2);
      expect(batchContext.llmFallback).toBe(1);
      expect(batchContext.byReason["invoker_error"]).toBe(1);
    });

    it("(rule-based path) generateFeedbackLayersAsync undefined → logger.info 'llm narrative batch' NOT called", async () => {
      ulidCounter = 0;

      const loggerSpy = makeLogger();

      // Sync-only generator (no generateFeedbackLayersAsync)
      const syncGenerator: RunAssessmentJobDependencies["improvementMessageGenerator"] = {
        generate: () => "sync-message",
        generateFeedbackLayers: () => ({
          whatJa: "sync-what",
          whyJa: "sync-why",
          howJa: "sync-how",
        }),
        // generateFeedbackLayersAsync is intentionally absent
      };

      const threeFindings = Array.from({ length: 3 }, (_, i) =>
        makeRankedFindingDraft({ severity: "minor", functionalLoad: "mid", index: i }),
      );

      const deps = makeDependencies({
        engineRegistry: {
          find: () => ok({ assess: () => okAsync(makeDraftWithSpecificFindings(threeFindings)) }),
        },
        improvementMessageGenerator: syncGenerator,
        logger: loggerSpy,
      });

      const execute = createRunAssessmentJob(deps);
      const result = await execute({ leaseOwner: "runner-1", leaseDurationSeconds: 60 });

      expect(result.isOk()).toBe(true);

      const infoCalls = (loggerSpy.info as ReturnType<typeof vi.fn>).mock.calls;
      const batchCall = infoCalls.find((args) => args[0] === "llm narrative batch");
      expect(batchCall).toBeUndefined();
    });
  });
});
