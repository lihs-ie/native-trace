import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../schema";
import { type DrizzleDatabase } from "../../client";
import { createDrizzleMaterialDetailStatsRepository } from "../material-detail-stats-repository";

/**
 * MaterialDetailStatsRepository 特性テスト（characterization test）。
 *
 * 目的: `findStatsBySectionSeries` の現在の挙動を固定する（真値の検証ではない）。
 * 期待値は実装（material-detail-stats-repository.ts）を読んで導出した現状の出力をそのまま書く。
 * W25 で 5 段結合の共通化リファクタを行う前の safety net。
 *
 * findStatsBySectionSeries は materials / section_series テーブルを参照しない
 * （sectionSeriesIdentifiers を文字列としてそのまま受け取る）ため、
 * このテスト DB では sections 以下のテーブルのみを用意する。
 */

type SqliteDb = ReturnType<typeof Database>;

const createTestDb = (): SqliteDb => {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE sections (
      identifier TEXT PRIMARY KEY,
      section_series TEXT NOT NULL,
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

const insertSection = (sqlite: SqliteDb, id: string, sectionSeries: string, now: string) => {
  sqlite
    .prepare(
      `INSERT INTO sections (identifier, section_series, version_number, body_text, body_text_hash, created_at)
       VALUES (?, ?, 1, 'body text', 'hash', ?)`,
    )
    .run(id, sectionSeries, now);
};

const insertRecordingAttempt = (sqlite: SqliteDb, id: string, section: string, createdAt: string) => {
  sqlite
    .prepare(
      `INSERT INTO recording_attempts (identifier, section, status, input_kind, original_file_name, duration_milliseconds, created_at, updated_at)
       VALUES (?, ?, 'ready', 'uploaded_file', 'test.wav', 3000, ?, ?)`,
    )
    .run(id, section, createdAt, createdAt);
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

describe("DrizzleMaterialDetailStatsRepository (findStatsBySectionSeries, characterization)", () => {
  let sqlite: SqliteDb;

  afterEach(() => {
    sqlite.close();
  });

  it("series 2件で片方のみ結果あり → series単位でベスト/履歴が分離され、wordCount は連続空白を圧縮した値になる", async () => {
    sqlite = createTestDb();
    const db = drizzle(sqlite, { schema }) as DrizzleDatabase;
    const repository = createDrizzleMaterialDetailStatsRepository(db);

    // SS-101: 結果あり（2 attempt）
    insertSection(sqlite, "SEC-101", "SS-101", "2026-01-01T00:00:00.000Z");
    insertRecordingAttempt(sqlite, "RA-101A", "SEC-101", "2026-01-01T00:00:00.000Z");
    insertAnalysisRun(sqlite, "AR-101A", "RA-101A", "2026-01-01T00:10:00.000Z");
    insertAnalysisJob(sqlite, "AJ-101A", "AR-101A", "2026-01-01T00:10:00.000Z");
    insertAssessmentResult(sqlite, "ARES-101A", "AJ-101A", 55, "2026-01-01T00:20:00.000Z");

    insertRecordingAttempt(sqlite, "RA-101B", "SEC-101", "2026-01-02T00:00:00.000Z");
    insertAnalysisRun(sqlite, "AR-101B", "RA-101B", "2026-01-02T00:10:00.000Z");
    insertAnalysisJob(sqlite, "AJ-101B", "AR-101B", "2026-01-02T00:10:00.000Z");
    insertAssessmentResult(sqlite, "ARES-101B", "AJ-101B", 90, "2026-01-02T00:20:00.000Z");

    // SS-102: 結果なし（section のみ）
    insertSection(sqlite, "SEC-102", "SS-102", "2026-01-01T00:00:00.000Z");

    const latestBodyTextBySeries = new Map<string, string>([
      ["SS-101", "Hello  world"], // 空白2連 → countWords は \s+ split で圧縮
      ["SS-102", "one  two   three"], // 空白2連・3連混在
    ]);

    const result = await repository.findStatsBySectionSeries(
      ["SS-101", "SS-102"],
      latestBodyTextBySeries,
    );
    expect(result.isOk()).toBe(true);
    const statsMap = result._unsafeUnwrap();

    const ss101 = statsMap.get("SS-101");
    expect(ss101).toBeDefined();
    expect(ss101!.sectionSeriesIdentifier).toBe("SS-101");
    expect(ss101!.wordCount).toBe(2);
    expect(ss101!.recordingAttemptCount).toBe(2);
    expect(ss101!.bestOverallScore).toBe(90);
    expect(ss101!.overallScoreHistory).toEqual([55, 90]);

    const ss102 = statsMap.get("SS-102");
    expect(ss102).toBeDefined();
    expect(ss102!.sectionSeriesIdentifier).toBe("SS-102");
    expect(ss102!.wordCount).toBe(3);
    expect(ss102!.recordingAttemptCount).toBe(0);
    expect(ss102!.bestOverallScore).toBeNull();
    expect(ss102!.overallScoreHistory).toEqual([]);
  });
});
