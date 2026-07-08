/**
 * W53: shadowing adaptor の ArrayBuffer コピー検証。
 * byteOffset 付き Uint8Array view を渡したとき、multipart に載る Blob の中身が
 * view の範囲（byteOffset〜byteOffset+byteLength）と一致することを固定する。
 * `buffer.slice(0)` 形式は underlying buffer 全体をコピーしてしまうため、この検証で検出できる。
 */

import { describe, it, expect, vi } from "vitest";
import { createOssWorkerShadowingLagAdaptor } from "../create-oss-worker-shadowing-lag-adaptor";
import { type ShadowingLagInput } from "../../../../usecase/port/shadowing-lag-client";

describe("createOssWorkerShadowingLagAdaptor", () => {
  it("byteOffset 付き Uint8Array view を渡すと Blob の中身が view の範囲と一致する", async () => {
    // underlying buffer は 8 bytes。view はその一部だけを参照する。
    const underlyingBytes = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]);
    const referenceAudioView = new Uint8Array(underlyingBytes.buffer, 2, 4); // [2,3,4,5]
    const learnerAudioView = new Uint8Array(underlyingBytes.buffer, 5, 3); // [5,6,7]

    let capturedFormData: FormData | null = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      capturedFormData = (init?.body ?? null) as FormData | null;
      return Promise.resolve({
        status: 500,
        json: () => Promise.resolve(null),
      } as Response);
    }) as typeof globalThis.fetch;

    try {
      const adaptor = createOssWorkerShadowingLagAdaptor({
        workerApiEndpoint: "http://localhost:8787",
        timeoutMilliseconds: 1000,
      });

      const input: ShadowingLagInput = {
        referenceAudioBytes: referenceAudioView,
        referenceAudioMimeType: "audio/wav",
        learnerAudioBytes: learnerAudioView,
        learnerAudioMimeType: "audio/webm",
        referenceText: "Hello world",
        durationMilliseconds: 3000,
      };

      // status 500 応答なので結果は err だが、この検証の対象は送信 Blob の中身のみ。
      await adaptor.computeLag(input);

      expect(capturedFormData).not.toBeNull();

      const referenceAudioPart = capturedFormData!.get("reference_audio");
      expect(referenceAudioPart).toBeInstanceOf(Blob);
      const referenceAudioSentBytes = new Uint8Array(
        await (referenceAudioPart as Blob).arrayBuffer(),
      );
      expect(Array.from(referenceAudioSentBytes)).toEqual([2, 3, 4, 5]);
      expect((referenceAudioPart as Blob).type).toBe("audio/wav");

      const learnerAudioPart = capturedFormData!.get("learner_audio");
      expect(learnerAudioPart).toBeInstanceOf(Blob);
      const learnerAudioSentBytes = new Uint8Array(await (learnerAudioPart as Blob).arrayBuffer());
      expect(Array.from(learnerAudioSentBytes)).toEqual([5, 6, 7]);
      expect((learnerAudioPart as Blob).type).toBe("audio/webm");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
