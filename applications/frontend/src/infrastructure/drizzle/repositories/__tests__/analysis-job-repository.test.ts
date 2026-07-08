import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../schema";
import { type DrizzleDatabase } from "../../client";
import { createDrizzleAnalysisJobRepository } from "../analysis-job-repository";
import { createAnalysisJobIdentifier, createAnalysisJob } from "../../../../domain/analysis-job";
import { createAnalysisRunIdentifier } from "../../../../domain/analysis-run";

const createTestDb = () => {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE materials (
      identifier TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      source_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
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
    CREATE TABLE analysis_jobs (
      identifier TEXT PRIMARY KEY,
      analysis_run TEXT NOT NULL REFERENCES analysis_runs(identifier),
      engine TEXT NOT NULL,
      engine_config_json TEXT NOT NULL,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      next_run_at TEXT NOT NULL,
      lease_owner TEXT,
      lease_token TEXT,
      leased_until TEXT,
      queued_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      canceled_at TEXT,
      last_error_code TEXT,
      last_error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      UNIQUE(analysis_run, engine)
    );
  `);
  return sqlite;
};

describe("DrizzleAnalysisJobRepository", () => {
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

    sqlite
      .prepare(
        `INSERT INTO analysis_runs (identifier, recording_attempt, mode, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("RUN001", "REC001", "cloud_only", "queued", now, now);
  });

  afterEach(() => {
    sqlite.close();
  });

  it("分析ジョブを保存して取得できる", async () => {
    const repository = createDrizzleAnalysisJobRepository(db);
    const identifier = createAnalysisJobIdentifier("JOB001")!;
    const analysisRun = createAnalysisRunIdentifier("RUN001")!;
    const { analysisJob } = createAnalysisJob({
      identifier,
      analysisRun,
      engine: "cloud",
      engineConfigJson: "{}",
      now: new Date(),
    });

    await repository.persist(analysisJob);
    const found = await repository.find(identifier);
    expect(found.isOk()).toBe(true);
    expect(String(found._unsafeUnwrap().identifier)).toBe("JOB001");
    expect(found._unsafeUnwrap().type).toBe("queued");
  });

  it("存在しないジョブは notFound を返す", async () => {
    const repository = createDrizzleAnalysisJobRepository(db);
    const identifier = createAnalysisJobIdentifier("NOTEXIST")!;
    const found = await repository.find(identifier);
    expect(found.isErr()).toBe(true);
    expect(found._unsafeUnwrapErr().type).toBe("notFound");
  });

  it("acquireLease でキューのジョブをリースできる", async () => {
    const repository = createDrizzleAnalysisJobRepository(db);
    const identifier = createAnalysisJobIdentifier("JOB002")!;
    const analysisRun = createAnalysisRunIdentifier("RUN001")!;
    const now = new Date();
    const { analysisJob } = createAnalysisJob({
      identifier,
      analysisRun,
      engine: "oss_worker",
      engineConfigJson: "{}",
      now,
    });

    await repository.persist(analysisJob);

    const leased = await repository.acquireLease("worker-1", 30000, now);
    expect(leased.isOk()).toBe(true);
    const leasedJob = leased._unsafeUnwrap();
    expect(leasedJob).not.toBeNull();
    expect(leasedJob?.type).toBe("leased");
    expect(leasedJob?.leaseOwner).toBe("worker-1");
  });

  it("acquireLease でジョブがない場合は null を返す", async () => {
    const repository = createDrizzleAnalysisJobRepository(db);
    const result = await repository.acquireLease("worker-1", 30000, new Date());
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeNull();
  });
});
