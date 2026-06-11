import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../schema";
import { type DrizzleDatabase } from "../../client";
import { createDrizzleRecordingAttemptRepository } from "../recording-attempt-repository";
import {
  createRecordingAttemptIdentifier,
  startRecordingAttempt,
} from "../../../../domain/recording-attempt";
import { createSectionIdentifier } from "../../../../domain/section";

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
  `);
  return sqlite;
};

describe("DrizzleRecordingAttemptRepository", () => {
  let db: DrizzleDatabase;
  let sqlite: ReturnType<typeof Database>;

  beforeEach(() => {
    sqlite = createTestDb();
    db = drizzle(sqlite, { schema }) as DrizzleDatabase;
  });

  afterEach(() => {
    sqlite.close();
  });

  it("saving 状態の録音試行を保存して findSaving で取得できる", async () => {
    const repository = createDrizzleRecordingAttemptRepository(db);
    const identifier = createRecordingAttemptIdentifier("REC001")!;
    const section = createSectionIdentifier("SEC001")!;
    const { recordingAttempt } = startRecordingAttempt({
      identifier,
      section,
      inputKind: "browser_recording",
      now: new Date(),
    });

    await repository.persist(recordingAttempt);
    const found = await repository.findSaving(identifier);
    expect(found.isOk()).toBe(true);
    expect(String(found._unsafeUnwrap().identifier)).toBe("REC001");
    expect(found._unsafeUnwrap().type).toBe("saving");
  });

  it("saving 状態のものを find (ready 検索) すると notFound を返す", async () => {
    const repository = createDrizzleRecordingAttemptRepository(db);
    const identifier = createRecordingAttemptIdentifier("REC002")!;
    const section = createSectionIdentifier("SEC001")!;
    const { recordingAttempt } = startRecordingAttempt({
      identifier,
      section,
      inputKind: "browser_recording",
      now: new Date(),
    });

    await repository.persist(recordingAttempt);
    const found = await repository.find(identifier);
    expect(found.isErr()).toBe(true);
    expect(found._unsafeUnwrapErr().type).toBe("notFound");
  });

  it("存在しない録音試行は notFound を返す", async () => {
    const repository = createDrizzleRecordingAttemptRepository(db);
    const identifier = createRecordingAttemptIdentifier("NOTEXIST")!;
    const found = await repository.findSaving(identifier);
    expect(found.isErr()).toBe(true);
    expect(found._unsafeUnwrapErr().type).toBe("notFound");
  });
});
