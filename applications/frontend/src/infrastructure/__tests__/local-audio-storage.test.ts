import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createLocalAudioStorage } from "../local-audio-storage";
import {
  createAudioFileIdentifier,
  createStorageKey,
} from "../../domain/audio-file";

describe("LocalAudioStorage", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-audio-storage-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("バッファを保存して storageKey と sha256 を返す", async () => {
    const storage = createLocalAudioStorage(tmpDir);
    const identifier = createAudioFileIdentifier("AF001")!;
    const buffer = Buffer.from("fake audio data");

    const result = await storage.save(identifier, buffer, "audio/webm");
    expect(result.isOk()).toBe(true);

    const saved = result._unsafeUnwrap();
    expect(String(saved.storageKey)).toBe("AF001.webm");
    expect(saved.sha256).toHaveLength(64);
    expect(saved.sizeBytes).toBe(buffer.length);
    expect(String(saved.mimeType)).toBe("audio/webm");
  });

  it("サポートされていない MIME type で audioStorageFailed を返す", async () => {
    const storage = createLocalAudioStorage(tmpDir);
    const identifier = createAudioFileIdentifier("AF001")!;
    const buffer = Buffer.from("fake audio data");

    const result = await storage.save(identifier, buffer, "video/mp4");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("audioStorageFailed");
  });

  it("保存したファイルをストリームで読み込める", async () => {
    const storage = createLocalAudioStorage(tmpDir);
    const identifier = createAudioFileIdentifier("AF002")!;
    const buffer = Buffer.from("stream test audio data for webm");

    await storage.save(identifier, buffer, "audio/webm");
    const storageKey = createStorageKey("AF002.webm")!;

    const streamResult = await storage.stream(storageKey);
    expect(streamResult.isOk()).toBe(true);

    const { stream, totalBytes } = streamResult._unsafeUnwrap();
    expect(totalBytes).toBe(buffer.length);

    // stream からデータを読み込む
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", resolve);
      stream.on("error", reject);
    });

    const result = Buffer.concat(chunks);
    expect(result.toString()).toBe("stream test audio data for webm");
  });

  it("存在しないファイルのストリームで audioStorageFailed を返す", async () => {
    const storage = createLocalAudioStorage(tmpDir);
    const storageKey = createStorageKey("NOTEXIST.webm")!;

    const result = await storage.stream(storageKey);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("audioStorageFailed");
  });

  it("ファイルを削除できる", async () => {
    const storage = createLocalAudioStorage(tmpDir);
    const identifier = createAudioFileIdentifier("AF003")!;
    const buffer = Buffer.from("delete test");

    await storage.save(identifier, buffer, "audio/webm");

    const storageKey = createStorageKey("AF003.webm")!;
    const deleteResult = await storage.delete(storageKey);
    expect(deleteResult.isOk()).toBe(true);

    // ファイルが削除されていることを確認
    expect(fs.existsSync(path.join(tmpDir, "AF003.webm"))).toBe(false);
  });

  it("存在しないファイルの削除は成功を返す（冪等性）", async () => {
    const storage = createLocalAudioStorage(tmpDir);
    const storageKey = createStorageKey("NONEXISTENT.webm")!;

    const result = await storage.delete(storageKey);
    expect(result.isOk()).toBe(true);
  });
});
