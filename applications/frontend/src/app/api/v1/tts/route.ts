/**
 * API: POST /api/v1/tts — お手本 TTS プロキシ (M-124)
 *
 * リクエスト: { text: string, speed?: number (0.5–1.0, 既定 1.0) }
 * レスポンス: audio/wav バイト列を直接返す（JSON エンベロープなし）。
 * エラー時のみ JSON エンベロープ（既存 route の整形パターン踏襲）。
 *
 * analyzer の POST /v1/tts に fetch でプロキシする。
 * process.env 参照は infrastructure/config のみ（ast-grep 規則準拠）。
 */

import { type NextRequest } from "next/server";
import { z } from "zod";
import { createAnalyzerConfig } from "../../../../infrastructure/config";
import { errorResponse } from "../_shared/errors";
import { zodErrorToValidationFailed } from "../_shared/validation";

const requestBodySchema = z.object({
  text: z.string().min(1, "text は 1 文字以上必要です"),
  speed: z.number().min(0.5).max(1.0).default(1.0),
});

export async function POST(request: NextRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "validationFailed", "JSON のパースに失敗しました");
  }

  const parseResult = requestBodySchema.safeParse(body);
  if (!parseResult.success) {
    return errorResponse(
      400,
      "validationFailed",
      zodErrorToValidationFailed(parseResult.error).reason,
    );
  }

  const { text, speed } = parseResult.data;

  const config = createAnalyzerConfig();

  let analyzerResponse: globalThis.Response;
  try {
    analyzerResponse = await fetch(`${config.analyzerApiEndpoint}/v1/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, speed }),
    });
  } catch {
    return errorResponse(502, "analyzerUnavailable", "TTS エンジンとの通信に失敗しました");
  }

  if (!analyzerResponse.ok) {
    if (analyzerResponse.status >= 400 && analyzerResponse.status < 500) {
      return errorResponse(
        analyzerResponse.status,
        "analyzerClientError",
        "TTS リクエストが不正です",
      );
    }
    return errorResponse(502, "analyzerError", "TTS エンジンがエラーを返しました");
  }

  const audioBytes = await analyzerResponse.arrayBuffer();

  return new Response(audioBytes, {
    status: 200,
    headers: {
      "Content-Type": "audio/wav",
      "Content-Length": String(audioBytes.byteLength),
    },
  });
}
