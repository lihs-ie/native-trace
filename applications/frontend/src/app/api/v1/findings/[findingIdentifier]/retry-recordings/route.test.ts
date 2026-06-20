/**
 * POST /api/v1/findings/{findingIdentifier}/retry-recordings — route handler テスト
 *
 * 仕様: docs/specs/closed-remediation-loop.md M-CRL-11 / M-CRL-13 / M-CRL-16
 *
 * Done When:
 * - normal retry → 200 with all 11 fields incl. retrySeverity/retryConfidence/retryRecordingAttemptIdentifier + qualityStatus='normal'
 * - low_quality retry WITH diagnostic → 200 + qualityStatus='low_quality' + gopDelta fields
 * - low_quality retry WITHOUT diagnostic → 422
 * - timeout → 422
 * - missing audio field → 400
 *
 * agent-policy: getContainer / ensureFindingRetrySectionExists / createGopDeltaAdaptor は
 * vi.mock でテスト層のみに閉じたモック。本番コードには一切混入しない (ci/allowlist.yml 登録済み)。
 *
 * NextRequest.formData() は Node.js/jsdom 環境で multipart パーサが hangするため、
 * vi.spyOn でインスタンスメソッドを差し替える (テストダブルはこのファイル内に完全閉じ込め)。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { okAsync, errAsync } from "neverthrow";
import type { DiagnosticPerPhonemeGopDraft } from "../../../../../../usecase/assessment-result-draft";

// ---- モジュールモック ----

vi.mock("../../../../../../registry", () => ({
  getContainer: vi.fn(),
}));

vi.mock("../../../../../../infrastructure/training/finding-retry-section-fixture", () => ({
  ensureFindingRetrySectionExists: vi.fn(),
}));

vi.mock("../../../../../../acl/gop-delta/create-gop-delta-adaptor", () => ({
  createGopDeltaAdaptor: vi.fn(),
}));

// モック後にインポート
import { getContainer } from "../../../../../../registry";
import { ensureFindingRetrySectionExists } from "../../../../../../infrastructure/training/finding-retry-section-fixture";
import { createGopDeltaAdaptor } from "../../../../../../acl/gop-delta/create-gop-delta-adaptor";
import { POST } from "./route";

// ---- fixture helpers ----

const FINDING_ID = "finding-01";
const ATTEMPT_ID = "01ATTEMPT000001";

const makeGopDeltaResponse = () => ({
  gopDelta: 5.5,
  deltaSignal: "improved" as const,
  boundarySignal: "crossedMajor" as const,
  retrySeverity: "major" as const,
  retryConfidence: 0.87,
});

const makeSubmitOutput = (identifier: string = ATTEMPT_ID) => ({
  recordingAttempt: { identifier, state: "ready" as const, createdAt: "2026-01-01T00:00:00Z" },
  audioFile: {
    identifier: "af-01",
    mimeType: "audio/wav",
    sizeBytes: 1024,
    durationMilliseconds: 2000,
  },
  analysisRun: {
    identifier: "run-01",
    mode: "oss_worker_only",
    createdAt: "2026-01-01T00:00:00Z",
  },
  analysisJobs: [{ identifier: "job-01", engine: "oss_worker", state: "queued" as const }],
  events: [{ type: "analysisRunStarted" as const, analysisRun: "run-01" as never }] as never,
});

const makeRunJobSucceeded = () => ({
  job: { identifier: "job-01", engine: "oss_worker", state: "succeeded" },
  result: { identifier: "result-01", analysisJob: "job-01" },
  retryScheduled: false,
  events: [],
  diagnosticPerPhonemeGop: [],
});

const makeRunJobLowQuality = (diagnosticGop: DiagnosticPerPhonemeGopDraft[] = []) => ({
  job: { identifier: "job-01", engine: "oss_worker", state: "failed" },
  result: null,
  retryScheduled: false,
  events: [],
  diagnosticPerPhonemeGop: diagnosticGop,
});

const makeDiagnosticGop = (
  phoneme: string = "l",
  gop: number = -9.8,
): DiagnosticPerPhonemeGopDraft[] => [{ phoneme, gop, startMs: 100, endMs: 200 }];

/** assessmentResult.find が返すオブジェクト */
const makeAssessmentResult = (phoneme: string = "l", gop: number = -9.8) => ({
  identifier: "result-01" as never,
  analysisJob: "job-01" as never,
  perPhonemeGop: [{ word: "world", phoneme, gop, heat: 0.6 }],
  focusSounds: null,
  prosody: null,
});

// ---- FormData / Request helpers ----

type FormFields = {
  audio?: File | null;
  referenceText?: string;
  expectedPhonemeIpa?: string;
  recordedDurationMs?: string;
  expectedAudioRangeStartMs?: string;
  originalGop?: string;
};

const buildFormData = (overrides: FormFields = {}): FormData => {
  const form = new FormData();
  const defaults: FormFields = {
    audio: new File([new Uint8Array(100)], "test.wav", { type: "audio/wav" }),
    referenceText: "world",
    expectedPhonemeIpa: "l",
    recordedDurationMs: "2000",
    expectedAudioRangeStartMs: "100",
    originalGop: "-15.3",
  };
  const merged = { ...defaults, ...overrides };
  for (const [key, value] of Object.entries(merged)) {
    if (value !== null && value !== undefined) {
      form.append(key, value as string | File);
    }
  }
  return form;
};

/**
 * buildRequest — NextRequest を構築し、formData() を vi.spyOn で差し替える。
 *
 * Node.js/jsdom 環境では multipart/form-data の ReadableStream パーサが完了しないため、
 * request.formData() が resolve しない。spyOn でインスタンスメソッドを即時解決モックに
 * 差し替えることで route handler がテスト内で完結する。
 * 本番コードには一切影響しない (NextRequest インスタンスはテスト内スコープ)。
 */
const buildRequest = (formData: FormData): NextRequest => {
  const request = new NextRequest(
    `http://localhost:3000/api/v1/findings/${FINDING_ID}/retry-recordings`,
    { method: "POST" },
  );
  vi.spyOn(request, "formData").mockResolvedValue(formData);
  return request;
};

const buildContext = (findingIdentifier: string = FINDING_ID) => ({
  params: Promise.resolve({ findingIdentifier }),
});

// ---- mock container helper ----

const setupContainer = (
  options: {
    submitResult?: ReturnType<typeof makeSubmitOutput>;
    submitError?: string;
    runJobResult?: ReturnType<typeof makeRunJobSucceeded> | ReturnType<typeof makeRunJobLowQuality>;
    assessmentResult?: ReturnType<typeof makeAssessmentResult> | null;
  } = {},
) => {
  const submitOutput = options.submitResult ?? makeSubmitOutput();
  const runJobOutput = options.runJobResult ?? makeRunJobSucceeded();
  const assessmentResultValue =
    options.assessmentResult !== undefined ? options.assessmentResult : makeAssessmentResult();

  vi.mocked(getContainer).mockReturnValue({
    config: {
      workerApiEndpoint: "http://worker:8787",
      ossWorkerTimeoutMilliseconds: 5000,
    } as never,
    database: {} as never,
    repositories: {
      assessmentResult: {
        find: vi.fn(() =>
          assessmentResultValue
            ? okAsync(assessmentResultValue as never)
            : errAsync({
                type: "notFound" as const,
                resource: "assessmentResult",
                identifier: "x",
              }),
        ),
      } as never,
    } as never,
    usecases: {
      submitPracticeAttempt: vi.fn(() =>
        options.submitError
          ? errAsync({ type: options.submitError as never })
          : okAsync(submitOutput),
      ),
      runAssessmentJob: vi.fn(() => okAsync(runJobOutput)),
    } as never,
  } as never);
};

// ---- tests ----

beforeEach(() => {
  vi.mocked(ensureFindingRetrySectionExists).mockResolvedValue("section-01" as never);
  vi.mocked(createGopDeltaAdaptor).mockReturnValue({
    computeGopDelta: vi.fn().mockResolvedValue(makeGopDeltaResponse()),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/v1/findings/{findingIdentifier}/retry-recordings", () => {
  describe("normal retry (M-CRL-11/M-CRL-13, ORPHAN-3)", () => {
    it("200 + all 11 fields with qualityStatus='normal'", async () => {
      setupContainer();
      const response = await POST(buildRequest(buildFormData()), buildContext());
      const body = (await response.json()) as { data: Record<string, unknown> };

      expect(response.status).toBe(200);
      const dto = body.data;

      // 11 fields (M-CRL-6 original 8 + M-CRL-11 x2 + M-CRL-13 x1)
      expect(dto.findingIdentifier).toBe(FINDING_ID);
      expect(dto.phoneme).toBe("l");
      expect(dto.originalGop).toBe(-15.3);
      expect(dto.retryGop).toBe(-9.8);
      expect(dto.gopDelta).toBe(5.5);
      expect(dto.deltaSignal).toBe("improved");
      expect(dto.boundarySignal).toBe("crossedMajor");
      expect(dto.qualityStatus).toBe("normal");
      // M-CRL-11
      expect(dto.retrySeverity).toBe("major");
      expect(dto.retryConfidence).toBe(0.87);
      // M-CRL-13
      expect(dto.retryRecordingAttemptIdentifier).toBe(ATTEMPT_ID);
    });

    it("retrySeverity/retryConfidence come from worker ACL verbatim — no route-level threshold", async () => {
      setupContainer();
      // ACL returns 'critical' with high confidence — route must pass through verbatim
      vi.mocked(createGopDeltaAdaptor).mockReturnValue({
        computeGopDelta: vi.fn().mockResolvedValue({
          ...makeGopDeltaResponse(),
          retrySeverity: "critical" as const,
          retryConfidence: 0.95,
        }),
      });
      const response = await POST(buildRequest(buildFormData()), buildContext());
      const body = (await response.json()) as { data: Record<string, unknown> };

      expect(response.status).toBe(200);
      expect(body.data.retrySeverity).toBe("critical");
      expect(body.data.retryConfidence).toBe(0.95);
    });

    it("retryRecordingAttemptIdentifier reflects the submitPracticeAttempt recording identifier", async () => {
      const customId = "01CUSTOMATTEMPTID";
      setupContainer({ submitResult: makeSubmitOutput(customId) });
      const response = await POST(buildRequest(buildFormData()), buildContext());
      const body = (await response.json()) as { data: Record<string, unknown> };

      expect(response.status).toBe(200);
      expect(body.data.retryRecordingAttemptIdentifier).toBe(customId);
    });
  });

  describe("low_quality retry (M-CRL-16, ORPHAN-1)", () => {
    it("200 + qualityStatus='low_quality' + all 11 fields when diagnosticPerPhonemeGop is non-empty", async () => {
      setupContainer({
        runJobResult: makeRunJobLowQuality(makeDiagnosticGop()),
        assessmentResult: null,
      });
      const response = await POST(buildRequest(buildFormData()), buildContext());
      const body = (await response.json()) as { data: Record<string, unknown> };

      expect(response.status).toBe(200);
      const dto = body.data;
      expect(dto.qualityStatus).toBe("low_quality");
      expect(dto.retryGop).toBe(-9.8);
      expect(dto.gopDelta).toBe(5.5);
      expect(dto.retrySeverity).toBe("major");
      expect(dto.retryConfidence).toBe(0.87);
      expect(dto.retryRecordingAttemptIdentifier).toBe(ATTEMPT_ID);
    });

    it("422 when expectedPhonemeIpa has no match in diagnosticPerPhonemeGop", async () => {
      // diagnostic has 'ɹ' only, request uses 'l' → no match → 422
      setupContainer({
        runJobResult: makeRunJobLowQuality([{ phoneme: "ɹ", gop: -7.0, startMs: 0, endMs: 100 }]),
        assessmentResult: null,
      });
      const response = await POST(
        buildRequest(buildFormData({ expectedPhonemeIpa: "l" })),
        buildContext(),
      );

      expect(response.status).toBe(422);
    });

    it("422 when diagnosticPerPhonemeGop is empty (M-CRL-16 empty diagnostic → no GOP → 422)", async () => {
      setupContainer({
        runJobResult: makeRunJobLowQuality([]),
        assessmentResult: null,
      });
      const response = await POST(buildRequest(buildFormData()), buildContext());
      const body = (await response.json()) as { message: string };

      expect(response.status).toBe(422);
      expect(body.message).toBe("もう一度はっきり録音してください");
    });
  });

  describe("validation errors", () => {
    it("400 when audio field is missing from form", async () => {
      setupContainer();
      const formWithoutAudio = buildFormData();
      formWithoutAudio.delete("audio");
      const response = await POST(buildRequest(formWithoutAudio), buildContext());

      expect(response.status).toBe(400);
    });

    it("400 when recordedDurationMs is non-positive", async () => {
      setupContainer();
      const response = await POST(
        buildRequest(buildFormData({ recordedDurationMs: "0" })),
        buildContext(),
      );
      expect(response.status).toBe(400);
    });

    it("400 when originalGop is non-numeric", async () => {
      setupContainer();
      const response = await POST(
        buildRequest(buildFormData({ originalGop: "not-a-number" })),
        buildContext(),
      );
      expect(response.status).toBe(400);
    });
  });

  describe("error paths", () => {
    it("422 on poll timeout (job never completes)", async () => {
      // job: null on every tick → loop never settles → route returns timeout 422.
      // vi.useFakeTimers makes setTimeout non-blocking; vi.advanceTimersByTimeAsync
      // drains the poll sleep (1_000ms) and exhausts the 30_000ms deadline.
      vi.useFakeTimers();

      vi.mocked(getContainer).mockReturnValue({
        config: {
          workerApiEndpoint: "http://worker:8787",
          ossWorkerTimeoutMilliseconds: 5000,
        } as never,
        database: {} as never,
        repositories: { assessmentResult: { find: vi.fn() } as never } as never,
        usecases: {
          submitPracticeAttempt: vi.fn(() => okAsync(makeSubmitOutput())),
          runAssessmentJob: vi.fn(() =>
            okAsync({
              job: null,
              result: null,
              retryScheduled: false,
              events: [],
              diagnosticPerPhonemeGop: [],
            }),
          ),
        } as never,
      } as never);

      // Start the route handler; it will await the poll sleep internally.
      const responsePromise = POST(buildRequest(buildFormData()), buildContext());

      // Advance fake time past the 30_000ms poll deadline so the loop exits.
      await vi.advanceTimersByTimeAsync(31_000);

      vi.useRealTimers();

      const response = await responsePromise;
      expect(response.status).toBe(422);
    });

    it("400 when submitPracticeAttempt fails", async () => {
      setupContainer({ submitError: "audioStorageFailed" });
      const response = await POST(buildRequest(buildFormData()), buildContext());
      expect(response.status).toBe(400);
    });
  });
});
