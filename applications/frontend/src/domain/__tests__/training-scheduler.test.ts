import { describe, it, expect } from "vitest";
import {
  applySpacingTransition,
  computeSessionAccuracy,
  recordHvptTrial,
  completeTrainingSession,
  createSpacingScheduleIdentifier,
  createLearnerIdentifier,
  createWeaknessProfileIdentifier,
  createPhonemeContrast,
  createAccuracy0To1,
  createTrainingSessionIdentifier,
  createHvptTrialIdentifier,
  createStimulusIdentifier,
  createResponseLabel,
  type SpacingSchedule,
  type SpacingSchedulerConfig,
  type InProgressTrainingSession,
  type Accuracy0To1,
} from "../training";
import { createNonEmptyList } from "../shared";

/**
 * Training Context — スケジューラ純ロジック単体テスト (ADR-011 Compliance)
 *
 * テスト対象:
 *   - applySpacingTransition (DD-267): rest/due/gate/done 遷移
 *   - computeSessionAccuracy (DD-266): セッション正答率算出
 *   - recordHvptTrial (DD-265): correct 導出
 *   - completeTrainingSession (DD-264): 打ち切り上限
 *
 * 確認規則 (spec M-TR-2):
 *   (a) 正答率 0.6 ちょうどで done 遷移し nextPresentationAt が now + 24h ちょうど
 *   (b) 正答率 0.59 で gate 遷移し nextPresentationAt が 24h 後 "でない"（短間隔）
 *   (c) 同一 (schedule, accuracy, clock) で複数回呼んで next state/time が固定（決定論）
 *   config 注入で literal なし確認（定数を config で受け取ること）
 */

// ---- Fixtures ----

const makeSchedulerConfig = (overrides?: Partial<SpacingSchedulerConfig>): SpacingSchedulerConfig => ({
  spacingIntervalHours: 24,
  masteryGateThreshold: 0.6,
  sessionCutoffMinutesMax: 30,
  sessionCutoffMinutesMin: 20,
  gateRetryIntervalHours: 6,
  ...overrides,
});

const makeScheduleIdentifier = (value = "SS-001") => {
  const id = createSpacingScheduleIdentifier(value);
  if (!id) throw new Error(`null SpacingScheduleIdentifier: ${value}`);
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

const makeContrast = (value = "/l/-/r/") => {
  const c = createPhonemeContrast(value);
  if (!c) throw new Error(`null PhonemeContrast: ${value}`);
  return c;
};

const makeAccuracy = (value: number): Accuracy0To1 => {
  const result = createAccuracy0To1(value);
  if (result.isErr()) throw new Error(`Invalid Accuracy0To1: ${value}`);
  return result.value;
};

const makeSpacingSchedule = (overrides?: Partial<SpacingSchedule>): SpacingSchedule => ({
  identifier: makeScheduleIdentifier(),
  learner: makeLearner(),
  focusSound: makeWeaknessProfileId(),
  contrast: makeContrast(),
  state: "due",
  nextPresentationAt: new Date("2026-01-01T00:00:00Z"),
  recentAccuracy: null,
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

const makeTrainingSessionId = (value = "TS-001") => {
  const id = createTrainingSessionIdentifier(value);
  if (!id) throw new Error(`null TrainingSessionIdentifier: ${value}`);
  return id;
};

const makeInProgressSession = (): InProgressTrainingSession => ({
  type: "in_progress",
  identifier: makeTrainingSessionId(),
  learner: makeLearner(),
  kind: "hvpt_identification",
  contrast: makeContrast(),
  startedAt: new Date("2026-01-01T00:00:00Z"),
});

// ---- applySpacingTransition ----

describe("applySpacingTransition (DD-267, ADR-011 Compliance)", () => {
  it("(a) 正答率 0.6 ちょうどで rest 状態（done 遷移後）になり nextPresentationAt が now + 24h", () => {
    const config = makeSchedulerConfig();
    const schedule = makeSpacingSchedule({ state: "due" });
    const now = new Date("2026-01-02T00:00:00Z");
    const accuracy = makeAccuracy(0.6); // 閾値ちょうど

    const result = applySpacingTransition(schedule, accuracy, config, now);

    // done → rest に戻る（ADR-011 設計: done 遷移後 rest へ）
    expect(result.state).toBe("rest");
    // nextPresentationAt = now + 24h
    const expectedNext = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    expect(result.nextPresentationAt.toISOString()).toBe(expectedNext.toISOString());
    expect(Number(result.recentAccuracy)).toBeCloseTo(0.6);
  });

  it("(b) 正答率 0.59 で gate 遷移し nextPresentationAt が 24h 後でない（短間隔）", () => {
    const config = makeSchedulerConfig();
    const schedule = makeSpacingSchedule({ state: "due" });
    const now = new Date("2026-01-02T00:00:00Z");
    const accuracy = makeAccuracy(0.59);

    const result = applySpacingTransition(schedule, accuracy, config, now);

    expect(result.state).toBe("gate");
    // nextPresentationAt は 24h 後ではなく gateRetryIntervalHours 後
    const full24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    expect(result.nextPresentationAt.toISOString()).not.toBe(full24h.toISOString());
    // gateRetryIntervalHours = 6h 後であること
    const expected6h = new Date(now.getTime() + 6 * 60 * 60 * 1000);
    expect(result.nextPresentationAt.toISOString()).toBe(expected6h.toISOString());
  });

  it("(c) 同一 (schedule, accuracy, clock) で複数回呼んで next state/time が固定（決定論）", () => {
    const config = makeSchedulerConfig();
    const schedule = makeSpacingSchedule({ state: "due" });
    const now = new Date("2026-01-02T00:00:00Z");
    const accuracy = makeAccuracy(0.7);

    const result1 = applySpacingTransition(schedule, accuracy, config, now);
    const result2 = applySpacingTransition(schedule, accuracy, config, now);
    const result3 = applySpacingTransition(schedule, accuracy, config, now);

    expect(result1.state).toBe(result2.state);
    expect(result1.state).toBe(result3.state);
    expect(result1.nextPresentationAt.toISOString()).toBe(result2.nextPresentationAt.toISOString());
    expect(result1.nextPresentationAt.toISOString()).toBe(result3.nextPresentationAt.toISOString());
  });

  it("now < nextPresentationAt のとき rest を維持する（提示時刻未到達）", () => {
    const config = makeSchedulerConfig();
    const future = new Date("2026-01-10T00:00:00Z");
    const schedule = makeSpacingSchedule({
      state: "rest",
      nextPresentationAt: future,
    });
    const now = new Date("2026-01-01T00:00:00Z"); // future より前

    const result = applySpacingTransition(schedule, null, config, now);

    expect(result.state).toBe("rest");
  });

  it("accuracy null かつ now >= nextPresentationAt のとき due に遷移する", () => {
    const config = makeSchedulerConfig();
    const past = new Date("2026-01-01T00:00:00Z");
    const schedule = makeSpacingSchedule({
      state: "rest",
      nextPresentationAt: past,
    });
    const now = new Date("2026-01-02T12:00:00Z"); // past より後

    const result = applySpacingTransition(schedule, null, config, now);

    expect(result.state).toBe("due");
  });

  it("24h 境界: now が nextPresentationAt ちょうどで due に遷移する", () => {
    const config = makeSchedulerConfig();
    const boundary = new Date("2026-01-02T00:00:00Z");
    const schedule = makeSpacingSchedule({
      state: "rest",
      nextPresentationAt: boundary,
    });
    const now = boundary; // 境界値ちょうど

    const result = applySpacingTransition(schedule, null, config, now);

    expect(result.state).toBe("due");
  });

  it("config の spacingIntervalHours を変えると nextPresentationAt が変わる（config 注入で literal なし）", () => {
    const config12h = makeSchedulerConfig({ spacingIntervalHours: 12 });
    const config48h = makeSchedulerConfig({ spacingIntervalHours: 48 });
    const schedule = makeSpacingSchedule({ state: "due" });
    const now = new Date("2026-01-02T00:00:00Z");
    const accuracy = makeAccuracy(0.8);

    const result12h = applySpacingTransition(schedule, accuracy, config12h, now);
    const result48h = applySpacingTransition(schedule, accuracy, config48h, now);

    const expected12h = new Date(now.getTime() + 12 * 60 * 60 * 1000);
    const expected48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    expect(result12h.nextPresentationAt.toISOString()).toBe(expected12h.toISOString());
    expect(result48h.nextPresentationAt.toISOString()).toBe(expected48h.toISOString());
  });

  it("config の masteryGateThreshold を変えると done/gate 分岐が変わる", () => {
    const config80 = makeSchedulerConfig({ masteryGateThreshold: 0.8 });
    const schedule = makeSpacingSchedule({ state: "due" });
    const now = new Date("2026-01-02T00:00:00Z");
    // accuracy 0.7 は threshold 0.6 なら done、0.8 なら gate
    const accuracy = makeAccuracy(0.7);

    const resultWith60 = applySpacingTransition(
      schedule,
      accuracy,
      makeSchedulerConfig({ masteryGateThreshold: 0.6 }),
      now,
    );
    const resultWith80 = applySpacingTransition(schedule, accuracy, config80, now);

    expect(resultWith60.state).toBe("rest"); // done → rest
    expect(resultWith80.state).toBe("gate");
  });

  it("gate 状態で accuracy >= threshold なら done 遷移（gate からの回復）", () => {
    const config = makeSchedulerConfig();
    const schedule = makeSpacingSchedule({ state: "gate" });
    const now = new Date("2026-01-02T06:00:00Z");
    const accuracy = makeAccuracy(0.65);

    const result = applySpacingTransition(schedule, accuracy, config, now);

    expect(result.state).toBe("rest"); // done → rest
    const expectedNext = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    expect(result.nextPresentationAt.toISOString()).toBe(expectedNext.toISOString());
  });

  it("updatedAt が now に更新される", () => {
    const config = makeSchedulerConfig();
    const schedule = makeSpacingSchedule({ state: "due" });
    const now = new Date("2026-06-13T10:00:00Z");
    const accuracy = makeAccuracy(0.6);

    const result = applySpacingTransition(schedule, accuracy, config, now);

    expect(result.updatedAt.toISOString()).toBe(now.toISOString());
  });
});

// ---- computeSessionAccuracy ----

describe("computeSessionAccuracy (DD-266)", () => {
  const makeTrialId = (value: string) => {
    const id = createHvptTrialIdentifier(value);
    if (!id) throw new Error(`null HvptTrialIdentifier`);
    return id;
  };
  const makeStimulusId = (value: string) => {
    const id = createStimulusIdentifier(value);
    if (!id) throw new Error(`null StimulusIdentifier`);
    return id;
  };
  const makeLabel = (type: "spelling" | "keyword" | "ipa", value: string) => {
    const result = createResponseLabel(type, value);
    if (result.isErr()) throw new Error(`Invalid ResponseLabel`);
    return result.value;
  };

  const makeCorrectTrial = (id: string) => {
    const label = makeLabel("spelling", "light");
    return {
      identifier: makeTrialId(id),
      trainingSession: makeTrainingSessionId(),
      stimulus: makeStimulusId("stim-001"),
      contrast: makeContrast(),
      correctLabel: label,
      response: label, // 正解
      correct: true,
      reactionTimeMilliseconds: 500 as ReturnType<typeof createHvptTrialIdentifier>,
      presentedAt: new Date("2026-01-01T00:00:00Z"),
    };
  };

  const makeWrongTrial = (id: string) => {
    const correctLabel = makeLabel("spelling", "light");
    const wrongResponse = makeLabel("spelling", "right");
    return {
      identifier: makeTrialId(id),
      trainingSession: makeTrainingSessionId(),
      stimulus: makeStimulusId("stim-001"),
      contrast: makeContrast(),
      correctLabel,
      response: wrongResponse,
      correct: false,
      reactionTimeMilliseconds: 800 as ReturnType<typeof createHvptTrialIdentifier>,
      presentedAt: new Date("2026-01-01T00:00:00Z"),
    };
  };

  it("全試行正解で正答率 1.0 を返す", () => {
    const trials = createNonEmptyList([
      makeCorrectTrial("T-001"),
      makeCorrectTrial("T-002"),
      makeCorrectTrial("T-003"),
    ])!;

    const accuracy = computeSessionAccuracy(trials);
    expect(Number(accuracy)).toBe(1.0);
  });

  it("全試行不正解で正答率 0.0 を返す", () => {
    const trials = createNonEmptyList([
      makeWrongTrial("T-001"),
      makeWrongTrial("T-002"),
    ])!;

    const accuracy = computeSessionAccuracy(trials);
    expect(Number(accuracy)).toBe(0.0);
  });

  it("3/5 正解で正答率 0.6 を返す（60% ゲート境界値）", () => {
    const trials = createNonEmptyList([
      makeCorrectTrial("T-001"),
      makeCorrectTrial("T-002"),
      makeCorrectTrial("T-003"),
      makeWrongTrial("T-004"),
      makeWrongTrial("T-005"),
    ])!;

    const accuracy = computeSessionAccuracy(trials);
    expect(Number(accuracy)).toBeCloseTo(0.6);
  });

  it("1試行のみ正解で正答率 1.0 を返す", () => {
    const trials = createNonEmptyList([makeCorrectTrial("T-001")])!;
    const accuracy = computeSessionAccuracy(trials);
    expect(Number(accuracy)).toBe(1.0);
  });
});

// ---- recordHvptTrial ----

describe("recordHvptTrial (DD-265) — correct 導出", () => {
  const makeLabel = (type: "spelling" | "keyword" | "ipa", value: string) => {
    const result = createResponseLabel(type, value);
    if (result.isErr()) throw new Error(`Invalid ResponseLabel`);
    return result.value;
  };

  it("correctLabel と response が一致すると correct = true", () => {
    const label = makeLabel("spelling", "light");
    const result = recordHvptTrial({
      identifier: createHvptTrialIdentifier("T-001")!,
      trainingSession: makeTrainingSessionId(),
      stimulus: createStimulusIdentifier("stim-001")!,
      contrast: makeContrast(),
      correctLabel: label,
      response: label,
      reactionTimeMilliseconds: 500,
      presentedAt: new Date(),
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().trial.correct).toBe(true);
  });

  it("correctLabel と response が一致しないと correct = false", () => {
    const correctLabel = makeLabel("spelling", "light");
    const wrongResponse = makeLabel("spelling", "right");
    const result = recordHvptTrial({
      identifier: createHvptTrialIdentifier("T-002")!,
      trainingSession: makeTrainingSessionId(),
      stimulus: createStimulusIdentifier("stim-001")!,
      contrast: makeContrast(),
      correctLabel,
      response: wrongResponse,
      reactionTimeMilliseconds: 800,
      presentedAt: new Date(),
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().trial.correct).toBe(false);
  });

  it("reactionTimeMilliseconds が 0 以下のとき InvalidReactionTime を返す", () => {
    const label = makeLabel("keyword", "light");
    const result = recordHvptTrial({
      identifier: createHvptTrialIdentifier("T-003")!,
      trainingSession: makeTrainingSessionId(),
      stimulus: createStimulusIdentifier("stim-001")!,
      contrast: makeContrast(),
      correctLabel: label,
      response: label,
      reactionTimeMilliseconds: 0,
      presentedAt: new Date(),
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("validationFailed");
  });
});

// ---- completeTrainingSession ----

describe("completeTrainingSession (DD-264) — 打ち切り上限", () => {
  it("durationMinutes が sessionCutoffMinutesMax 以内なら completed に遷移する", () => {
    const config = makeSchedulerConfig({ sessionCutoffMinutesMax: 30 });
    const session = makeInProgressSession();
    const now = new Date("2026-01-01T00:30:00Z");

    const result = completeTrainingSession(session, 25, null, config, now);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().session.type).toBe("completed");
    expect(Number(result._unsafeUnwrap().session.durationMinutes)).toBe(25);
  });

  it("durationMinutes が sessionCutoffMinutesMax を超えると validationFailed を返す", () => {
    const config = makeSchedulerConfig({ sessionCutoffMinutesMax: 30 });
    const session = makeInProgressSession();
    const now = new Date("2026-01-01T00:40:00Z");

    const result = completeTrainingSession(session, 31, null, config, now);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("validationFailed");
  });

  it("durationMinutes が 0 のとき validationFailed を返す", () => {
    const config = makeSchedulerConfig({ sessionCutoffMinutesMax: 30 });
    const session = makeInProgressSession();
    const now = new Date("2026-01-01T00:01:00Z");

    const result = completeTrainingSession(session, 0, null, config, now);

    expect(result.isErr()).toBe(true);
  });

  it("sessionAccuracy が設定される", () => {
    const config = makeSchedulerConfig();
    const session = makeInProgressSession();
    const now = new Date("2026-01-01T00:25:00Z");
    const accuracy = makeAccuracy(0.75);

    const result = completeTrainingSession(session, 20, accuracy, config, now);

    expect(result.isOk()).toBe(true);
    expect(Number(result._unsafeUnwrap().session.sessionAccuracy)).toBeCloseTo(0.75);
  });

  it("TrainingSessionCompleted イベントが発行される", () => {
    const config = makeSchedulerConfig();
    const session = makeInProgressSession();
    const now = new Date("2026-01-01T00:25:00Z");

    const result = completeTrainingSession(session, 22, null, config, now);

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.events).toHaveLength(1);
    expect(output.events[0].type).toBe("trainingSessionCompleted");
    expect(Number(output.events[0].durationMinutes)).toBe(22);
  });
});
