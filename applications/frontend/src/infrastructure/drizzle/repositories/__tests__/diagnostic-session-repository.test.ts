import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../schema";
import { type DrizzleDatabase } from "../../client";
import { createDrizzleDiagnosticSessionRepository } from "../diagnostic-session-repository";
import {
  createDiagnosticSessionIdentifier,
  createLearnerIdentifier,
  createWeaknessProfileIdentifier,
  type PendingDiagnosticSession,
  type CompletedDiagnosticSession,
  type DiagnosticPromptSet,
} from "../../../../domain/training";
import { type AssessmentResultIdentifier } from "../../../../domain/assessment-result";
import { createNonEmptyList } from "../../../../domain/shared";

/**
 * DiagnosticSessionRepository real sqlite round-trip テスト。
 * save→findByIdentifier/findLatestByLearner で pending/completed の往復を確認する。
 */

const createTestDatabase = (): DrizzleDatabase => {
  const sqlite = new Database(":memory:");
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
      deleted_at TEXT,
      CONSTRAINT ck_diagnostic_sessions_status CHECK(status IN ('pending', 'completed')),
      CONSTRAINT ck_diagnostic_sessions_prompt_set_json CHECK(json_valid(prompt_set_json)),
      CONSTRAINT ck_diagnostic_sessions_assessment_result_json
        CHECK(assessment_result_json IS NULL OR json_valid(assessment_result_json)),
      CONSTRAINT ck_diagnostic_sessions_completed
        CHECK(status != 'completed' OR (weakness_profile IS NOT NULL AND assessment_result_json IS NOT NULL AND completed_at IS NOT NULL))
    );
    CREATE INDEX idx_diagnostic_sessions_learner_created ON diagnostic_sessions (learner, deleted_at, created_at);
  `);
  return drizzle(sqlite, { schema }) as DrizzleDatabase;
};

const makeSessionId = (value = "DS-001") => {
  const id = createDiagnosticSessionIdentifier(value);
  if (!id) throw new Error(`null DiagnosticSessionIdentifier: ${value}`);
  return id;
};

const makeLearner = (value = "learner-001") => {
  const id = createLearnerIdentifier(value);
  if (!id) throw new Error(`null LearnerIdentifier: ${value}`);
  return id;
};

const makeWeaknessProfileId = (value = "WP-001") => {
  const id = createWeaknessProfileIdentifier(value);
  if (!id) throw new Error(`null WeaknessProfileIdentifier: ${value}`);
  return id;
};

const makePromptSet = (): DiagnosticPromptSet => ({
  prompts: [
    {
      identifier: "p1",
      text: "Please say: red led",
      targetCatalogId: null,
      phenomenon: "segmental",
    },
  ],
});

const makePendingSession = (
  identifier = "DS-001",
  learner = "learner-001",
): PendingDiagnosticSession => ({
  type: "pending",
  identifier: makeSessionId(identifier),
  learner: makeLearner(learner),
  promptSet: makePromptSet(),
  startedAt: new Date("2026-01-01T00:00:00Z"),
});

describe("DiagnosticSessionRepository (real sqlite round-trip)", () => {
  let db: DrizzleDatabase;

  beforeEach(() => {
    db = createTestDatabase();
  });

  it("pending セッションを save して identifier で再取得できる", async () => {
    const repository = createDrizzleDiagnosticSessionRepository(db);
    const session = makePendingSession();

    const saveResult = await repository.persist(session);
    expect(saveResult.isOk()).toBe(true);

    const findResult = await repository.find(session.identifier);
    expect(findResult.isOk()).toBe(true);

    const found = findResult._unsafeUnwrap();
    expect(found.type).toBe("pending");
    expect(String(found.identifier)).toBe("DS-001");
    expect(String(found.learner)).toBe("learner-001");
  });

  it("pending セッションの promptSet が JSON ラウンドトリップで保持される", async () => {
    const repository = createDrizzleDiagnosticSessionRepository(db);
    const session = makePendingSession();

    await repository.persist(session);
    const findResult = await repository.find(session.identifier);

    const found = findResult._unsafeUnwrap();
    expect(found.promptSet.prompts).toHaveLength(1);
    expect(found.promptSet.prompts[0].text).toBe("Please say: red led");
  });

  it("completed セッションを save して identifier で再取得できる", async () => {
    const repository = createDrizzleDiagnosticSessionRepository(db);
    const pending = makePendingSession();

    // まず pending を保存
    await repository.persist(pending);

    // completed に更新
    const assessmentResults = createNonEmptyList(["AR-001" as AssessmentResultIdentifier])!;
    const completed: CompletedDiagnosticSession = {
      type: "completed",
      identifier: pending.identifier,
      learner: pending.learner,
      promptSet: pending.promptSet,
      assessmentResults,
      weaknessProfile: makeWeaknessProfileId("WP-001"),
      startedAt: pending.startedAt,
      completedAt: new Date("2026-01-01T01:00:00Z"),
    };
    const updateResult = await repository.persist(completed);
    expect(updateResult.isOk()).toBe(true);

    const findResult = await repository.find(pending.identifier);
    expect(findResult.isOk()).toBe(true);

    const found = findResult._unsafeUnwrap();
    expect(found.type).toBe("completed");
    if (found.type !== "completed") throw new Error("expected completed");

    expect(String(found.weaknessProfile)).toBe("WP-001");
    expect(found.assessmentResults).toHaveLength(1);
    expect(String(found.assessmentResults[0])).toBe("AR-001");
  });

  it("存在しない identifier で find すると notFound エラーが返る", async () => {
    const repository = createDrizzleDiagnosticSessionRepository(db);

    const result = await repository.find(makeSessionId("DS-NONEXISTENT"));
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe("notFound");
  });

  it("findLatestByLearner で learner の最新セッションを取得できる", async () => {
    const repository = createDrizzleDiagnosticSessionRepository(db);

    // 2つのセッションを異なる時刻で保存（created_at 順）
    const session1: PendingDiagnosticSession = {
      ...makePendingSession("DS-001", "learner-001"),
      startedAt: new Date("2026-01-01T00:00:00Z"),
    };
    const session2: PendingDiagnosticSession = {
      ...makePendingSession("DS-002", "learner-001"),
      startedAt: new Date("2026-01-02T00:00:00Z"),
    };

    await repository.persist(session1);
    await repository.persist(session2);

    const result = await repository.findLatestByLearner(makeLearner("learner-001"));
    expect(result.isOk()).toBe(true);

    // findLatestByLearner は created_at 降順で1件を取得するため最後に挿入した DS-002 が返る
    const found = result._unsafeUnwrap();
    expect(found).not.toBeNull();
    expect(String(found!.identifier)).toBe("DS-002");
  });

  it("learner が存在しない場合 findLatestByLearner は null を返す", async () => {
    const repository = createDrizzleDiagnosticSessionRepository(db);

    const result = await repository.findLatestByLearner(makeLearner("learner-NOBODY"));
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeNull();
  });
});
