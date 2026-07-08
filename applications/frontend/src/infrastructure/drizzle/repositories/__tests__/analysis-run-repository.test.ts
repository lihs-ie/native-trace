import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../schema";
import { type DrizzleDatabase } from "../../client";
import { createDrizzleAnalysisRunRepository } from "../analysis-run-repository";
import { createAnalysisRunIdentifier, createAnalysisRun } from "../../../../domain/analysis-run";
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
    CREATE TABLE analysis_runs (
      identifier TEXT PRIMARY KEY,
      recording_attempt TEXT NOT NULL REFERENCES recording_attempts(identifier),
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      canceled_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
  `);
  return sqlite;
};

describe("DrizzleAnalysisRunRepository", () => {
  let db: DrizzleDatabase;
  let sqlite: ReturnType<typeof Database>;

  beforeEach(() => {
    sqlite = createTestDb();
    db = drizzle(sqlite, { schema }) as DrizzleDatabase;

    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO recording_attempts (identifier, section, status, input_kind, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("REC001", "SEC001", "ready", "browser_recording", now, now);
  });

  afterEach(() => {
    sqlite.close();
  });

  it("分析ランを保存して取得できる", async () => {
    const repository = createDrizzleAnalysisRunRepository(db);
    const identifier = createAnalysisRunIdentifier("RUN001")!;
    const recordingAttempt = createRecordingAttemptIdentifier("REC001")!;
    const { analysisRun } = createAnalysisRun({
      identifier,
      recordingAttempt,
      mode: "cloud_only",
      now: new Date(),
    });

    await repository.persist(analysisRun);
    const found = await repository.find(identifier);
    expect(found.isOk()).toBe(true);
    expect(String(found._unsafeUnwrap().identifier)).toBe("RUN001");
  });

  it("存在しない分析ランは notFound を返す", async () => {
    const repository = createDrizzleAnalysisRunRepository(db);
    const identifier = createAnalysisRunIdentifier("NOTEXIST")!;
    const found = await repository.find(identifier);
    expect(found.isErr()).toBe(true);
    expect(found._unsafeUnwrapErr().type).toBe("notFound");
  });

  it("updateStatus でステータスを更新できる", async () => {
    const repository = createDrizzleAnalysisRunRepository(db);
    const identifier = createAnalysisRunIdentifier("RUN002")!;
    const recordingAttempt = createRecordingAttemptIdentifier("REC001")!;
    const { analysisRun } = createAnalysisRun({
      identifier,
      recordingAttempt,
      mode: "cloud_only",
      now: new Date(),
    });

    await repository.persist(analysisRun);
    const updateResult = await repository.updateStatus(identifier, "succeeded");
    expect(updateResult.isOk()).toBe(true);

    // DB 行のステータスが更新されていることを直接確認
    const row = sqlite
      .prepare("SELECT status FROM analysis_runs WHERE identifier = ?")
      .get("RUN002") as { status: string };
    expect(row.status).toBe("succeeded");
  });
});
