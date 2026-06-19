/**
 * GopDeltaAdaptor — worker POST /v1/gop-delta の薄い ACL ラッパー。
 *
 * 設計の正: docs/specs/closed-remediation-loop.md (M-CRL-4/M-CRL-7)
 *          adr/022-closed-remediation-improvement-measurement-loop.md (D6)
 *
 * route は直接 worker を fetch しない（architecture-import 層閉じ込め）。
 * 本 adaptor を経由することで worker URL 設定が一箇所に集約される。
 *
 * worker 契約 (parallel implementer と verbatim 一致):
 *   POST {workerBaseUrl}/v1/gop-delta
 *   request:  { "originalGop": number, "retryGop": number }
 *   response: { "gopDelta": number, "deltaSignal": "improved"|"unchanged"|"regressed",
 *               "boundarySignal": "crossedMajor"|"crossedMinor"|"none" }
 *
 * frontend は deltaSignal / boundarySignal を受け取るだけで threshold を再導出しない。
 * -8 / -12 / gopMinorThreshold / gopMajorThreshold 相当の数値はこのファイルに現れない。
 */

import { z } from "zod";

const gopDeltaResponseSchema = z.object({
  gopDelta: z.number(),
  deltaSignal: z.enum(["improved", "unchanged", "regressed"]),
  boundarySignal: z.enum(["crossedMajor", "crossedMinor", "none"]),
});

export type GopDeltaResponse = z.infer<typeof gopDeltaResponseSchema>;

export type GopDeltaAdaptorDependencies = Readonly<{
  workerApiEndpoint: string;
  timeoutMilliseconds: number;
}>;

export type GopDeltaInput = Readonly<{
  originalGop: number;
  retryGop: number;
}>;

export type GopDeltaAdaptor = Readonly<{
  computeGopDelta: (input: GopDeltaInput) => Promise<GopDeltaResponse>;
}>;

/**
 * createGopDeltaAdaptor — worker /v1/gop-delta 薄い ACL ファクトリ。
 * route から直接 worker を fetch しないために挟む層。
 */
export const createGopDeltaAdaptor = (
  dependencies: GopDeltaAdaptorDependencies,
): GopDeltaAdaptor => ({
  computeGopDelta: async (input: GopDeltaInput): Promise<GopDeltaResponse> => {
    const url = `${dependencies.workerApiEndpoint}/v1/gop-delta`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), dependencies.timeoutMilliseconds);

    let response: Response;
    try {
      response = await globalThis.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ originalGop: input.originalGop, retryGop: input.retryGop }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new Error(
        `worker /v1/gop-delta responded ${response.status}: ${await response.text().catch(() => "")}`,
      );
    }

    const rawBody = await (response.json() as Promise<unknown>);
    const parsed = gopDeltaResponseSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new Error(
        `worker /v1/gop-delta response schema mismatch: ${parsed.error.message}`,
      );
    }

    return parsed.data;
  },
});
