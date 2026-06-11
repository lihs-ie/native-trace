/**
 * API-016: GET /api/v1/recording-attempts/{recordingAttemptIdentifier}/audio — 録音音声取得
 * Range リクエスト対応: 200 (全体) / 206 (部分) / 416 (範囲不正)
 * レスポンスは音声バイナリ直接返却（JSON wrapper なし）。エラー時のみ JSON。
 */

import { type NextRequest } from "next/server";
import { getContainer } from "../../../../../../registry";
import { domainErrorToResponse } from "../../../_shared/errors";
import { parseRangeHeader } from "../../../_shared/range";

type RouteContext = { params: Promise<{ recordingAttemptIdentifier: string }> };

/** NodeJS.ReadableStream を Web ReadableStream へ変換する（node:stream を import しない）。 */
const toWebReadableStream = (nodeStream: NodeJS.ReadableStream): ReadableStream<Uint8Array> => {
  return new ReadableStream({
    start(controller) {
      nodeStream.on("data", (chunk: Buffer | string) => {
        const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        controller.enqueue(new Uint8Array(buffer));
      });
      nodeStream.on("end", () => {
        controller.close();
      });
      nodeStream.on("error", (err) => {
        controller.error(err);
      });
    },
    cancel() {
      if ("destroy" in nodeStream && typeof nodeStream.destroy === "function") {
        (nodeStream as NodeJS.ReadableStream & { destroy(): void }).destroy();
      }
    },
  });
};

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  const { recordingAttemptIdentifier } = await context.params;

  const container = getContainer();

  // openRecordingAudio で storageKey / mimeType / sizeBytes を解決する
  const audioMetaResult = await container.usecases.openRecordingAudio({
    recordingAttempt: recordingAttemptIdentifier,
  });

  if (audioMetaResult.isErr()) {
    return domainErrorToResponse(audioMetaResult.error);
  }

  const { storageKey, mimeType, sizeBytes } = audioMetaResult.value;

  const rangeHeader = request.headers.get("Range");
  const parsed = parseRangeHeader(rangeHeader, sizeBytes);

  if (parsed === "invalid") {
    return new Response(null, {
      status: 416,
      headers: {
        "Content-Range": `bytes */${sizeBytes}`,
      },
    });
  }

  if (parsed === null) {
    // Range なし → 200 全体返却
    const streamResult = await container.audioStorage.stream(storageKey as never, undefined);
    if (streamResult.isErr()) {
      return domainErrorToResponse(streamResult.error);
    }

    const { stream, contentLength } = streamResult.value;
    const webStream = toWebReadableStream(stream);

    return new Response(webStream, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(contentLength),
        "Accept-Ranges": "bytes",
      },
    });
  }

  const streamResult = await container.audioStorage.stream(storageKey as never, {
    startByte: parsed.startByte,
    endByte: parsed.endByte,
  });

  if (streamResult.isErr()) {
    return domainErrorToResponse(streamResult.error);
  }

  const { stream, contentLength, totalBytes, rangeStart, rangeEnd } = streamResult.value;
  const webStream = toWebReadableStream(stream);

  return new Response(webStream, {
    status: 206,
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(contentLength),
      "Content-Range": `bytes ${rangeStart}-${rangeEnd}/${totalBytes}`,
      "Accept-Ranges": "bytes",
    },
  });
}
