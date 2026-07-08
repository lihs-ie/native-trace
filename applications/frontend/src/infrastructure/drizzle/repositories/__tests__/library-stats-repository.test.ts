import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../schema";
import { type DrizzleDatabase } from "../../client";
import { createDrizzleLibraryStatsRepository } from "../library-stats-repository";

/**
 * LibraryStatsRepository 特性テスト（characterization test）。
 *
 * 目的: `findStatsByMaterials` の現在の挙動を固定する（真値の検証ではない）。
 * 期待値は実装（library-stats-repository.ts）を読んで導出した現状の出力をそのまま書く。
 * W25 で 5 段結合の共通化リファクタを行う前の safety net。
 */

type SqliteDb = ReturnType<typeof Database>;

const createTestDb = (): SqliteDb => {
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
    CREATE TABLE section_series (
      identifier TEXT PRIMARY KEY,
      material TEXT NOT NULL REFERENCES materials(identifier),
      title TEXT NOT NULL,
      display_order INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE sections (
      identifier TEXT PRIMARY KEY,
      section_series TEXT NOT NULL REFERENCES section_series(identifier),
      version_number INTEGER NOT NULL,
      body_text TEXT NOT NULL,
      body_text_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE recording_attempts (
      identifier TEXT PRIMARY KEY,
      section TEXT NOT NULL REFERENCES sections(identifier),
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
    CREATE TABLE assessment_results (
      identifier TEXT PRIMARY KEY,
      analysis_job TEXT NOT NULL REFERENCES analysis_jobs(identifier),
      overall_score INTEGER NOT NULL,
      accuracy_score INTEGER NOT NULL,
      native_likeness_score INTEGER NOT NULL,
      pronunciation_score INTEGER NOT NULL,
      connected_speech_score INTEGER NOT NULL,
      prosody_score INTEGER NOT NULL,
      assessment_result_json TEXT NOT NULL,
      raw_response_json TEXT NOT NULL,
      engine_snapshot_json TEXT NOT NULL,
      tokenizer_version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      deleted_at TEXT,
      UNIQUE(analysis_job)
    );
  `);
  return sqlite;
};

// ---- Insert helpers ----

const insertMaterial = (sqlite: SqliteDb, id: string, now: string) => {
  sqlite
    .prepare(
      `INSERT INTO materials (identifier, title, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    )
    .run(id, `Material ${id}`, now, now);
};

const insertSectionSeries = (sqlite: SqliteDb, id: string, material: string, now: string) => {
  sqlite
    .prepare(
      `INSERT INTO section_series (identifier, material, title, display_order, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?)`,
    )
    .run(id, material, `Series ${id}`, now, now);
};

const insertSection = (sqlite: SqliteDb, id: string, sectionSeries: string, now: string) => {
  sqlite
    .prepare(
      `INSERT INTO sections (identifier, section_series, version_number, body_text, body_text_hash, created_at)
       VALUES (?, ?, 1, 'body text', 'hash', ?)`,
    )
    .run(id, sectionSeries, now);
};

const insertRecordingAttempt = (
  sqlite: SqliteDb,
  id: string,
  section: string,
  createdAt: string,
  options: { deletedAt?: string } = {},
) => {
  sqlite
    .prepare(
      `INSERT INTO recording_attempts (identifier, section, status, input_kind, original_file_name, duration_milliseconds, created_at, updated_at, deleted_at)
       VALUES (?, ?, 'ready', 'uploaded_file', 'test.wav', 3000, ?, ?, ?)`,
    )
    .run(id, section, createdAt, createdAt, options.deletedAt ?? null);
};

const insertAnalysisRun = (sqlite: SqliteDb, id: string, recordingAttempt: string, now: string) => {
  sqlite
    .prepare(
      `INSERT INTO analysis_runs (identifier, recording_attempt, mode, status, created_at, updated_at)
       VALUES (?, ?, 'oss_worker_only', 'succeeded', ?, ?)`,
    )
    .run(id, recordingAttempt, now, now);
};

const insertAnalysisJob = (sqlite: SqliteDb, id: string, analysisRun: string, now: string) => {
  sqlite
    .prepare(
      `INSERT INTO analysis_jobs (identifier, analysis_run, engine, engine_config_json, status, next_run_at, queued_at, created_at, updated_at)
       VALUES (?, ?, 'oss_worker', '{}', 'succeeded', ?, ?, ?, ?)`,
    )
    .run(id, analysisRun, now, now, now, now);
};

const insertAssessmentResult = (
  sqlite: SqliteDb,
  id: string,
  analysisJob: string,
  overallScore: number,
  createdAt: string,
) => {
  sqlite
    .prepare(
      `INSERT INTO assessment_results (identifier, analysis_job, overall_score, accuracy_score, native_likeness_score, pronunciation_score, connected_speech_score, prosody_score, assessment_result_json, raw_response_json, engine_snapshot_json, tokenizer_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', '{}', '{}', 'v1', ?)`,
    )
    .run(
      id,
      analysisJob,
      overallScore,
      overallScore,
      overallScore,
      overallScore,
      overallScore,
      overallScore,
      createdAt,
    );
};

describe("DrizzleLibraryStatsRepository (findStatsByMaterials, characterization)", () => {
  let sqlite: SqliteDb;

  afterEach(() => {
    sqlite.close();
  });

  it("録音2件・採点2件の教材は best=80 / attempt数=2 / lastPracticedAt=新しい方の録音時刻を返す", async () => {
    sqlite = createTestDb();
    const db = drizzle(sqlite, { schema }) as DrizzleDatabase;
    const repository = createDrizzleLibraryStatsRepository(db);

    insertMaterial(sqlite, "MAT-001", "2026-01-01T00:00:00.000Z");
    insertSectionSeries(sqlite, "SS-001", "MAT-001", "2026-01-01T00:00:00.000Z");
    insertSection(sqlite, "SEC-001", "SS-001", "2026-01-01T00:00:00.000Z");

    insertRecordingAttempt(sqlite, "RA-001", "SEC-001", "2026-01-01T00:00:00.000Z");
    insertAnalysisRun(sqlite, "AR-001", "RA-001", "2026-01-01T00:10:00.000Z");
    insertAnalysisJob(sqlite, "AJ-001", "AR-001", "2026-01-01T00:10:00.000Z");
    insertAssessmentResult(sqlite, "ARES-001", "AJ-001", 60, "2026-01-01T00:20:00.000Z");

    insertRecordingAttempt(sqlite, "RA-002", "SEC-001", "2026-01-02T00:00:00.000Z");
    insertAnalysisRun(sqlite, "AR-002", "RA-002", "2026-01-02T00:10:00.000Z");
    insertAnalysisJob(sqlite, "AJ-002", "AR-002", "2026-01-02T00:10:00.000Z");
    insertAssessmentResult(sqlite, "ARES-002", "AJ-002", 80, "2026-01-02T00:20:00.000Z");

    const result = await repository.findStatsByMaterials(["MAT-001"]);
    expect(result.isOk()).toBe(true);
    const stats = result._unsafeUnwrap().get("MAT-001");
    expect(stats).toBeDefined();
    expect(stats!.sectionSeriesCount).toBe(1);
    expect(stats!.recordingAttemptCount).toBe(2);
    expect(stats!.bestOverallScore).toBe(80);
    expect(stats!.overallScoreHistory).toEqual([60, 80]);
    expect(stats!.lastPracticedAt).toEqual(new Date("2026-01-02T00:00:00.000Z"));
  });

  it("result が1件も無い教材は bestOverallScore=null / history=[] / lastPracticedAt=null を返す", async () => {
    sqlite = createTestDb();
    const db = drizzle(sqlite, { schema }) as DrizzleDatabase;
    const repository = createDrizzleLibraryStatsRepository(db);

    insertMaterial(sqlite, "MAT-002", "2026-01-01T00:00:00.000Z");
    insertSectionSeries(sqlite, "SS-002", "MAT-002", "2026-01-01T00:00:00.000Z");
    insertSection(sqlite, "SEC-002", "SS-002", "2026-01-01T00:00:00.000Z");
    // 録音・採点なし

    const result = await repository.findStatsByMaterials(["MAT-002"]);
    expect(result.isOk()).toBe(true);
    const stats = result._unsafeUnwrap().get("MAT-002");
    expect(stats).toBeDefined();
    expect(stats!.sectionSeriesCount).toBe(1);
    expect(stats!.recordingAttemptCount).toBe(0);
    expect(stats!.bestOverallScore).toBeNull();
    expect(stats!.overallScoreHistory).toEqual([]);
    expect(stats!.lastPracticedAt).toBeNull();
  });

  it("deletedAt が立った recording_attempt は attempt数・best・history・lastPracticedAt の集計から除外される", async () => {
    sqlite = createTestDb();
    const db = drizzle(sqlite, { schema }) as DrizzleDatabase;
    const repository = createDrizzleLibraryStatsRepository(db);

    insertMaterial(sqlite, "MAT-003", "2026-01-01T00:00:00.000Z");
    insertSectionSeries(sqlite, "SS-003", "MAT-003", "2026-01-01T00:00:00.000Z");
    insertSection(sqlite, "SEC-003", "SS-003", "2026-01-01T00:00:00.000Z");

    // 生きている録音: score 70
    insertRecordingAttempt(sqlite, "RA-003", "SEC-003", "2026-01-03T00:00:00.000Z");
    insertAnalysisRun(sqlite, "AR-003", "RA-003", "2026-01-03T00:10:00.000Z");
    insertAnalysisJob(sqlite, "AJ-003", "AR-003", "2026-01-03T00:10:00.000Z");
    insertAssessmentResult(sqlite, "ARES-003", "AJ-003", 70, "2026-01-03T00:20:00.000Z");

    // soft-delete 済みの録音（status='ready' のまま deleted_at が立つ）: score 95・より新しい createdAt
    insertRecordingAttempt(sqlite, "RA-004", "SEC-003", "2026-01-04T00:00:00.000Z", {
      deletedAt: "2026-01-04T12:00:00.000Z",
    });
    insertAnalysisRun(sqlite, "AR-004", "RA-004", "2026-01-04T00:10:00.000Z");
    insertAnalysisJob(sqlite, "AJ-004", "AR-004", "2026-01-04T00:10:00.000Z");
    insertAssessmentResult(sqlite, "ARES-004", "AJ-004", 95, "2026-01-04T00:20:00.000Z");

    const result = await repository.findStatsByMaterials(["MAT-003"]);
    expect(result.isOk()).toBe(true);
    const stats = result._unsafeUnwrap().get("MAT-003");
    expect(stats).toBeDefined();
    // deleted な RA-004 は除外され、RA-003 のみが残る（現行実装は deletedAt を除外している）
    expect(stats!.recordingAttemptCount).toBe(1);
    expect(stats!.bestOverallScore).toBe(70);
    expect(stats!.overallScoreHistory).toEqual([70]);
    expect(stats!.lastPracticedAt).toEqual(new Date("2026-01-03T00:00:00.000Z"));
  });
});
