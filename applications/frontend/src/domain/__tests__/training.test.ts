import { describe, it, expect } from "vitest";
import {
  createDiagnosticSessionIdentifier,
  createWeaknessProfileIdentifier,
  createLearnerIdentifier,
  createPhonemeContrast,
  createCatalogId,
  createOccurrenceFrequency,
  createMastery0To1,
  createPriorityScore,
  recomputeFocusPriority,
  initializeWeaknessProfile,
  completeDiagnosticSession,
  updateWeaknessProfile,
  type FocusSound,
  type PriorityWeights,
  type EwmaConfig,
  type FocusObservation,
  type PendingDiagnosticSession,
  type DiagnosticPromptSet,
} from "../training";
import { createNonEmptyList } from "../shared";

// ---- テストフィクスチャ ----

const makeWeights = (w1 = 0.4, w2 = 0.3, w3 = 0.3): PriorityWeights => ({ w1, w2, w3 });

const makeContrast = (value = "/l/-/r/") => {
  const contrast = createPhonemeContrast(value);
  if (!contrast) throw new Error(`null PhonemeContrast: ${value}`);
  return contrast;
};

const makeCatalogId = (value = "cat-001") => {
  const id = createCatalogId(value);
  if (!id) throw new Error(`null CatalogId: ${value}`);
  return id;
};

const makeOccurrenceFrequency = (value = 0.5) => {
  const result = createOccurrenceFrequency(value);
  if (result.isErr()) throw new Error(`invalid OccurrenceFrequency: ${value}`);
  return result.value;
};

const makeMastery = (value = 0.5) => {
  const result = createMastery0To1(value);
  if (result.isErr()) throw new Error(`invalid Mastery0To1: ${value}`);
  return result.value;
};

const makePriority = (value = 0.5) => {
  const result = createPriorityScore(value);
  if (result.isErr()) throw new Error(`invalid PriorityScore: ${value}`);
  return result.value;
};

const makeFocusSound = (overrides?: Partial<FocusSound>): FocusSound => ({
  contrast: makeContrast("/l/-/r/"),
  catalogId: makeCatalogId("cat-001"),
  functionalLoadRank: "high",
  occurrenceFrequency: makeOccurrenceFrequency(0.5),
  mastery: makeMastery(0.5),
  priority: makePriority(0.5),
  ...overrides,
});

const makeProfileIdentifier = (value = "WP-001") => {
  const id = createWeaknessProfileIdentifier(value);
  if (!id) throw new Error(`null WeaknessProfileIdentifier`);
  return id;
};

const makeLearner = (value = "learner-001") => {
  const id = createLearnerIdentifier(value);
  if (!id) throw new Error(`null LearnerIdentifier`);
  return id;
};

const makeDiagnosticSessionIdentifier = (value = "DS-001") => {
  const id = createDiagnosticSessionIdentifier(value);
  if (!id) throw new Error(`null DiagnosticSessionIdentifier`);
  return id;
};

const makePendingSession = (): PendingDiagnosticSession => {
  const promptSet: DiagnosticPromptSet = {
    prompts: [{ identifier: "p1", text: "test", targetCatalogId: null, phenomenon: "segmental" }],
  };
  return {
    type: "pending",
    identifier: makeDiagnosticSessionIdentifier(),
    learner: makeLearner(),
    promptSet,
    startedAt: new Date("2026-01-01T00:00:00Z"),
  };
};

// ---- recomputeFocusPriority ----

describe("recomputeFocusPriority", () => {
  it("priority = w1·normalizedFLRank + w2·occurrenceFrequency + w3·(1-mastery) で計算される", () => {
    // high FL rank = 0.75, occurrence = 0.5, mastery = 0.5
    // priority = 0.4*0.75 + 0.3*0.5 + 0.3*(1-0.5) = 0.3 + 0.15 + 0.15 = 0.6
    const sound = makeFocusSound({
      functionalLoadRank: "high",
      occurrenceFrequency: makeOccurrenceFrequency(0.5),
      mastery: makeMastery(0.5),
    });
    const weights = makeWeights(0.4, 0.3, 0.3);

    const result = recomputeFocusPriority(sound, weights);

    expect(result.isOk()).toBe(true);
    const updated = result._unsafeUnwrap();
    expect(Number(updated.priority)).toBeCloseTo(0.6, 5);
  });

  it("mastery が高いほど priority が低くなる（w3 項の寄与が減る）", () => {
    const weights = makeWeights(0.4, 0.3, 0.3);
    const lowMasterySound = makeFocusSound({ mastery: makeMastery(0.1) });
    const highMasterySound = makeFocusSound({ mastery: makeMastery(0.9) });

    const lowResult = recomputeFocusPriority(lowMasterySound, weights);
    const highResult = recomputeFocusPriority(highMasterySound, weights);

    expect(lowResult.isOk()).toBe(true);
    expect(highResult.isOk()).toBe(true);
    expect(Number(lowResult._unsafeUnwrap().priority)).toBeGreaterThan(
      Number(highResult._unsafeUnwrap().priority),
    );
  });

  it("occurrenceFrequency が高いほど priority が高くなる（w2 項の寄与が増える）", () => {
    const weights = makeWeights(0.4, 0.3, 0.3);
    const lowFreqSound = makeFocusSound({ occurrenceFrequency: makeOccurrenceFrequency(0.1) });
    const highFreqSound = makeFocusSound({ occurrenceFrequency: makeOccurrenceFrequency(0.9) });

    const lowResult = recomputeFocusPriority(lowFreqSound, weights);
    const highResult = recomputeFocusPriority(highFreqSound, weights);

    expect(lowResult.isOk()).toBe(true);
    expect(highResult.isOk()).toBe(true);
    expect(Number(highResult._unsafeUnwrap().priority)).toBeGreaterThan(
      Number(lowResult._unsafeUnwrap().priority),
    );
  });

  it("FL ランクの順序: max > high > mid > low で priority に反映される", () => {
    const weights = makeWeights(1.0, 0.0, 0.0);
    const makeSoundWithRank = (rank: FocusSound["functionalLoadRank"]) =>
      makeFocusSound({ functionalLoadRank: rank });

    const maxResult = recomputeFocusPriority(makeSoundWithRank("max"), weights);
    const highResult = recomputeFocusPriority(makeSoundWithRank("high"), weights);
    const midResult = recomputeFocusPriority(makeSoundWithRank("mid"), weights);
    const lowResult = recomputeFocusPriority(makeSoundWithRank("low"), weights);

    const maxP = Number(maxResult._unsafeUnwrap().priority);
    const highP = Number(highResult._unsafeUnwrap().priority);
    const midP = Number(midResult._unsafeUnwrap().priority);
    const lowP = Number(lowResult._unsafeUnwrap().priority);

    expect(maxP).toBeGreaterThan(highP);
    expect(highP).toBeGreaterThan(midP);
    expect(midP).toBeGreaterThan(lowP);
  });

  it("FocusSound の他フィールドは変更されない", () => {
    const sound = makeFocusSound();
    const result = recomputeFocusPriority(sound, makeWeights());

    expect(result.isOk()).toBe(true);
    const updated = result._unsafeUnwrap();
    expect(updated.contrast).toBe(sound.contrast);
    expect(updated.catalogId).toBe(sound.catalogId);
    expect(updated.functionalLoadRank).toBe(sound.functionalLoadRank);
    expect(updated.occurrenceFrequency).toBe(sound.occurrenceFrequency);
    expect(updated.mastery).toBe(sound.mastery);
  });
});

// ---- initializeWeaknessProfile ----

describe("initializeWeaknessProfile", () => {
  it("focusSounds が1件あれば WeaknessProfile が生成される（DD-201不変条件）", () => {
    const sounds = [makeFocusSound()];
    const result = initializeWeaknessProfile(
      makeProfileIdentifier(),
      makeLearner(),
      makeDiagnosticSessionIdentifier(),
      sounds,
      makeWeights(),
      new Date("2026-01-01T00:00:00Z"),
    );

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.profile.focusSounds).toHaveLength(1);
    expect(output.events).toHaveLength(1);
    expect(output.events[0].type).toBe("weaknessProfileInitialized");
  });

  it("focusSounds が空のとき validationFailed エラーを返す（DD-201不変条件1）", () => {
    const result = initializeWeaknessProfile(
      makeProfileIdentifier(),
      makeLearner(),
      makeDiagnosticSessionIdentifier(),
      [],
      makeWeights(),
      new Date("2026-01-01T00:00:00Z"),
    );

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe("validationFailed");
    if (error.type !== "validationFailed") throw new Error("expected validationFailed");
    expect(error.field).toBe("focusSounds");
  });

  it("複数の focusSounds が priority 降順でソートされる", () => {
    // sound-low: FL=low(0.25), freq=0.1, mastery=0.9  → priority≈0.4*0.25+0.3*0.1+0.3*0.1 = 0.1+0.03+0.03 = 0.16
    // sound-high: FL=max(1.0), freq=0.9, mastery=0.1 → priority≈0.4*1.0+0.3*0.9+0.3*0.9 = 0.4+0.27+0.27 = 0.94
    const soundLow = makeFocusSound({
      contrast: makeContrast("/p/-/b/"),
      catalogId: makeCatalogId("cat-low"),
      functionalLoadRank: "low",
      occurrenceFrequency: makeOccurrenceFrequency(0.1),
      mastery: makeMastery(0.9),
    });
    const soundHigh = makeFocusSound({
      contrast: makeContrast("/l/-/r/"),
      catalogId: makeCatalogId("cat-high"),
      functionalLoadRank: "max",
      occurrenceFrequency: makeOccurrenceFrequency(0.9),
      mastery: makeMastery(0.1),
    });

    const result = initializeWeaknessProfile(
      makeProfileIdentifier(),
      makeLearner(),
      makeDiagnosticSessionIdentifier(),
      [soundLow, soundHigh],
      makeWeights(0.4, 0.3, 0.3),
      new Date("2026-01-01T00:00:00Z"),
    );

    expect(result.isOk()).toBe(true);
    const { focusSounds } = result._unsafeUnwrap().profile;
    // 最初の要素が最高 priority であること
    expect(Number(focusSounds[0].priority)).toBeGreaterThan(Number(focusSounds[1].priority));
    expect(String(focusSounds[0].catalogId)).toBe("cat-high");
  });

  it("WeaknessProfile の identifier / learner / diagnosticSession が引数通りに設定される", () => {
    const profileId = makeProfileIdentifier("WP-XYZ");
    const learner = makeLearner("learner-XYZ");
    const sessionId = makeDiagnosticSessionIdentifier("DS-XYZ");

    const result = initializeWeaknessProfile(
      profileId,
      learner,
      sessionId,
      [makeFocusSound()],
      makeWeights(),
      new Date(),
    );

    expect(result.isOk()).toBe(true);
    const { profile } = result._unsafeUnwrap();
    expect(String(profile.identifier)).toBe("WP-XYZ");
    expect(String(profile.learner)).toBe("learner-XYZ");
    expect(String(profile.diagnosticSession)).toBe("DS-XYZ");
  });
});

// ---- completeDiagnosticSession ----

describe("completeDiagnosticSession", () => {
  it("pending セッションが completed に遷移する", () => {
    const session = makePendingSession();
    const focusSound = makeFocusSound();
    const profile = {
      identifier: makeProfileIdentifier(),
      learner: makeLearner(),
      diagnosticSession: makeDiagnosticSessionIdentifier(),
      focusSounds: createNonEmptyList([focusSound])!,
      lastUpdatedAt: new Date(),
      createdAt: new Date(),
    };
    // AssessmentResultIdentifier は branded string
    const assessmentResultId = "AR-001" as Parameters<typeof completeDiagnosticSession>[1][number];
    const nonEmptyResults = createNonEmptyList([assessmentResultId])!;

    const result = completeDiagnosticSession(
      session,
      nonEmptyResults,
      profile,
      new Date("2026-01-01T01:00:00Z"),
    );

    expect(result.isOk()).toBe(true);
    const output = result._unsafeUnwrap();
    expect(output.session.type).toBe("completed");
    expect(output.session.identifier).toBe(session.identifier);
    expect(output.events).toHaveLength(1);
    expect(output.events[0].type).toBe("diagnosticSessionCompleted");
  });

  it("completedAt が引数の now に設定される", () => {
    const session = makePendingSession();
    const now = new Date("2026-06-01T12:00:00Z");
    const profile = {
      identifier: makeProfileIdentifier(),
      learner: makeLearner(),
      diagnosticSession: makeDiagnosticSessionIdentifier(),
      focusSounds: createNonEmptyList([makeFocusSound()])!,
      lastUpdatedAt: now,
      createdAt: now,
    };
    const assessmentResultId = "AR-001" as Parameters<typeof completeDiagnosticSession>[1][number];
    const nonEmptyResults = createNonEmptyList([assessmentResultId])!;

    const result = completeDiagnosticSession(session, nonEmptyResults, profile, now);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().session.completedAt).toEqual(now);
  });
});

// ---- updateWeaknessProfile ----

describe("updateWeaknessProfile", () => {
  const makeProfile = (sounds: FocusSound[]) => ({
    identifier: makeProfileIdentifier(),
    learner: makeLearner(),
    diagnosticSession: makeDiagnosticSessionIdentifier(),
    focusSounds: createNonEmptyList(sounds)!,
    lastUpdatedAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
  });

  const makeEwmaConfig = (alpha = 0.3): EwmaConfig => ({ alpha });

  it("対象の contrast の occurrenceFrequency と mastery が EWMA 更新される", () => {
    const contrast = makeContrast("/l/-/r/");
    const sound = makeFocusSound({
      contrast,
      occurrenceFrequency: makeOccurrenceFrequency(0.5),
      mastery: makeMastery(0.5),
    });
    const profile = makeProfile([sound]);
    const observation: FocusObservation = {
      contrast,
      observedOccurrenceFrequency: 1.0,
      observedMastery: 0.8,
    };
    const alpha = 0.3;
    // 期待値: freq = 0.3*1.0 + 0.7*0.5 = 0.65, mastery = 0.3*0.8 + 0.7*0.5 = 0.59
    const result = updateWeaknessProfile(
      profile,
      observation,
      makeEwmaConfig(alpha),
      makeWeights(),
      new Date(),
    );

    expect(result.isOk()).toBe(true);
    const updated = result._unsafeUnwrap().profile.focusSounds[0];
    expect(Number(updated.occurrenceFrequency)).toBeCloseTo(0.65, 5);
    expect(Number(updated.mastery)).toBeCloseTo(0.59, 5);
  });

  it("対象でない contrast の FocusSound は変更されない", () => {
    const targetContrast = makeContrast("/l/-/r/");
    const otherContrast = makeContrast("/v/-/b/");
    const targetSound = makeFocusSound({
      contrast: targetContrast,
      catalogId: makeCatalogId("cat-target"),
      occurrenceFrequency: makeOccurrenceFrequency(0.5),
      mastery: makeMastery(0.5),
    });
    const otherSound = makeFocusSound({
      contrast: otherContrast,
      catalogId: makeCatalogId("cat-other"),
      occurrenceFrequency: makeOccurrenceFrequency(0.3),
      mastery: makeMastery(0.7),
    });
    const profile = makeProfile([targetSound, otherSound]);
    const observation: FocusObservation = {
      contrast: targetContrast,
      observedOccurrenceFrequency: 1.0,
      observedMastery: 1.0,
    };

    const result = updateWeaknessProfile(
      profile,
      observation,
      makeEwmaConfig(0.3),
      makeWeights(),
      new Date(),
    );

    expect(result.isOk()).toBe(true);
    const updatedSounds = result._unsafeUnwrap().profile.focusSounds;
    const otherInResult = updatedSounds.find((s) => s.contrast === otherContrast);
    expect(otherInResult).toBeDefined();
    expect(Number(otherInResult!.occurrenceFrequency)).toBeCloseTo(0.3, 5);
    expect(Number(otherInResult!.mastery)).toBeCloseTo(0.7, 5);
  });

  it("更新後に WeaknessProfileUpdated イベントが発行される", () => {
    const sound = makeFocusSound();
    const profile = makeProfile([sound]);
    const observation: FocusObservation = {
      contrast: sound.contrast,
      observedOccurrenceFrequency: 0.8,
      observedMastery: 0.6,
    };

    const result = updateWeaknessProfile(
      profile,
      observation,
      makeEwmaConfig(0.3),
      makeWeights(),
      new Date(),
    );

    expect(result.isOk()).toBe(true);
    const { events } = result._unsafeUnwrap();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("weaknessProfileUpdated");
  });

  it("lastUpdatedAt が引数の now に更新される", () => {
    const now = new Date("2026-06-13T10:00:00Z");
    const sound = makeFocusSound();
    const profile = makeProfile([sound]);
    const observation: FocusObservation = {
      contrast: sound.contrast,
      observedOccurrenceFrequency: 0.5,
      observedMastery: 0.5,
    };

    const result = updateWeaknessProfile(
      profile,
      observation,
      makeEwmaConfig(0.3),
      makeWeights(),
      now,
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().profile.lastUpdatedAt).toEqual(now);
  });
});
