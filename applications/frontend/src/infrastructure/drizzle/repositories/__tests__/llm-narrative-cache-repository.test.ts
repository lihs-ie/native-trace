import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../schema";
import { type DrizzleDatabase } from "../../client";
import { createDrizzleLlmNarrativeCacheRepository } from "../llm-narrative-cache-repository";

/**
 * M-LLM-13 drizzle cache repository — real better-sqlite3 round-trip テスト（mock 無し）。
 * - store → findBySignature で格納値が返る
 * - 存在しない signature → null が返る
 * - 同じ signature に INSERT OR REPLACE でデータが上書きされる
 */
describe("LlmNarrativeCacheRepository (real sqlite round-trip)", () => {
  let db: DrizzleDatabase;

  beforeEach(() => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE llm_narrative_cache (
        signature TEXT PRIMARY KEY NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_version TEXT NOT NULL,
        what_ja TEXT NOT NULL,
        why_ja TEXT NOT NULL,
        how_ja TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    db = drizzle(sqlite, { schema }) as DrizzleDatabase;
  });

  it("store した後 findBySignature で格納した FeedbackLayersOutput が返る", async () => {
    const repository = createDrizzleLlmNarrativeCacheRepository(db);

    const layers = { whatJa: "何が起きているか", whyJa: "なぜ起きるか", howJa: "どう直すか" };
    const metadata = { provider: "claude-code", model: "sonnet", promptVersion: "v1" };

    const stored = await repository.store("sig-001", layers, metadata);
    expect(stored.isOk()).toBe(true);

    const found = await repository.findBySignature("sig-001");
    expect(found.isOk()).toBe(true);
    const value = found._unsafeUnwrap();
    expect(value).not.toBeNull();
    expect(value?.whatJa).toBe("何が起きているか");
    expect(value?.whyJa).toBe("なぜ起きるか");
    expect(value?.howJa).toBe("どう直すか");
  });

  it("存在しない signature に対して findBySignature は null を返す", async () => {
    const repository = createDrizzleLlmNarrativeCacheRepository(db);

    const found = await repository.findBySignature("nonexistent-sig");
    expect(found.isOk()).toBe(true);
    expect(found._unsafeUnwrap()).toBeNull();
  });

  it("同じ signature に store すると INSERT OR REPLACE で上書きされる", async () => {
    const repository = createDrizzleLlmNarrativeCacheRepository(db);

    const original = { whatJa: "元の説明", whyJa: "元の理由", howJa: "元の直し方" };
    const metadata = { provider: "claude-code", model: "sonnet", promptVersion: "v1" };
    await repository.store("sig-002", original, metadata);

    const updated = { whatJa: "更新した説明", whyJa: "更新した理由", howJa: "更新した直し方" };
    const updatedMetadata = { provider: "ollama", model: "llama3.1:8b", promptVersion: "v2" };
    const stored = await repository.store("sig-002", updated, updatedMetadata);
    expect(stored.isOk()).toBe(true);

    const found = await repository.findBySignature("sig-002");
    const value = found._unsafeUnwrap();
    expect(value?.whatJa).toBe("更新した説明");
    expect(value?.whyJa).toBe("更新した理由");
    expect(value?.howJa).toBe("更新した直し方");
  });
});
