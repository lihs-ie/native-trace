import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../schema";
import { type DrizzleDatabase } from "../../client";
import { createDrizzleSectionSeriesRepository } from "../section-series-repository";
import {
  createSectionSeriesIdentifier,
  createSectionTitle,
  createSectionDisplayOrder,
  createSectionSeriesAggregate,
} from "../../../../domain/section-series";
import { createMaterialIdentifier } from "../../../../domain/material";

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
      title TEXT NOT NULL CHECK(length(trim(title)) > 0),
      display_order INTEGER NOT NULL CHECK(display_order >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
  `);
  return sqlite;
};

describe("DrizzleSectionSeriesRepository", () => {
  let db: DrizzleDatabase;
  let sqlite: ReturnType<typeof Database>;

  beforeEach(() => {
    sqlite = createTestDb();
    db = drizzle(sqlite, { schema }) as DrizzleDatabase;

    // 親テーブルに材料を挿入
    sqlite.prepare(`
      INSERT INTO materials (identifier, title, source_json, created_at, updated_at, deleted_at)
      VALUES (?, ?, NULL, ?, ?, NULL)
    `).run("MAT001", "テスト教材", new Date().toISOString(), new Date().toISOString());
  });

  afterEach(() => {
    sqlite.close();
  });

  it("セクションシリーズを保存して取得できる", async () => {
    const repository = createDrizzleSectionSeriesRepository(db);
    const identifier = createSectionSeriesIdentifier("SS001")!;
    const material = createMaterialIdentifier("MAT001")!;
    const title = createSectionTitle("シリーズ1")._unsafeUnwrap();
    const displayOrder = createSectionDisplayOrder(0)._unsafeUnwrap();
    const { sectionSeries } = createSectionSeriesAggregate({
      identifier,
      material,
      title,
      displayOrder,
      now: new Date(),
    });

    await repository.persist(sectionSeries);
    const found = await repository.find(identifier);
    expect(found.isOk()).toBe(true);
    expect(String(found._unsafeUnwrap().identifier)).toBe("SS001");
  });

  it("存在しないシリーズは notFound を返す", async () => {
    const repository = createDrizzleSectionSeriesRepository(db);
    const identifier = createSectionSeriesIdentifier("NOTEXIST")!;
    const found = await repository.find(identifier);
    expect(found.isErr()).toBe(true);
    expect(found._unsafeUnwrapErr().type).toBe("notFound");
  });

  it("search で教材に紐づくシリーズを取得できる", async () => {
    const repository = createDrizzleSectionSeriesRepository(db);
    const material = createMaterialIdentifier("MAT001")!;

    for (let i = 0; i < 2; i++) {
      const identifier = createSectionSeriesIdentifier(`SS00${i + 1}`)!;
      const title = createSectionTitle(`シリーズ${i + 1}`)._unsafeUnwrap();
      const displayOrder = createSectionDisplayOrder(i)._unsafeUnwrap();
      const { sectionSeries } = createSectionSeriesAggregate({
        identifier,
        material,
        title,
        displayOrder,
        now: new Date(),
      });
      await repository.persist(sectionSeries);
    }

    const result = await repository.search({
      type: "activeSeriesInMaterial",
      material,
      pagination: { type: "offset", offset: 0 as never, limit: 20 as never },
      sort: "displayOrder_asc",
    });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().items.length).toBe(2);
  });
});
