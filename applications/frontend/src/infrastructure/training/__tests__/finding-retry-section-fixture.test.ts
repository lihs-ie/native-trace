/**
 * finding-retry-section-fixture — idempotent 動作テスト (M-CRL-5)
 *
 * 仕様: docs/specs/closed-remediation-loop.md M-CRL-5
 * - 同一 findingIdentifier × referenceText での 2 回呼び出しが同じ Section 識別子を返すこと
 * - 決定論的 id 生成（同一入力 → 同一出力）
 * - FINDING_RETRY_MATERIAL_SINGLETON / FINDING_RETRY_SECTION_SERIES_SINGLETON が export される
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../drizzle/schema";
import { type DrizzleDatabase } from "../../drizzle/client";
import {
  ensureFindingRetrySectionExists,
  FINDING_RETRY_MATERIAL_SINGLETON,
  FINDING_RETRY_SECTION_SERIES_SINGLETON,
} from "../finding-retry-section-fixture";

const createTestDb = (): DrizzleDatabase => {
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
      version_number INTEGER NOT NULL CHECK(version_number >= 1),
      body_text TEXT NOT NULL CHECK(length(trim(body_text)) > 0),
      body_text_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      deleted_at TEXT
    );
  `);
  return drizzle(sqlite, { schema }) as unknown as DrizzleDatabase;
};

describe("ensureFindingRetrySectionExists", () => {
  let database: DrizzleDatabase;

  beforeEach(() => {
    database = createTestDb();
  });

  it("存在しない場合に Section 識別子を生成して返す", async () => {
    const identifier = await ensureFindingRetrySectionExists(database, "finding-abc-123", "world");
    expect(typeof identifier).toBe("string");
    expect(identifier.length).toBeGreaterThan(0);
    expect(identifier).toContain("FINDING_RETRY_SECTION_");
  });

  it("同一 findingIdentifier で 2 回呼ぶと同じ識別子を返す（idempotent）", async () => {
    const first = await ensureFindingRetrySectionExists(database, "finding-xyz-456", "that");
    const second = await ensureFindingRetrySectionExists(database, "finding-xyz-456", "that");
    expect(first).toBe(second);
  });

  it("異なる findingIdentifier は異なる Section 識別子を返す", async () => {
    const identifierA = await ensureFindingRetrySectionExists(database, "finding-aaa", "world");
    const identifierB = await ensureFindingRetrySectionExists(database, "finding-bbb", "world");
    expect(identifierA).not.toBe(identifierB);
  });

  it("Material/SectionSeries の 2 重 INSERT は onConflictDoNothing で安全に処理される", async () => {
    // 1 回目で Material + SectionSeries + Section が作成される
    await ensureFindingRetrySectionExists(database, "finding-dup-01", "test");
    // 2 回目は全 INSERT が onConflictDoNothing で安全に処理され例外なし
    await expect(
      ensureFindingRetrySectionExists(database, "finding-dup-01", "test"),
    ).resolves.not.toThrow();
  });

  it("固定識別子定数が期待どおりの値を持つ", () => {
    expect(FINDING_RETRY_MATERIAL_SINGLETON).toBe("FINDING_RETRY_MATERIAL_SINGLETON");
    expect(FINDING_RETRY_SECTION_SERIES_SINGLETON).toBe("FINDING_RETRY_SECTION_SERIES_SINGLETON");
  });

  it("findingIdentifier の '-' が '_' に正規化され大文字化される", async () => {
    const identifier = await ensureFindingRetrySectionExists(database, "finding-test-001", "word");
    expect(identifier).toBe("FINDING_RETRY_SECTION_FINDING_TEST_001");
  });
});
