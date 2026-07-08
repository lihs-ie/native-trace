/**
 * API: POST /api/v1/golden-speaker/convert — Golden speaker 変換プロキシ (M-GRV-7)
 *
 * リクエスト: multipart/form-data { learnerAudio: File, metadata: JSON string { mimeType } }
 * レスポンス: GoldenConversionResponse JSON
 *
 * worker POST /golden-speaker/convert に multipart で転送し、
 * parseGoldenConversionResponse で qualityGatePassed=false 時に audioBase64 を null にする (ORPHAN-4)。
 * worker が 503 / 不到達の場合は 502 を返す。
 * process.env 参照は infrastructure/config のみ (ast-grep 規則準拠)。
 */

import { type NextRequest } from "next/server";
import { createConfig } from "../../../../../infrastructure/config";
import { parseGoldenConversionResponse } from "../../../../../acl/golden-speaker/schema";
import { errorResponse } from "../../_shared/errors";
import { generateRequestIdentifier } from "../../_shared/response";

export async function POST(request: NextRequest): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(400, "validationFailed", "multipart/form-data のパースに失敗しました");
  }

  const learnerAudio = formData.get("learnerAudio");
  if (!learnerAudio || !(learnerAudio instanceof File)) {
    return errorResponse(400, "validationFailed", "learnerAudio フィールドが必須です");
  }

  const metadataRaw = formData.get("metadata");
  if (!metadataRaw || typeof metadataRaw !== "string") {
    return errorResponse(400, "validationFailed", "metadata フィールドが必須です");
  }

  let metadata: unknown;
  try {
    metadata = JSON.parse(metadataRaw);
  } catch {
    return errorResponse(400, "validationFailed", "metadata は JSON 文字列で指定してください");
  }

  if (
    typeof metadata !== "object" ||
    metadata === null ||
    typeof (metadata as Record<string, unknown>)["mimeType"] !== "string"
  ) {
    return errorResponse(400, "validationFailed", "metadata.mimeType が必須です");
  }

  const config = createConfig();
  const workerUrl = `${config.workerApiEndpoint}/golden-speaker/convert`;

  const workerFormData = new FormData();
  workerFormData.append("learner_audio", learnerAudio);
  workerFormData.append(
    "metadata",
    JSON.stringify({ mimeType: (metadata as Record<string, unknown>)["mimeType"] }),
  );

  let workerResponse: globalThis.Response;
  try {
    workerResponse = await fetch(workerUrl, {
      method: "POST",
      body: workerFormData,
    });
  } catch {
    return errorResponse(
      502,
      "goldenSpeakerUnavailable",
      "Golden speaker サービスとの通信に失敗しました",
    );
  }

  if (workerResponse.status === 503) {
    return errorResponse(
      503,
      "goldenSpeakerUnavailable",
      "Golden speaker サービスが利用できません",
    );
  }

  if (!workerResponse.ok) {
    return errorResponse(502, "goldenSpeakerError", "Golden speaker サービスがエラーを返しました");
  }

  let rawBody: unknown;
  try {
    rawBody = await (workerResponse.json() as Promise<unknown>);
  } catch {
    return errorResponse(502, "goldenSpeakerError", "レスポンスの JSON パースに失敗しました");
  }

  // ORPHAN-4: qualityGatePassed=false 時は audioBase64 を null に強制
  const parsed = parseGoldenConversionResponse(rawBody);
  if (!parsed) {
    return errorResponse(502, "goldenSpeakerError", "レスポンスのスキーマ検証に失敗しました");
  }

  const requestIdentifier = generateRequestIdentifier();
  return Response.json({ data: parsed, meta: { requestIdentifier } }, { status: 200 });
}
