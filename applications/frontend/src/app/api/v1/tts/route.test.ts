/**
 * POST /api/v1/tts — お手本 TTS プロキシ unit/contract test (M-124)
 *
 * fetch を vi.stubGlobal で差し替え、config を vi.mock でモックしてテスト層内で完結させる。
 * 本番コードに mock/stub を入れない（agent-policy 準拠）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// config モジュールをモックして createAnalyzerConfig が analyzerApiEndpoint を返すようにする。
// process.env を直接触ることなく endpoint を切り替えられる。
vi.mock("../../../../infrastructure/config", () => ({
  createAnalyzerConfig: vi.fn(() => ({ analyzerApiEndpoint: "http://test-analyzer:8788" })),
}));

import { createAnalyzerConfig } from "../../../../infrastructure/config";
import { POST } from "./route";

// ---- fetch mock helpers ----

const makeWavBytes = (size: number = 256): Uint8Array<ArrayBuffer> =>
  new Uint8Array(new ArrayBuffer(size)).fill(0x52); // 'R' (RIFF header proxy)

const mockFetchSuccess = (audioBytes: Uint8Array<ArrayBuffer>): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(audioBytes, {
        status: 200,
        headers: { "Content-Type": "audio/wav" },
      }),
    ),
  );
};

const mockFetchError = (status: number, bodyText: string = "error"): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(bodyText, {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
};

const mockFetchNetworkFailure = (): void => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network failure")));
};

// ---- request helpers ----

const buildRequest = (body: unknown): NextRequest =>
  new NextRequest("http://localhost:3000/api/v1/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// ---- tests ----

describe("POST /api/v1/tts", () => {
  beforeEach(() => {
    vi.mocked(createAnalyzerConfig).mockReturnValue({
      analyzerApiEndpoint: "http://test-analyzer:8788",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("正常系: audio/wav バイト列の透過", () => {
    it("text と speed=1.0 を指定すると analyzer を呼び出し audio/wav を返す", async () => {
      const wavBytes = makeWavBytes(512);
      mockFetchSuccess(wavBytes);

      const request = buildRequest({ text: "Hello world", speed: 1.0 });
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("audio/wav");

      const responseBuffer = await response.arrayBuffer();
      expect(new Uint8Array(responseBuffer)).toEqual(wavBytes);
    });

    it("speed=0.5 を指定すると analyzer に speed=0.5 で fetch する", async () => {
      const wavBytes = makeWavBytes(1024);
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(wavBytes, {
          status: 200,
          headers: { "Content-Type": "audio/wav" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const request = buildRequest({ text: "Hello world", speed: 0.5 });
      await POST(request);

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://test-analyzer:8788/v1/tts");
      expect(options.method).toBe("POST");
      const requestBody = JSON.parse(options.body as string) as { text: string; speed: number };
      expect(requestBody.speed).toBe(0.5);
    });

    it("speed を省略すると既定 1.0 で fetch する", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(makeWavBytes(), {
          status: 200,
          headers: { "Content-Type": "audio/wav" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const request = buildRequest({ text: "Test sentence" });
      await POST(request);

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const requestBody = JSON.parse(options.body as string) as { text: string; speed: number };
      expect(requestBody.speed).toBe(1.0);
    });

    it("Content-Length が audioBytes.byteLength と一致する", async () => {
      const wavBytes = makeWavBytes(256);
      mockFetchSuccess(wavBytes);

      const request = buildRequest({ text: "Hello" });
      const response = await POST(request);

      expect(response.headers.get("Content-Length")).toBe("256");
    });
  });

  describe("バリデーション: 不正なリクエスト → 400", () => {
    it("body が JSON でない → 400 validationFailed", async () => {
      const request = new NextRequest("http://localhost:3000/api/v1/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      const response = await POST(request);
      expect(response.status).toBe(400);
      const responseBody = (await response.json()) as { error: { code: string } };
      expect(responseBody.error.code).toBe("validationFailed");
    });

    it("text が空文字列 → 400 validationFailed", async () => {
      const request = buildRequest({ text: "" });
      const response = await POST(request);
      expect(response.status).toBe(400);
      const responseBody = (await response.json()) as { error: { code: string } };
      expect(responseBody.error.code).toBe("validationFailed");
    });

    it("text が欠落 → 400 validationFailed", async () => {
      const request = buildRequest({ speed: 1.0 });
      const response = await POST(request);
      expect(response.status).toBe(400);
      const responseBody = (await response.json()) as { error: { code: string } };
      expect(responseBody.error.code).toBe("validationFailed");
    });

    it("speed が 0.5 未満 → 400 validationFailed", async () => {
      const request = buildRequest({ text: "Hello", speed: 0.4 });
      const response = await POST(request);
      expect(response.status).toBe(400);
      const responseBody = (await response.json()) as { error: { code: string } };
      expect(responseBody.error.code).toBe("validationFailed");
    });

    it("speed が 1.0 超 → 400 validationFailed", async () => {
      const request = buildRequest({ text: "Hello", speed: 1.1 });
      const response = await POST(request);
      expect(response.status).toBe(400);
      const responseBody = (await response.json()) as { error: { code: string } };
      expect(responseBody.error.code).toBe("validationFailed");
    });
  });

  describe("analyzer エラー → 適切な 4xx/5xx + JSON", () => {
    it("analyzer が 500 → 502 analyzerError", async () => {
      mockFetchError(500);
      const request = buildRequest({ text: "Hello" });
      const response = await POST(request);
      expect(response.status).toBe(502);
      const responseBody = (await response.json()) as {
        error: { code: string };
        meta: { requestIdentifier: string };
      };
      expect(responseBody.error.code).toBe("analyzerError");
      expect(responseBody.meta.requestIdentifier).toMatch(/^req_/);
    });

    it("analyzer が 400 → 400 analyzerClientError", async () => {
      mockFetchError(400);
      const request = buildRequest({ text: "Hello" });
      const response = await POST(request);
      expect(response.status).toBe(400);
      const responseBody = (await response.json()) as { error: { code: string } };
      expect(responseBody.error.code).toBe("analyzerClientError");
    });

    it("analyzer への fetch がネットワークエラー → 502 analyzerUnavailable", async () => {
      mockFetchNetworkFailure();
      const request = buildRequest({ text: "Hello" });
      const response = await POST(request);
      expect(response.status).toBe(502);
      const responseBody = (await response.json()) as { error: { code: string } };
      expect(responseBody.error.code).toBe("analyzerUnavailable");
    });
  });

  describe("エンドポイント契約 (C2 contract)", () => {
    it("analyzer に送る URL が createAnalyzerConfig の endpoint + /v1/tts になる", async () => {
      vi.mocked(createAnalyzerConfig).mockReturnValue({
        analyzerApiEndpoint: "http://custom-analyzer:9999",
      });
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(makeWavBytes(), {
          status: 200,
          headers: { "Content-Type": "audio/wav" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const request = buildRequest({ text: "Hello" });
      await POST(request);

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://custom-analyzer:9999/v1/tts");
    });

    it("エラーレスポンスは meta.requestIdentifier を含む", async () => {
      mockFetchNetworkFailure();
      const request = buildRequest({ text: "Hello" });
      const response = await POST(request);
      const responseBody = (await response.json()) as { meta: { requestIdentifier: string } };
      expect(responseBody.meta.requestIdentifier).toMatch(/^req_[0-9a-f]{32}$/);
    });
  });
});
