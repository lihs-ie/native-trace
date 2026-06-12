/**
 * Done When (e): OssWorkerAdaptor の timeout テスト。
 * timeoutMilliseconds=50 + 100ms 遅延 fetch fake → DomainError(assessmentEngineFailed, retryable)。
 */

import { describe, it, expect, vi } from "vitest";
import { createOssWorkerPronunciationAssessmentAdaptor } from "../create-oss-worker-pronunciation-assessment-adaptor";
import { type AssessPronunciationInput } from "../../../../usecase/port/pronunciation-assessment-engine";

const makeAssessInput = (): AssessPronunciationInput => ({
  analysisJob: "01JOB" as never,
  analysisRun: "01RUN" as never,
  recordingAttempt: "01ATTEMPT" as never,
  section: "01SECTION" as never,
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
  sectionBodyText: "Hello world",
  audioBuffer: Buffer.from("fake-audio"),
  audioMimeType: "audio/wav",
  audioByteLength: 10,
  audioDurationMilliseconds: 1000,
  tokenizerVersion: "v1",
  assessmentSchemaVersion: "1",
});

describe("createOssWorkerPronunciationAssessmentAdaptor", () => {
  // Done When (e): timeoutMilliseconds=50 + 100ms 遅延 fetch fake → DomainError
  it("(e) fires timeout and returns DomainError when fetch takes longer than timeoutMilliseconds", async () => {
    // 100ms 遅延する fetch を fake として globalThis.fetch に差し込む。
    // signal が abort されたら signal.reason (AbortController がセットした DOMException) で reject する。
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = (init?.signal ?? null) as AbortSignal | null;

          const handleAbort = () => {
            // signal.reason は AbortController.abort() でセットされた値。
            // デフォルトは DOMException("signal is aborted without reason", "AbortError")。
            // reason が falsy の場合は name="AbortError" の Error にフォールバックする。
            const reason: unknown = signal?.reason;
            if (reason instanceof Error) {
              reject(reason);
            } else {
              const fallback = new Error("AbortError");
              fallback.name = "AbortError";
              reject(fallback);
            }
          };

          if (signal?.aborted) {
            handleAbort();
          } else if (signal != null) {
            signal.addEventListener("abort", handleAbort, { once: true });
          }
        }),
    ) as typeof globalThis.fetch;

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const clock = { now: () => new Date("2026-01-01T00:00:00Z") };

    const adaptor = createOssWorkerPronunciationAssessmentAdaptor({
      workerApiEndpoint: "http://localhost:8787",
      timeoutMilliseconds: 50,
      clock,
      logger,
    });

    const result = await adaptor.assess(makeAssessInput());

    // 後始末
    globalThis.fetch = originalFetch;

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("assessmentEngineFailed");
      if (result.error.type === "assessmentEngineFailed") {
        // AbortError は retryable
        expect(result.error.failureKind).toBe("retryable");
      }
    }
  }, 3000);
});
