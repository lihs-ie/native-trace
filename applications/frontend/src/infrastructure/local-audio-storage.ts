import {
  type AudioStorage,
  type AudioMetadata,
  type AudioStreamResult,
  type AudioRangeRequest,
} from "../usecase/port/audio-storage";
import {
  type AudioFileIdentifier,
  type StorageKey,
  createAudioMimeType,
  createStorageKey,
} from "../domain/audio-file";
import { type AudioStorageFailedError } from "../domain/shared";
import { okAsync, errAsync } from "neverthrow";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

/** cast なしの型付き audioStorageFailed リテラルを作る（W26: DomainError への cast 排除）。 */
const audioStorageFailed = (reason: string): AudioStorageFailedError => ({
  type: "audioStorageFailed",
  reason,
});

export const createLocalAudioStorage = (storageRoot: string): AudioStorage => ({
  save: (
    audioFileIdentifier: AudioFileIdentifier,
    data: Buffer | NodeJS.ReadableStream,
    mimeTypeString: string,
  ) => {
    return okAsync(null).andThen(() => {
      try {
        const audioMimeType = createAudioMimeType(mimeTypeString);
        if (!audioMimeType) {
          return errAsync(audioStorageFailed(`サポートされていない MIME type: ${mimeTypeString}`));
        }

        const ext = mimeTypeString.split("/")[1]?.split(";")[0] ?? "bin";
        const fileName = `${String(audioFileIdentifier)}.${ext}`;
        const filePath = path.join(storageRoot, fileName);

        fs.mkdirSync(storageRoot, { recursive: true });

        if (!Buffer.isBuffer(data)) {
          return errAsync(audioStorageFailed("Stream save は現バージョンでは非対応です"));
        }

        fs.writeFileSync(filePath, data);

        const hash = crypto.createHash("sha256").update(data).digest("hex");
        const storageKey = createStorageKey(fileName);
        if (!storageKey) {
          return errAsync(audioStorageFailed("StorageKey の生成に失敗しました"));
        }

        const metadata: AudioMetadata = {
          mimeType: audioMimeType,
          sizeBytes: data.length,
          durationMilliseconds: 0,
          sha256: hash,
        };

        return okAsync({ storageKey, ...metadata });
      } catch (e) {
        return errAsync(audioStorageFailed(`音声ファイルの保存に失敗しました: ${String(e)}`));
      }
    });
  },

  stream: (storageKey: StorageKey, rangeRequest?: AudioRangeRequest) => {
    return okAsync(null).andThen(() => {
      try {
        const filePath = path.join(storageRoot, String(storageKey));

        if (!fs.existsSync(filePath)) {
          return errAsync(audioStorageFailed("音声ファイルが見つかりません"));
        }

        const stat = fs.statSync(filePath);
        const totalBytes = stat.size;

        const rangeStart = rangeRequest?.startByte ?? 0;
        const rangeEnd = rangeRequest?.endByte ?? totalBytes - 1;
        const contentLength = rangeEnd - rangeStart + 1;

        const stream = fs.createReadStream(filePath, {
          start: rangeStart,
          end: rangeEnd,
        });

        const result: AudioStreamResult = {
          stream,
          contentType: "audio/webm",
          contentLength,
          totalBytes,
          rangeStart,
          rangeEnd,
        };

        return okAsync(result);
      } catch (e) {
        return errAsync(
          audioStorageFailed(`音声ファイルのストリーミングに失敗しました: ${String(e)}`),
        );
      }
    });
  },

  delete: (storageKey: StorageKey) => {
    return okAsync(null).andThen(() => {
      try {
        const filePath = path.join(storageRoot, String(storageKey));
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        return okAsync(undefined);
      } catch (e) {
        return errAsync(audioStorageFailed(`音声ファイルの削除に失敗しました: ${String(e)}`));
      }
    });
  },
});
