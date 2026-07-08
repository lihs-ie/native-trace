import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../schema";
import { type DrizzleDatabase } from "../../client";
import { createDrizzleAssessmentResultRepository } from "../assessment-result-repository";
import {
  createAssessmentResultIdentifier,
  createAssessmentResult,
  createScore0To100,
  createTokenizerVersion,
  createAssessmentFindingIdentifier,
  type TextRange,
  createConfidence0To1,
} from "../../../../domain/assessment-result";
import { createAnalysisJobIdentifier } from "../../../../domain/analysis-job";

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
      overall_score INTEGER NOT NULL CHECK(overall_score BETWEEN 0 AND 100),
      accuracy_score INTEGER NOT NULL CHECK(accuracy_score BETWEEN 0 AND 100),
      native_likeness_score INTEGER NOT NULL CHECK(native_likeness_score BETWEEN 0 AND 100),
      pronunciation_score INTEGER NOT NULL CHECK(pronunciation_score BETWEEN 0 AND 100),
      connected_speech_score INTEGER NOT NULL CHECK(connected_speech_score BETWEEN 0 AND 100),
      prosody_score INTEGER NOT NULL CHECK(prosody_score BETWEEN 0 AND 100),
      assessment_result_json TEXT NOT NULL CHECK(json_valid(assessment_result_json)),
      raw_response_json TEXT NOT NULL CHECK(json_valid(raw_response_json)),
      engine_snapshot_json TEXT NOT NULL CHECK(json_valid(engine_snapshot_json)),
      tokenizer_version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      deleted_at TEXT,
      UNIQUE(analysis_job)
    );
  `);
  return sqlite;
};

describe("DrizzleAssessmentResultRepository", () => {
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

    sqlite
      .prepare(
        `INSERT INTO analysis_jobs (identifier, analysis_run, engine, engine_config_json, status, next_run_at, queued_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("JOB001", "RUN001", "cloud", "{}", "queued", now, now, now, now);
  });

  afterEach(() => {
    sqlite.close();
  });

  it("採点結果を保存して取得できる", async () => {
    const repository = createDrizzleAssessmentResultRepository(db);
    const identifier = createAssessmentResultIdentifier("AR001")!;
    const analysisJob = createAnalysisJobIdentifier("JOB001")!;
    const tokenizerVersion = createTokenizerVersion("1.0.0")!;
    const findingId = createAssessmentFindingIdentifier("FIND001")!;
    const textRange = { startOffset: 0, endOffset: 5 } as TextRange;
    const confidence = createConfidence0To1(0.9)._unsafeUnwrap();

    const { assessmentResult } = createAssessmentResult({
      identifier,
      analysisJob,
      scores: {
        overall: createScore0To100(80)._unsafeUnwrap(),
        accuracy: createScore0To100(75)._unsafeUnwrap(),
        nativeLikeness: createScore0To100(70)._unsafeUnwrap(),
        pronunciation: createScore0To100(85)._unsafeUnwrap(),
        connectedSpeech: createScore0To100(80)._unsafeUnwrap(),
        prosody: createScore0To100(78)._unsafeUnwrap(),
        intelligibility: createScore0To100(86)._unsafeUnwrap(),
        cefrOverall: { score: 64, band: "B2" },
        cefrSegmental: { score: 58, band: "B1+" },
        cefrProsodic: { score: 46, band: "B1" },
      },
      summary: { overallCommentJa: "良い発音です", overallCommentEn: "Good pronunciation" },
      findings: [
        {
          identifier: findingId,
          phenomenon: "substitution" as const,
          gop: -5.0,
          category: "accuracy",
          severity: "minor",
          textRange,
          audioRange: null,
          expected: { text: "hello", ipa: "/həˈloʊ/" },
          detected: { text: "helo", ipa: null },
          messageJa: "軽微な発音の違いがあります",
          messageEn: "Slight pronunciation difference",
          scoreImpact: -2,
          confidence,
          detectedTopCandidate: "[l]",
          nBest: [{ phoneme: "[l]", confidence: 0.8 }],
          matchesL1Pattern: true,
          functionalLoad: "max",
          catalogId: "l-r-substitution",
          wordPair: null,
          expectedPronunciation: null,
          insertedVowel: null,
          insertionPositionMs: null,
          feedbackLayers: { whatJa: "観測", whyJa: "原因", howJa: "修正" },
          dismissed: false,
          wordPositionLabel: "initial" as const,
          articulatoryEstimate: null,
        },
      ],
      segments: [{ textRange, audioRange: null, transcript: "hello", confidence: 0.9 }],
      metadata: {
        engineName: "openai-whisper",
        engineVersion: "1.0",
        modelName: "gpt-4o",
        promptVersion: "v1",
        schemaVersion: "1.0",
      },
      tokenizerVersion,
      raw: { data: { model: "gpt-4o" } },
      engineSnapshot: {
        type: "cloud",
        identifier: "openai-1",
        displayName: "OpenAI",
        modelName: "gpt-4o",
      },
      now: new Date(),
      perPhonemeGop: [{ word: "hello", phoneme: "h", gop: -3.0, heat: 1 }],
      focusSounds: [
        {
          pair: "/l/·/r/",
          phenomenon: "substitution",
          functionalLoad: "max",
          occurrences: 3,
          priority: "now",
          reasonJa: "弾き音への合流",
          catalogId: "l-r-substitution",
        },
      ],
      prosody: {
        f0Contour: { timesMs: [0, 10], valuesHz: [120, 130] },
        referenceF0Contour: { timesMs: [0, 10], valuesHz: [118, 126] },
        wordStress: [{ word: "hello", wordIndex: 0, expectedStress: 1, predictedStress: 0 }],
        rhythmNpvi: 40,
        referenceNpvi: 65,
        weakFormRate: 0.5,
      },
      engineSummaryMessageJa: "高FLの /l/-/r/ 置換が今回の最優先です。",
    });

    await repository.persist(assessmentResult);
    const found = await repository.find(identifier);
    expect(found.isOk()).toBe(true);
    expect(String(found._unsafeUnwrap().identifier)).toBe("AR001");
    expect(found._unsafeUnwrap().scores.overall).toBe(80);
    // v2: 二段階スコア・finding 詳細・全音素 GOP が round-trip すること（M-107c/M-111 回帰防止）
    expect(found._unsafeUnwrap().scores.intelligibility).toBe(86);
    expect(found._unsafeUnwrap().scores.cefrOverall?.band).toBe("B2");
    expect(found._unsafeUnwrap().findings[0].matchesL1Pattern).toBe(true);
    expect(found._unsafeUnwrap().findings[0].feedbackLayers?.whatJa).toBe("観測");
    expect(found._unsafeUnwrap().perPhonemeGop?.length).toBe(1);
    expect(found._unsafeUnwrap().engineSummaryMessageJa).toContain("最優先");
    // M-104R-b: wordPositionLabel が round-trip すること
    expect(found._unsafeUnwrap().findings[0].wordPositionLabel).toBe("initial");
  });

  it("存在しない採点結果は notFound を返す", async () => {
    const repository = createDrizzleAssessmentResultRepository(db);
    const identifier = createAssessmentResultIdentifier("NOTEXIST")!;
    const found = await repository.find(identifier);
    expect(found.isErr()).toBe(true);
    expect(found._unsafeUnwrapErr().type).toBe("notFound");
  });
});
