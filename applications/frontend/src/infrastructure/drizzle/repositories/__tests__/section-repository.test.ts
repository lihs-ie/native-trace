import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../schema";
import { type DrizzleDatabase } from "../../client";
import { createDrizzleSectionRepository } from "../section-repository";
import {
  createSectionIdentifier,
  createSectionVersion,
  createSectionBodyText,
  createSection,
} from "../../../../domain/section";
import { createSectionSeriesIdentifier } from "../../../../domain/section-series";

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
      deleted_at TEXT,
      UNIQUE(section_series, version_number)
    );
  `);
  return sqlite;
};

describe("DrizzleSectionRepository", () => {
  let db: DrizzleDatabase;
  let sqlite: ReturnType<typeof Database>;

  beforeEach(() => {
    sqlite = createTestDb();
    db = drizzle(sqlite, { schema }) as DrizzleDatabase;

    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO materials (identifier, title, source_json, created_at, updated_at, deleted_at)
       VALUES (?, ?, NULL, ?, ?, NULL)`,
      )
      .run("MAT001", "テスト教材", now, now);

    sqlite
      .prepare(
        `INSERT INTO section_series (identifier, material, title, display_order, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run("SS001", "MAT001", "シリーズ1", 0, now, now);
  });

  afterEach(() => {
    sqlite.close();
  });

  it("セクションを保存して取得できる", async () => {
    const repository = createDrizzleSectionRepository(db);
    const identifier = createSectionIdentifier("SEC001")!;
    const sectionSeries = createSectionSeriesIdentifier("SS001")!;
    const version = createSectionVersion(1)._unsafeUnwrap();
    const bodyText = createSectionBodyText(
      "Hello, this is an English test section for pronunciation practice.",
    )._unsafeUnwrap();

    const { section } = createSection({
      identifier,
      sectionSeries,
      version,
      bodyText,
      now: new Date(),
    });
    await repository.persist(section);

    const found = await repository.find(identifier);
    expect(found.isOk()).toBe(true);
    expect(String(found._unsafeUnwrap().identifier)).toBe("SEC001");
  });

  it("存在しないセクションは notFound を返す", async () => {
    const repository = createDrizzleSectionRepository(db);
    const identifier = createSectionIdentifier("NOTEXIST")!;
    const found = await repository.find(identifier);
    expect(found.isErr()).toBe(true);
    expect(found._unsafeUnwrapErr().type).toBe("notFound");
  });

  it("findLatestInSeries でシリーズの最新セクションを取得できる", async () => {
    const repository = createDrizzleSectionRepository(db);
    const sectionSeries = createSectionSeriesIdentifier("SS001")!;
    const bodyText = createSectionBodyText(
      "This is an English sentence for pronunciation test.",
    )._unsafeUnwrap();

    for (let v = 1; v <= 3; v++) {
      const identifier = createSectionIdentifier(`SEC00${v}`)!;
      const version = createSectionVersion(v)._unsafeUnwrap();
      const { section } = createSection({
        identifier,
        sectionSeries,
        version,
        bodyText,
        now: new Date(),
      });
      await repository.persist(section);
    }

    const found = await repository.findLatestInSeries(sectionSeries);
    expect(found.isOk()).toBe(true);
    expect(found._unsafeUnwrap().version).toBe(3);
  });

  it("findLatestVersionNumber で最大版番号を返す", async () => {
    const repository = createDrizzleSectionRepository(db);
    const sectionSeries = createSectionSeriesIdentifier("SS001")!;

    const bodyText = createSectionBodyText(
      "Another English sentence for testing purposes here.",
    )._unsafeUnwrap();

    for (let v = 1; v <= 2; v++) {
      const identifier = createSectionIdentifier(`SEC0V${v}`)!;
      const version = createSectionVersion(v)._unsafeUnwrap();
      const { section } = createSection({
        identifier,
        sectionSeries,
        version,
        bodyText,
        now: new Date(),
      });
      await repository.persist(section);
    }

    const result = await repository.findLatestVersionNumber(sectionSeries);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(2);
  });
});
