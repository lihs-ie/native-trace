import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../schema";
import { type DrizzleDatabase } from "../../client";
import { createDrizzleWeaknessProfileRepository } from "../weakness-profile-repository";
import {
  createWeaknessProfileIdentifier,
  createLearnerIdentifier,
  createDiagnosticSessionIdentifier,
  createPhonemeContrast,
  createCatalogId,
  createOccurrenceFrequency,
  createMastery0To1,
  createPriorityScore,
  type WeaknessProfile,
  type FocusSound,
} from "../../../../domain/training";
import { createNonEmptyList } from "../../../../domain/shared";

/**
 * WeaknessProfileRepository real sqlite round-trip テスト。
 * persist→find/findByLearner で FocusSound JSON カラムの往復・FK 参照を確認する。
 */

const makeProfileId = (value = "WP-001") => {
  const id = createWeaknessProfileIdentifier(value);
  if (!id) throw new Error(`null WeaknessProfileIdentifier: ${value}`);
  return id;
};

const makeLearner = (value = "learner-001") => {
  const id = createLearnerIdentifier(value);
  if (!id) throw new Error(`null LearnerIdentifier: ${value}`);
  return id;
};

const makeSessionId = (value = "DS-001") => {
  const id = createDiagnosticSessionIdentifier(value);
  if (!id) throw new Error(`null DiagnosticSessionIdentifier: ${value}`);
  return id;
};

const makeFocusSound = (
  contrast = "/l/-/r/",
  catalogId = "cat-001",
  flRank: FocusSound["functionalLoadRank"] = "high",
  frequency = 0.5,
  mastery = 0.5,
  priority = 0.5,
): FocusSound => {
  const contrastBranded = createPhonemeContrast(contrast);
  if (!contrastBranded) throw new Error(`null PhonemeContrast: ${contrast}`);
  const catalogIdBranded = createCatalogId(catalogId);
  if (!catalogIdBranded) throw new Error(`null CatalogId: ${catalogId}`);
  const occFreq = createOccurrenceFrequency(frequency);
  if (occFreq.isErr()) throw new Error(`invalid OccurrenceFrequency: ${frequency}`);
  const masteryBranded = createMastery0To1(mastery);
  if (masteryBranded.isErr()) throw new Error(`invalid Mastery0To1: ${mastery}`);
  const priorityBranded = createPriorityScore(priority);
  if (priorityBranded.isErr()) throw new Error(`invalid PriorityScore: ${priority}`);
  return {
    contrast: contrastBranded,
    catalogId: catalogIdBranded,
    functionalLoadRank: flRank,
    occurrenceFrequency: occFreq.value,
    mastery: masteryBranded.value,
    priority: priorityBranded.value,
  };
};

const makeWeaknessProfile = (
  profileId = "WP-001",
  learner = "learner-001",
  sessionId = "DS-001",
  sounds?: FocusSound[],
): WeaknessProfile => ({
  identifier: makeProfileId(profileId),
  learner: makeLearner(learner),
  diagnosticSession: makeSessionId(sessionId),
  focusSounds: createNonEmptyList(sounds ?? [makeFocusSound()])!,
  lastUpdatedAt: new Date("2026-01-01T00:00:00Z"),
  createdAt: new Date("2026-01-01T00:00:00Z"),
});

describe("WeaknessProfileRepository (real sqlite round-trip)", () => {
  let db: DrizzleDatabase;
  let sqlite: ReturnType<typeof Database>;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE diagnostic_sessions (
        identifier TEXT PRIMARY KEY,
        learner TEXT NOT NULL,
        prompt_set_json TEXT NOT NULL,
        status TEXT NOT NULL,
        weakness_profile TEXT,
        assessment_result_json TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE TABLE weakness_profiles (
        identifier TEXT PRIMARY KEY,
        learner TEXT NOT NULL,
        diagnostic_session TEXT NOT NULL REFERENCES diagnostic_sessions(identifier),
        focus_sounds_json TEXT NOT NULL,
        last_updated_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        CONSTRAINT ck_weakness_profiles_focus_sounds_json CHECK(json_valid(focus_sounds_json))
      );
      CREATE UNIQUE INDEX uq_weakness_profiles_learner ON weakness_profiles (learner);
      CREATE INDEX idx_weakness_profiles_learner ON weakness_profiles (learner, deleted_at);
    `);
    // FK 参照のために diagnostic_session を先に挿入
    sqlite.exec(`
      INSERT INTO diagnostic_sessions (identifier, learner, prompt_set_json, status, started_at, created_at, updated_at)
      VALUES ('DS-001', 'learner-001', '{"prompts":[]}', 'pending', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
      INSERT INTO diagnostic_sessions (identifier, learner, prompt_set_json, status, started_at, created_at, updated_at)
      VALUES ('DS-002', 'learner-002', '{"prompts":[]}', 'pending', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    `);
    db = drizzle(sqlite, { schema }) as DrizzleDatabase;
  });

  it("プロファイルを persist して identifier で再取得できる", async () => {
    const repository = createDrizzleWeaknessProfileRepository(db);
    const profile = makeWeaknessProfile();

    const saveResult = await repository.persist(profile);
    expect(saveResult.isOk()).toBe(true);

    const findResult = await repository.find(profile.identifier);
    expect(findResult.isOk()).toBe(true);

    const found = findResult._unsafeUnwrap();
    expect(String(found.identifier)).toBe("WP-001");
    expect(String(found.learner)).toBe("learner-001");
    expect(String(found.diagnosticSession)).toBe("DS-001");
  });

  it("FocusSound の全フィールドが JSON ラウンドトリップで保持される", async () => {
    const repository = createDrizzleWeaknessProfileRepository(db);
    const sound = makeFocusSound("/l/-/r/", "cat-lr", "max", 0.8, 0.3, 0.9);
    const profile = makeWeaknessProfile("WP-001", "learner-001", "DS-001", [sound]);

    await repository.persist(profile);
    const findResult = await repository.find(profile.identifier);

    expect(findResult.isOk()).toBe(true);
    const found = findResult._unsafeUnwrap();
    const foundSound = found.focusSounds[0];

    expect(String(foundSound.contrast)).toBe("/l/-/r/");
    expect(String(foundSound.catalogId)).toBe("cat-lr");
    expect(foundSound.functionalLoadRank).toBe("max");
    expect(Number(foundSound.occurrenceFrequency)).toBeCloseTo(0.8, 5);
    expect(Number(foundSound.mastery)).toBeCloseTo(0.3, 5);
    expect(Number(foundSound.priority)).toBeCloseTo(0.9, 5);
  });

  it("複数の FocusSound が正しい順序で保持される", async () => {
    const repository = createDrizzleWeaknessProfileRepository(db);
    const sound1 = makeFocusSound("/l/-/r/", "cat-001", "high", 0.5, 0.5, 0.7);
    const sound2 = makeFocusSound("/v/-/b/", "cat-002", "mid", 0.3, 0.7, 0.4);
    const profile = makeWeaknessProfile("WP-001", "learner-001", "DS-001", [sound1, sound2]);

    await repository.persist(profile);
    const findResult = await repository.find(profile.identifier);

    expect(findResult.isOk()).toBe(true);
    const found = findResult._unsafeUnwrap();
    expect(found.focusSounds).toHaveLength(2);
    expect(String(found.focusSounds[0].contrast)).toBe("/l/-/r/");
    expect(String(found.focusSounds[1].contrast)).toBe("/v/-/b/");
  });

  it("learner で検索できる（findByLearner）", async () => {
    const repository = createDrizzleWeaknessProfileRepository(db);
    const profile = makeWeaknessProfile("WP-001", "learner-001", "DS-001");

    await repository.persist(profile);
    const result = await repository.findByLearner(makeLearner("learner-001"));

    expect(result.isOk()).toBe(true);
    const found = result._unsafeUnwrap();
    expect(found).not.toBeNull();
    expect(String(found!.identifier)).toBe("WP-001");
  });

  it("存在しない learner では findByLearner が null を返す", async () => {
    const repository = createDrizzleWeaknessProfileRepository(db);

    const result = await repository.findByLearner(makeLearner("learner-NOBODY"));
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeNull();
  });

  it("存在しない identifier で find すると notFound エラーが返る", async () => {
    const repository = createDrizzleWeaknessProfileRepository(db);

    const result = await repository.find(makeProfileId("WP-NONEXISTENT"));
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe("notFound");
  });

  it("persist を2回呼ぶと upsert で focusSounds が更新される", async () => {
    const repository = createDrizzleWeaknessProfileRepository(db);
    const originalSound = makeFocusSound("/l/-/r/", "cat-001", "high", 0.5, 0.5, 0.6);
    const profile = makeWeaknessProfile("WP-001", "learner-001", "DS-001", [originalSound]);

    await repository.persist(profile);

    // focusSounds を更新して再 persist
    const updatedSound = makeFocusSound("/l/-/r/", "cat-001", "high", 0.8, 0.2, 0.9);
    const updatedProfile: WeaknessProfile = {
      ...profile,
      focusSounds: createNonEmptyList([updatedSound])!,
      lastUpdatedAt: new Date("2026-06-13T00:00:00Z"),
    };
    await repository.persist(updatedProfile);

    const findResult = await repository.find(profile.identifier);
    expect(findResult.isOk()).toBe(true);
    const found = findResult._unsafeUnwrap();
    expect(Number(found.focusSounds[0].occurrenceFrequency)).toBeCloseTo(0.8, 5);
    expect(Number(found.focusSounds[0].mastery)).toBeCloseTo(0.2, 5);
    expect(Number(found.focusSounds[0].priority)).toBeCloseTo(0.9, 5);
  });
});
