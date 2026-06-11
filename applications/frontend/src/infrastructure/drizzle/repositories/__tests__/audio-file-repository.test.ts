import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../schema";
import { type DrizzleDatabase } from "../../client";
import { createDrizzleAudioFileRepository } from "../audio-file-repository";
import {
  createAudioFileIdentifier,
  createAudioMimeType,
  createStorageKey,
} from "../../../../domain/audio-file";
import { createRecordingAttemptIdentifier } from "../../../../domain/recording-attempt";

const createTestDb = () => {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE recording_attempts (
      identifier TEXT PRIMARY KEY,
      section TEXT NOT NULL,
      status TEXT NOT NULL,
      input_kind TEXT NOT NULL,
      started_at TEXT,
      ended_at TEXT,
      duration_milliseconds INTEGER,
      browser_info_json TEXT,
      original_file_name TEXT,
      failure_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE audio_files (
      identifier TEXT PRIMARY KEY,
      recording_attempt TEXT NOT NULL REFERENCES recording_attempts(identifier),
      storage_key TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 104857600),
      duration_milliseconds INTEGER NOT NULL CHECK(duration_milliseconds BETWEEN 1 AND 600000),
      sample_rate INTEGER,
      channel_count INTEGER,
      sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
      status TEXT NOT NULL,
      physical_deleted_at TEXT,
      delete_failure_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      UNIQUE(recording_attempt),
      UNIQUE(storage_key)
    );
  `);
  return sqlite;
};

describe("DrizzleAudioFileRepository", () => {
  let db: DrizzleDatabase;
  let sqlite: ReturnType<typeof Database>;

  beforeEach(() => {
    sqlite = createTestDb();
    db = drizzle(sqlite, { schema }) as DrizzleDatabase;

    const now = new Date().toISOString();
    sqlite.prepare(
      `INSERT INTO recording_attempts (identifier, section, status, input_kind, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("REC001", "SEC001", "ready", "browser_recording", now, now);
  });

  afterEach(() => {
    sqlite.close();
  });

  it("音声ファイルを保存して取得できる", async () => {
    const repository = createDrizzleAudioFileRepository(db);
    const identifier = createAudioFileIdentifier("AF001")!;
    const recordingAttempt = createRecordingAttemptIdentifier("REC001")!;
    const storageKey = createStorageKey("AF001.webm")!;
    const mimeType = createAudioMimeType("audio/webm")!;

    const storedFile = {
      type: "stored" as const,
      identifier,
      recordingAttempt,
      storageKey,
      mimeType,
      sizeBytes: 1024,
      durationMilliseconds: 5000,
      sha256: "a".repeat(64),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await repository.persist(storedFile);
    const found = await repository.find(identifier);
    expect(found.isOk()).toBe(true);
    expect(String(found._unsafeUnwrap().identifier)).toBe("AF001");
    expect(found._unsafeUnwrap().type).toBe("stored");
  });

  it("存在しない音声ファイルは notFound を返す", async () => {
    const repository = createDrizzleAudioFileRepository(db);
    const identifier = createAudioFileIdentifier("NOTEXIST")!;
    const found = await repository.find(identifier);
    expect(found.isErr()).toBe(true);
    expect(found._unsafeUnwrapErr().type).toBe("notFound");
  });

  it("findByRecordingAttempt で録音試行から音声ファイルを取得できる", async () => {
    const repository = createDrizzleAudioFileRepository(db);
    const identifier = createAudioFileIdentifier("AF002")!;
    const recordingAttempt = createRecordingAttemptIdentifier("REC001")!;
    const storageKey = createStorageKey("AF002.webm")!;
    const mimeType = createAudioMimeType("audio/webm")!;

    const storedFile = {
      type: "stored" as const,
      identifier,
      recordingAttempt,
      storageKey,
      mimeType,
      sizeBytes: 2048,
      durationMilliseconds: 10000,
      sha256: "b".repeat(64),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await repository.persist(storedFile);
    const found = await repository.findByRecordingAttempt(recordingAttempt);
    expect(found.isOk()).toBe(true);
    expect(String(found._unsafeUnwrap().storageKey)).toBe("AF002.webm");
  });
});
