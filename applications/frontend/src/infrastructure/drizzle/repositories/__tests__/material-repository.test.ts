import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../schema";
import { type DrizzleDatabase } from "../../client";
import { createDrizzleMaterialRepository } from "../material-repository";
import {
  createMaterialIdentifier,
  createMaterialTitle,
  createMaterial,
} from "../../../../domain/material";

describe("DrizzleMaterialRepository", () => {
  let db: DrizzleDatabase;
  let sqlite: ReturnType<typeof Database>;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE materials (
        identifier TEXT PRIMARY KEY,
        title TEXT NOT NULL CHECK(length(trim(title)) > 0),
        source_json TEXT CHECK(source_json IS NULL OR json_valid(source_json)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
    `);
    db = drizzle(sqlite, { schema }) as DrizzleDatabase;
  });

  afterEach(() => {
    sqlite.close();
  });

  it("教材を保存して取得できる", async () => {
    const repository = createDrizzleMaterialRepository(db);
    const identifier = createMaterialIdentifier("01JZTEST00000000000000001")!;
    const titleResult = createMaterialTitle("テスト教材");
    expect(titleResult.isOk()).toBe(true);
    const title = titleResult._unsafeUnwrap();

    const { material } = createMaterial({ identifier, title, source: null, now: new Date() });

    const persistResult = await repository.persist(material);
    expect(persistResult.isOk()).toBe(true);

    const found = await repository.find(identifier);
    expect(found.isOk()).toBe(true);
    expect(String(found._unsafeUnwrap().identifier)).toBe(String(identifier));
    expect(String(found._unsafeUnwrap().title)).toBe("テスト教材");
  });

  it("存在しない教材の検索で notFound エラーを返す", async () => {
    const repository = createDrizzleMaterialRepository(db);
    const identifier = createMaterialIdentifier("NOTEXIST000000000000000001")!;
    const found = await repository.find(identifier);
    expect(found.isErr()).toBe(true);
    expect(found._unsafeUnwrapErr().type).toBe("notFound");
  });

  it("削除済み教材は find で notFound を返す", async () => {
    const repository = createDrizzleMaterialRepository(db);
    const identifier = createMaterialIdentifier("01JZTEST00000000000000002")!;
    const titleResult = createMaterialTitle("削除対象");
    const title = titleResult._unsafeUnwrap();

    const { material } = createMaterial({ identifier, title, source: null, now: new Date() });
    await repository.persist(material);

    const deletedMaterial = {
      ...material,
      type: "deleted" as const,
      deletedAt: new Date(),
    };
    await repository.persist(deletedMaterial);

    const found = await repository.find(identifier);
    expect(found.isErr()).toBe(true);
    expect(found._unsafeUnwrapErr().type).toBe("notFound");
  });

  it("search で有効な教材一覧を取得できる", async () => {
    const repository = createDrizzleMaterialRepository(db);

    for (let i = 1; i <= 3; i++) {
      const identifier = createMaterialIdentifier(`01JZTEST0000000000000000${i}`)!;
      const title = createMaterialTitle(`教材${i}`)._unsafeUnwrap();
      const { material } = createMaterial({ identifier, title, source: null, now: new Date() });
      await repository.persist(material);
    }

    const result = await repository.search({
      type: "activeMaterials",
      pagination: { type: "offset", offset: 0 as never, limit: 20 as never },
      sort: "updatedAt_desc",
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().items.length).toBe(3);
    expect(result._unsafeUnwrap().total).toBe(3);
  });
});
