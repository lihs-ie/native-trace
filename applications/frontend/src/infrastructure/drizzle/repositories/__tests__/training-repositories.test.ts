import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../schema";
import { type DrizzleDatabase } from "../../client";
import { createDrizzleTrainingSessionRepository } from "../training-session-repository";
import { createDrizzleHvptTrialRepository } from "../hvpt-trial-repository";
import { createDrizzleSpacingScheduleRepository } from "../spacing-schedule-repository";
import {
  createTrainingSessionIdentifier,
  createHvptTrialIdentifier,
  createSpacingScheduleIdentifier,
  createLearnerIdentifier,
  createWeaknessProfileIdentifier,
  createPhonemeContrast,
  createAccuracy0To1,
  createStimulusIdentifier,
  createResponseLabel,
  type InProgressTrainingSession,
  type CompletedTrainingSession,
  type HvptTrial,
  type SpacingSchedule,
} from "../../../../domain/training";

/**
 * Training Context repository real sqlite round-trip テスト。
 * 3集約 (TrainingSession / HvptTrial / SpacingSchedule) の永続化 round-trip を検証する。
 */

// ---- テスト DB セットアップ ----

const createTestDatabase = (): DrizzleDatabase => {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE training_sessions (
      identifier TEXT PRIMARY KEY,
      learner TEXT NOT NULL,
      kind TEXT NOT NULL,
      contrast TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      aborted_at TEXT,
      duration_minutes INTEGER,
      session_accuracy REAL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      CONSTRAINT ck_training_sessions_kind
        CHECK(kind IN ('hvpt_identification', 'production_drill', 'shadowing')),
      CONSTRAINT ck_training_sessions_status
        CHECK(status IN ('in_progress', 'completed', 'aborted')),
      CONSTRAINT ck_training_sessions_completed
        CHECK(status != 'completed' OR (ended_at IS NOT NULL AND duration_minutes IS NOT NULL)),
      CONSTRAINT ck_training_sessions_aborted
        CHECK(status != 'aborted' OR aborted_at IS NOT NULL),
      CONSTRAINT ck_training_sessions_duration_minutes
        CHECK(duration_minutes IS NULL OR (duration_minutes >= 1 AND duration_minutes <= 30)),
      CONSTRAINT ck_training_sessions_session_accuracy
        CHECK(session_accuracy IS NULL OR (session_accuracy >= 0 AND session_accuracy <= 1))
    );
    CREATE INDEX idx_training_sessions_learner_started ON training_sessions (learner, deleted_at, started_at);
    CREATE INDEX idx_training_sessions_contrast_started ON training_sessions (learner, contrast, deleted_at, started_at);

    CREATE TABLE weakness_profiles (
      identifier TEXT PRIMARY KEY,
      learner TEXT NOT NULL,
      diagnostic_session TEXT NOT NULL,
      focus_sounds_json TEXT NOT NULL,
      last_updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE hvpt_trials (
      identifier TEXT PRIMARY KEY,
      training_session TEXT NOT NULL,
      stimulus TEXT NOT NULL,
      contrast TEXT NOT NULL,
      correct_label_json TEXT NOT NULL,
      response_json TEXT NOT NULL,
      correct INTEGER NOT NULL,
      reaction_time_milliseconds INTEGER NOT NULL,
      presented_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      deleted_at TEXT,
      FOREIGN KEY (training_session) REFERENCES training_sessions(identifier),
      CONSTRAINT ck_hvpt_trials_correct CHECK(correct IN (0, 1)),
      CONSTRAINT ck_hvpt_trials_reaction_time CHECK(reaction_time_milliseconds > 0),
      CONSTRAINT ck_hvpt_trials_correct_label_json CHECK(json_valid(correct_label_json)),
      CONSTRAINT ck_hvpt_trials_response_json CHECK(json_valid(response_json))
    );
    CREATE INDEX idx_hvpt_trials_training_session ON hvpt_trials (training_session, deleted_at, presented_at);

    CREATE TABLE spacing_schedules (
      identifier TEXT PRIMARY KEY,
      learner TEXT NOT NULL,
      focus_sound TEXT NOT NULL,
      contrast TEXT NOT NULL,
      state TEXT NOT NULL,
      next_presentation_at TEXT NOT NULL,
      recent_accuracy REAL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      FOREIGN KEY (focus_sound) REFERENCES weakness_profiles(identifier),
      CONSTRAINT uq_spacing_schedules_learner_contrast UNIQUE (learner, contrast),
      CONSTRAINT ck_spacing_schedules_state CHECK(state IN ('rest', 'due', 'gate', 'done')),
      CONSTRAINT ck_spacing_schedules_recent_accuracy
        CHECK(recent_accuracy IS NULL OR (recent_accuracy >= 0 AND recent_accuracy <= 1))
    );
    CREATE INDEX idx_spacing_schedules_due ON spacing_schedules (state, deleted_at, next_presentation_at);
    CREATE INDEX idx_spacing_schedules_learner_contrast ON spacing_schedules (learner, contrast, deleted_at);
  `);
  return drizzle(sqlite, { schema }) as DrizzleDatabase;
};

// ---- Helpers ----

const makeSessionId = (value = "TS-001") => {
  const id = createTrainingSessionIdentifier(value);
  if (!id) throw new Error(`null TrainingSessionIdentifier: ${value}`);
  return id;
};

const makeLearner = (value = "learner-001") => {
  const id = createLearnerIdentifier(value);
  if (!id) throw new Error(`null LearnerIdentifier: ${value}`);
  return id;
};

const makeContrast = (value = "/l/-/r/") => {
  const c = createPhonemeContrast(value);
  if (!c) throw new Error(`null PhonemeContrast: ${value}`);
  return c;
};

const makeWeaknessProfileId = (value = "WP-001") => {
  const id = createWeaknessProfileIdentifier(value);
  if (!id) throw new Error(`null WeaknessProfileIdentifier: ${value}`);
  return id;
};

const makeInProgressSession = (id = "TS-001"): InProgressTrainingSession => ({
  type: "in_progress",
  identifier: makeSessionId(id),
  learner: makeLearner(),
  kind: "hvpt_identification",
  contrast: makeContrast(),
  startedAt: new Date("2026-01-01T00:00:00Z"),
});

const makeSpacingSchedule = (id = "SS-001", contrast = "/l/-/r/"): SpacingSchedule => ({
  identifier: createSpacingScheduleIdentifier(id)!,
  learner: makeLearner(),
  focusSound: makeWeaknessProfileId(),
  contrast: makeContrast(contrast),
  state: "due",
  nextPresentationAt: new Date("2026-01-01T00:00:00Z"),
  recentAccuracy: null,
  updatedAt: new Date("2026-01-01T00:00:00Z"),
});

const seedWeaknessProfile = (db: DrizzleDatabase, id = "WP-001") => {
  db.run(
    `INSERT INTO weakness_profiles (identifier, learner, diagnostic_session, focus_sounds_json, last_updated_at, created_at, updated_at)
     VALUES ('${id}', 'learner-001', 'DS-001', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
  );
};

// ---- TrainingSessionRepository tests ----

describe("TrainingSessionRepository (real sqlite round-trip)", () => {
  let db: DrizzleDatabase;

  beforeEach(() => {
    db = createTestDatabase();
  });

  it("in_progress セッションを persist して identifier で再取得できる", async () => {
    const repository = createDrizzleTrainingSessionRepository(db);
    const session = makeInProgressSession();

    const saveResult = await repository.persist(session);
    expect(saveResult.isOk()).toBe(true);

    const findResult = await repository.find(session.identifier);
    expect(findResult.isOk()).toBe(true);

    const found = findResult._unsafeUnwrap();
    expect(found.type).toBe("in_progress");
    expect(String(found.identifier)).toBe("TS-001");
    expect(String(found.learner)).toBe("learner-001");
    expect(found.kind).toBe("hvpt_identification");
  });

  it("in_progress → completed に状態更新して再取得できる", async () => {
    const repository = createDrizzleTrainingSessionRepository(db);
    const inProgress = makeInProgressSession();
    await repository.persist(inProgress);

    const accuracy = createAccuracy0To1(0.75);
    if (accuracy.isErr()) throw new Error("Invalid accuracy");

    const completed: CompletedTrainingSession = {
      type: "completed",
      identifier: inProgress.identifier,
      learner: inProgress.learner,
      kind: inProgress.kind,
      contrast: inProgress.contrast,
      startedAt: inProgress.startedAt,
      endedAt: new Date("2026-01-01T00:25:00Z"),
      durationMinutes: 25 as CompletedTrainingSession["durationMinutes"],
      sessionAccuracy: accuracy.value,
    };

    const updateResult = await repository.persist(completed);
    expect(updateResult.isOk()).toBe(true);

    const findResult = await repository.find(inProgress.identifier);
    const found = findResult._unsafeUnwrap();
    expect(found.type).toBe("completed");
    if (found.type !== "completed") throw new Error("expected completed");
    expect(Number(found.durationMinutes)).toBe(25);
    expect(Number(found.sessionAccuracy)).toBeCloseTo(0.75);
  });

  it("存在しない identifier で find すると notFound エラーが返る", async () => {
    const repository = createDrizzleTrainingSessionRepository(db);

    const result = await repository.find(makeSessionId("TS-NONEXISTENT"));
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("notFound");
  });

  it("findByLearnerAndContrastOrderedByStartedAt で対立別セッション履歴を昇順で返す", async () => {
    const repository = createDrizzleTrainingSessionRepository(db);

    const session1: InProgressTrainingSession = {
      ...makeInProgressSession("TS-001"),
      startedAt: new Date("2026-01-01T00:00:00Z"),
    };
    const session2: InProgressTrainingSession = {
      ...makeInProgressSession("TS-002"),
      startedAt: new Date("2026-01-02T00:00:00Z"),
    };

    await repository.persist(session1);
    await repository.persist(session2);

    const result = await repository.findByLearnerAndContrastOrderedByStartedAt(
      makeLearner(),
      "/l/-/r/",
    );
    expect(result.isOk()).toBe(true);
    const sessions = result._unsafeUnwrap();
    expect(sessions).toHaveLength(2);
    expect(String(sessions[0].identifier)).toBe("TS-001");
    expect(String(sessions[1].identifier)).toBe("TS-002");
  });
});

// ---- HvptTrialRepository tests ----

describe("HvptTrialRepository (real sqlite round-trip)", () => {
  let db: DrizzleDatabase;

  beforeEach(() => {
    db = createTestDatabase();
    // 試行は training_session FK を参照するためセッションを先に挿入
    const sessionRepo = createDrizzleTrainingSessionRepository(db);
    sessionRepo.persist(makeInProgressSession());
  });

  const makeTrial = (id = "T-001"): HvptTrial => {
    const correctLabel = createResponseLabel("spelling", "light");
    if (correctLabel.isErr()) throw new Error("Invalid correctLabel");
    const response = createResponseLabel("spelling", "right");
    if (response.isErr()) throw new Error("Invalid response");

    return {
      identifier: createHvptTrialIdentifier(id)!,
      trainingSession: makeSessionId(),
      stimulus: createStimulusIdentifier("stim-001")!,
      contrast: makeContrast(),
      correctLabel: correctLabel.value,
      response: response.value,
      correct: false,
      reactionTimeMilliseconds: 800 as HvptTrial["reactionTimeMilliseconds"],
      presentedAt: new Date("2026-01-01T00:05:00Z"),
    };
  };

  it("試行を save して identifier で再取得できる", async () => {
    const repository = createDrizzleHvptTrialRepository(db);
    const trial = makeTrial();

    const saveResult = await repository.save(trial);
    expect(saveResult.isOk()).toBe(true);

    const findResult = await repository.find(trial.identifier);
    expect(findResult.isOk()).toBe(true);

    const found = findResult._unsafeUnwrap();
    expect(String(found.identifier)).toBe("T-001");
    expect(found.correct).toBe(false);
    expect(found.correctLabel.type).toBe("spelling");
    expect(found.correctLabel.value).toBe("light");
    expect(found.response.value).toBe("right");
    expect(Number(found.reactionTimeMilliseconds)).toBe(800);
  });

  it("存在しない identifier で find すると notFound エラーが返る", async () => {
    const repository = createDrizzleHvptTrialRepository(db);

    const result = await repository.find(createHvptTrialIdentifier("T-NONE")!);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("notFound");
  });

  it("findByTrainingSessionOrderedByPresentedAt でセッション内試行を presentedAt 昇順で返す", async () => {
    const repository = createDrizzleHvptTrialRepository(db);
    const correctLabel = createResponseLabel("spelling", "light")._unsafeUnwrap();

    const trial1: HvptTrial = {
      ...makeTrial("T-001"),
      response: correctLabel,
      correct: true,
      presentedAt: new Date("2026-01-01T00:02:00Z"),
    };
    const trial2: HvptTrial = {
      ...makeTrial("T-002"),
      presentedAt: new Date("2026-01-01T00:05:00Z"),
    };

    await repository.save(trial1);
    await repository.save(trial2);

    const result = await repository.findByTrainingSessionOrderedByPresentedAt(makeSessionId());
    expect(result.isOk()).toBe(true);
    const trials = result._unsafeUnwrap();
    expect(trials).toHaveLength(2);
    expect(String(trials[0].identifier)).toBe("T-001");
    expect(String(trials[1].identifier)).toBe("T-002");
  });

  it("correct = true の試行が正しく保存・再取得される", async () => {
    const repository = createDrizzleHvptTrialRepository(db);
    const label = createResponseLabel("keyword", "led")._unsafeUnwrap();
    const trial: HvptTrial = {
      ...makeTrial("T-CORRECT"),
      correctLabel: label,
      response: label,
      correct: true,
    };

    await repository.save(trial);
    const result = await repository.find(trial.identifier);
    expect(result._unsafeUnwrap().correct).toBe(true);
  });
});

// ---- SpacingScheduleRepository tests ----

describe("SpacingScheduleRepository (real sqlite round-trip)", () => {
  let db: DrizzleDatabase;

  beforeEach(() => {
    db = createTestDatabase();
    seedWeaknessProfile(db);
  });

  it("スケジュールを persist して identifier で再取得できる", async () => {
    const repository = createDrizzleSpacingScheduleRepository(db);
    const schedule = makeSpacingSchedule();

    const saveResult = await repository.persist(schedule);
    expect(saveResult.isOk()).toBe(true);

    const findResult = await repository.find(schedule.identifier);
    expect(findResult.isOk()).toBe(true);

    const found = findResult._unsafeUnwrap();
    expect(String(found.identifier)).toBe("SS-001");
    expect(found.state).toBe("due");
    expect(found.recentAccuracy).toBeNull();
  });

  it("状態遷移（due → gate）を persist して再取得できる（DD-204不変条件4）", async () => {
    const repository = createDrizzleSpacingScheduleRepository(db);
    const schedule = makeSpacingSchedule();
    await repository.persist(schedule);

    const accuracy = createAccuracy0To1(0.55);
    if (accuracy.isErr()) throw new Error("Invalid accuracy");

    const gateSchedule: SpacingSchedule = {
      ...schedule,
      state: "gate",
      nextPresentationAt: new Date("2026-01-01T06:00:00Z"),
      recentAccuracy: accuracy.value,
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    };

    await repository.persist(gateSchedule);

    const findResult = await repository.find(schedule.identifier);
    const found = findResult._unsafeUnwrap();
    expect(found.state).toBe("gate");
    expect(Number(found.recentAccuracy)).toBeCloseTo(0.55);
  });

  it("findByLearnerAndContrast で対立別スケジュールを取得できる", async () => {
    const repository = createDrizzleSpacingScheduleRepository(db);
    const schedule = makeSpacingSchedule();
    await repository.persist(schedule);

    const result = await repository.findByLearnerAndContrast(makeLearner(), "/l/-/r/");
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).not.toBeNull();
    expect(String(result._unsafeUnwrap()!.identifier)).toBe("SS-001");
  });

  it("存在しない対立で findByLearnerAndContrast は null を返す", async () => {
    const repository = createDrizzleSpacingScheduleRepository(db);

    const result = await repository.findByLearnerAndContrast(makeLearner(), "/θ/-/s/");
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeNull();
  });

  it("findDueByLearner で due 状態のスケジュールのみを返す", async () => {
    const repository = createDrizzleSpacingScheduleRepository(db);

    // due スケジュールと rest スケジュールを挿入
    // ※ 異なる contrast で2件挿入（uq_spacing_schedules_learner_contrast）
    seedWeaknessProfile(db, "WP-002");
    const dueSchedule = makeSpacingSchedule("SS-001", "/l/-/r/");
    const restSchedule: SpacingSchedule = {
      ...makeSpacingSchedule("SS-002", "/v/-/b/"),
      focusSound: makeWeaknessProfileId("WP-002"),
      state: "rest",
    };

    await repository.persist(dueSchedule);
    await repository.persist(restSchedule);

    const result = await repository.findDueByLearner(makeLearner());
    expect(result.isOk()).toBe(true);
    const dueList = result._unsafeUnwrap();
    expect(dueList).toHaveLength(1);
    expect(dueList[0].state).toBe("due");
    expect(String(dueList[0].identifier)).toBe("SS-001");
  });

  it("uq_spacing_schedules_learner_contrast 制約: 同一 learner+contrast で UNIQUE 違反が発生する", async () => {
    const repository = createDrizzleSpacingScheduleRepository(db);
    const schedule1 = makeSpacingSchedule("SS-001");
    const schedule2 = makeSpacingSchedule("SS-002"); // 同一 learner+contrast

    await repository.persist(schedule1);
    // 同一 learner+contrast で別の identifier → UNIQUE 制約違反
    const result = await repository.persist(schedule2);
    expect(result.isErr()).toBe(true);
  });

  it("recentAccuracy が正しく保存・再取得される", async () => {
    const repository = createDrizzleSpacingScheduleRepository(db);
    const accuracy = createAccuracy0To1(0.6)._unsafeUnwrap();
    const schedule: SpacingSchedule = {
      ...makeSpacingSchedule(),
      recentAccuracy: accuracy,
    };

    await repository.persist(schedule);
    const result = await repository.find(schedule.identifier);
    expect(Number(result._unsafeUnwrap().recentAccuracy)).toBeCloseTo(0.6);
  });
});
