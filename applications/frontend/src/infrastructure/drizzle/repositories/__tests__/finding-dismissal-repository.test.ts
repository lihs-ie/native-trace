import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../schema";
import { type DrizzleDatabase } from "../../client";
import { createDrizzleFindingDismissalRepository } from "../finding-dismissal-repository";
import { type AssessmentResultIdentifier } from "../../../../domain/assessment-result";

/**
 * M-108 却下永続化の round-trip 統合テスト（real better-sqlite3、mock 無し）。
 * dismiss(record) → 再取得(findActive...) で dismissed が観測でき、restore で解除される
 * ことを実 DB 永続化境界で assert する（ORPHAN-3 / 二段門① の観測可能挙動）。
 */
describe("FindingDismissalRepository (real sqlite round-trip)", () => {
  let db: DrizzleDatabase;

  beforeEach(() => {
    const sqlite = new Database(":memory:");
    // finding_dismissals は assessment_results を FK 参照するため両方作る。
    sqlite.exec(`
      CREATE TABLE assessment_results (
        identifier TEXT PRIMARY KEY,
        analysis_job TEXT NOT NULL,
        overall_score INTEGER NOT NULL DEFAULT 0,
        accuracy_score INTEGER NOT NULL DEFAULT 0,
        native_likeness_score INTEGER NOT NULL DEFAULT 0,
        pronunciation_score INTEGER NOT NULL DEFAULT 0,
        connected_speech_score INTEGER NOT NULL DEFAULT 0,
        prosody_score INTEGER NOT NULL DEFAULT 0,
        assessment_result_json TEXT NOT NULL DEFAULT '{}',
        raw_response_json TEXT NOT NULL DEFAULT '{}',
        engine_snapshot_json TEXT NOT NULL DEFAULT '{}',
        tokenizer_version TEXT NOT NULL DEFAULT 'v1',
        created_at TEXT NOT NULL DEFAULT '2026-06-12T00:00:00Z',
        deleted_at TEXT
      );
      CREATE TABLE finding_dismissals (
        identifier TEXT PRIMARY KEY,
        assessment_result TEXT NOT NULL REFERENCES assessment_results(identifier),
        finding_identifier TEXT NOT NULL,
        dismissed_at INTEGER NOT NULL,
        reason TEXT,
        undone_at INTEGER,
        CHECK (dismissed_at > 0),
        CHECK (undone_at IS NULL OR undone_at > dismissed_at)
      );
      INSERT INTO assessment_results (identifier, analysis_job) VALUES ('AR001', 'JOB001');
    `);
    db = drizzle(sqlite, { schema }) as DrizzleDatabase;
  });

  const resultId = "AR001" as AssessmentResultIdentifier;

  it("却下を記録すると再取得で dismissed として観測できる（ORPHAN-3 の核）", async () => {
    const repository = createDrizzleFindingDismissalRepository(db);

    // 却下前: 空
    const before = await repository.findActiveDismissedIdentifiers(resultId);
    expect(before.isOk()).toBe(true);
    expect(before._unsafeUnwrap().has("FIND001")).toBe(false);

    // 却下を記録
    const recorded = await repository.record({
      identifier: "DISM001",
      assessmentResult: resultId,
      findingIdentifier: "FIND001",
      dismissedAt: 1_781_000_000_000,
      reason: "誤検出として却下",
    });
    expect(recorded.isOk()).toBe(true);

    // 再取得: dismissed として返る
    const after = await repository.findActiveDismissedIdentifiers(resultId);
    expect(after._unsafeUnwrap().has("FIND001")).toBe(true);

    // 複数結果版でも join できる
    const byResults = await repository.findActiveDismissedIdentifiersByResults([resultId]);
    expect(byResults._unsafeUnwrap().get("AR001")?.has("FIND001")).toBe(true);
  });

  it("restore（取消）で却下が解除され dismissed でなくなる", async () => {
    const repository = createDrizzleFindingDismissalRepository(db);

    await repository.record({
      identifier: "DISM002",
      assessmentResult: resultId,
      findingIdentifier: "FIND002",
      dismissedAt: 1_781_000_000_000,
      reason: null,
    });
    expect((await repository.findActiveDismissedIdentifiers(resultId))._unsafeUnwrap().has("FIND002")).toBe(
      true,
    );

    const restored = await repository.restore(resultId, "FIND002", 1_781_000_001_000);
    expect(restored.isOk()).toBe(true);

    // 解除後: active から消える（undone_at が埋まる）
    const after = await repository.findActiveDismissedIdentifiers(resultId);
    expect(after._unsafeUnwrap().has("FIND002")).toBe(false);
  });
});
