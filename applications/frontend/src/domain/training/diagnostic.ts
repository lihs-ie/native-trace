/**
 * DiagnosticSession + WeaknessProfile Aggregate — domain layer
 *
 * 設計の正: docs/03-detailed-design/domain.md §14 (DD-200/201/260-263)
 *          docs/specs/diagnostic-screen.md M-DG-1/3/4
 *          adr/010-diagnostic-weakness-profile-focus-derivation.md (重み/α はconfig由来)
 *
 * domain 純粋性: I/O なし、class 構文禁止、数値 literal 禁止 (DD-293)
 * 他 BC 参照: AssessmentResultIdentifier を識別子のみで参照
 */

import { err, ok } from "neverthrow";
import { type Result } from "neverthrow";
import {
  type Brand,
  type DomainError,
  type NonEmptyList,
  createNonEmptyBrandedString,
  createNonEmptyList,
  validationFailed,
} from "../shared";
import { type AssessmentResultIdentifier } from "../assessment-result";
import { type FunctionalLoadRank } from "../error-catalog";

// ---- Branded types ----

export type DiagnosticSessionIdentifier = Brand<string, "DiagnosticSessionIdentifier">;
export type WeaknessProfileIdentifier = Brand<string, "WeaknessProfileIdentifier">;
export type LearnerIdentifier = Brand<string, "LearnerIdentifier">;

/** 音素対立文字列（例: "/l/-/r/"） */
export type PhonemeContrast = Brand<string, "PhonemeContrast">;

/** japanese-l1-catalog.json の id フィールドに対応する識別子 */
export type CatalogId = Brand<string, "CatalogId">;

/** 解析横断での誤りの観測率（0以上） */
export type OccurrenceFrequency = Brand<number, "OccurrenceFrequency">;

/** 対立別習熟度推定（0以上1以下） */
export type Mastery0To1 = Brand<number, "Mastery0To1">;

/** 三項合成で導出される優先度スコア */
export type PriorityScore = Brand<number, "PriorityScore">;

// ---- Smart Constructors ----

export const createDiagnosticSessionIdentifier = (
  value: string,
): DiagnosticSessionIdentifier | null =>
  createNonEmptyBrandedString<DiagnosticSessionIdentifier>(value);

export const createWeaknessProfileIdentifier = (value: string): WeaknessProfileIdentifier | null =>
  createNonEmptyBrandedString<WeaknessProfileIdentifier>(value);

export const createLearnerIdentifier = (value: string): LearnerIdentifier | null =>
  createNonEmptyBrandedString<LearnerIdentifier>(value);

export const createPhonemeContrast = (value: string): PhonemeContrast | null =>
  createNonEmptyBrandedString<PhonemeContrast>(value);

export const createCatalogId = (value: string): CatalogId | null =>
  createNonEmptyBrandedString<CatalogId>(value);

export const createOccurrenceFrequency = (
  value: number,
): Result<OccurrenceFrequency, DomainError> => {
  if (value < 0) {
    return err(validationFailed("occurrenceFrequency", "観測率は0以上である必要があります"));
  }
  return ok(value as OccurrenceFrequency);
};

export const createMastery0To1 = (value: number): Result<Mastery0To1, DomainError> => {
  if (value < 0 || value > 1) {
    return err(validationFailed("mastery", "習熟度は0以上1以下である必要があります"));
  }
  return ok(value as Mastery0To1);
};

export const createPriorityScore = (value: number): Result<PriorityScore, DomainError> => {
  if (value < 0) {
    return err(validationFailed("priority", "優先度スコアは0以上である必要があります"));
  }
  return ok(value as PriorityScore);
};

// ---- FocusSound 値オブジェクト ----

/**
 * FocusSound — いま直すべき音の値オブジェクト（DD-201参照）
 *
 * priority は三項合成 w1·normalizedFLRank + w2·occurrenceFrequency + w3·(1−mastery)
 * で導出する。ドメインに重み定数を埋め込まない（DD-293）。
 */
export type FocusSound = Readonly<{
  contrast: PhonemeContrast;
  catalogId: CatalogId;
  functionalLoadRank: FunctionalLoadRank;
  occurrenceFrequency: OccurrenceFrequency;
  mastery: Mastery0To1;
  priority: PriorityScore;
}>;

// ---- DiagnosticPromptSet 値オブジェクト ----

/**
 * DiagnosticPromptSet — カタログ高FL対立・母音挿入・韻律を網羅する読み上げ課題セット (DD-232)
 */
export type DiagnosticPrompt = Readonly<{
  identifier: string;
  text: string;
  targetCatalogId: CatalogId | null;
  phenomenon: "segmental" | "epenthesis" | "prosodic";
}>;

export type DiagnosticPromptSet = Readonly<{
  prompts: NonEmptyList<DiagnosticPrompt>;
}>;

// ---- DiagnosticSession 集約 (DD-200) ----

export type PendingDiagnosticSession = Readonly<{
  type: "pending";
  identifier: DiagnosticSessionIdentifier;
  learner: LearnerIdentifier;
  promptSet: DiagnosticPromptSet;
  startedAt: Date;
}>;

export type CompletedDiagnosticSession = Readonly<{
  type: "completed";
  identifier: DiagnosticSessionIdentifier;
  learner: LearnerIdentifier;
  promptSet: DiagnosticPromptSet;
  assessmentResults: NonEmptyList<AssessmentResultIdentifier>;
  weaknessProfile: WeaknessProfileIdentifier;
  startedAt: Date;
  completedAt: Date;
}>;

export type DiagnosticSession = PendingDiagnosticSession | CompletedDiagnosticSession;

// ---- WeaknessProfile 集約 (DD-201) ----

export type WeaknessProfile = Readonly<{
  identifier: WeaknessProfileIdentifier;
  learner: LearnerIdentifier;
  diagnosticSession: DiagnosticSessionIdentifier;
  focusSounds: NonEmptyList<FocusSound>;
  lastUpdatedAt: Date;
  createdAt: Date;
}>;

// ---- ドメインイベント (DD-281/282/283) ----

export type DiagnosticSessionCompleted = Readonly<{
  type: "diagnosticSessionCompleted";
  diagnosticSession: CompletedDiagnosticSession;
  weaknessProfile: WeaknessProfile;
  occurredAt: Date;
}>;

export type WeaknessProfileInitialized = Readonly<{
  type: "weaknessProfileInitialized";
  weaknessProfile: WeaknessProfile;
  diagnosticSession: DiagnosticSessionIdentifier;
  occurredAt: Date;
}>;

export type WeaknessProfileUpdated = Readonly<{
  type: "weaknessProfileUpdated";
  weaknessProfile: WeaknessProfile;
  occurredAt: Date;
}>;

// ---- ドメインサービス出力型 ----

export type CompleteDiagnosticSessionOutput = Readonly<{
  session: CompletedDiagnosticSession;
  events: NonEmptyList<DiagnosticSessionCompleted>;
}>;

export type InitializeWeaknessProfileOutput = Readonly<{
  profile: WeaknessProfile;
  events: NonEmptyList<WeaknessProfileInitialized>;
}>;

export type UpdateWeaknessProfileOutput = Readonly<{
  profile: WeaknessProfile;
  events: NonEmptyList<WeaknessProfileUpdated>;
}>;

// ---- config 由来の重み型 (DD-293: ドメインに literal 埋め込み禁止) ----

/**
 * PriorityWeights — focus priority 三項式の重み
 * w1: FLランク重み, w2: 出現頻度重み, w3: (1−習熟度)重み
 */
export type PriorityWeights = Readonly<{
  w1: number;
  w2: number;
  w3: number;
}>;

/**
 * EwmaConfig — EWMA 漸進更新の平滑化係数
 */
export type EwmaConfig = Readonly<{
  alpha: number;
}>;

/**
 * FocusObservation — EWMA 更新時の観測値
 */
export type FocusObservation = Readonly<{
  contrast: PhonemeContrast;
  observedOccurrenceFrequency: number;
  observedMastery: number;
}>;

// ---- FunctionalLoadRank 正規化 ----

/**
 * FUNCTIONAL_LOAD_RANK_SCORES — FLランク→0〜1の数値対応（max=1.0, high=0.75, mid=0.5, low=0.25）。
 * ドメインに literal を埋め込まず、normalizeFunctionalLoadRank だけがこの対応表を参照する。
 */
const FUNCTIONAL_LOAD_RANK_SCORES: Record<FunctionalLoadRank, number> = {
  max: 1.0,
  high: 0.75,
  mid: 0.5,
  low: 0.25,
};

/**
 * normalizeFunctionalLoadRank — FLランクを0〜1の数値に正規化する（max=1.0, high=0.75, mid=0.5, low=0.25）
 */
export const normalizeFunctionalLoadRank = (rank: FunctionalLoadRank): number =>
  FUNCTIONAL_LOAD_RANK_SCORES[rank];

// ---- ドメインサービス関数 ----

/**
 * recomputeFocusPriority (DD-262)
 *
 * priority = w1·normalizedFLRank + w2·occurrenceFrequency + w3·(1 − mastery)
 * 重みは config 由来の PriorityWeights で受け取る（DD-293: ドメインに literal 埋め込み禁止）。
 */
export const recomputeFocusPriority = (
  focusSound: FocusSound,
  weights: PriorityWeights,
): Result<FocusSound, DomainError> => {
  const normalizedFlRank = normalizeFunctionalLoadRank(focusSound.functionalLoadRank);
  const rawPriority =
    weights.w1 * normalizedFlRank +
    weights.w2 * Number(focusSound.occurrenceFrequency) +
    weights.w3 * (1 - Number(focusSound.mastery));

  const priorityResult = createPriorityScore(rawPriority);
  if (priorityResult.isErr()) {
    return err(priorityResult.error);
  }

  return ok({
    ...focusSound,
    priority: priorityResult.value,
  });
};

/**
 * initializeWeaknessProfile (DD-261)
 *
 * DiagnosticSession の findings を japanese-l1-catalog の confusionSet に射影し、
 * FocusSound 群を生成して WeaknessProfile を初期化する。
 *
 * OQ-5 初回初期化規則:
 * - occurrenceFrequency = 診断内の観測率（各 focusSound の観測回数 / 総観測機会）
 * - mastery = 診断スコアから推定（GOP スコア 0〜1 をそのまま使用）
 *   初回なので EWMA 履歴なし → 診断スコアを初期値として直接使用する。
 *   これにより三項式が一様化せず、高 FL 対立の誤りが上位に来る。
 */
export const initializeWeaknessProfile = (
  profileIdentifier: WeaknessProfileIdentifier,
  learner: LearnerIdentifier,
  diagnosticSession: DiagnosticSessionIdentifier,
  focusSounds: ReadonlyArray<FocusSound>,
  weights: PriorityWeights,
  now: Date,
): Result<InitializeWeaknessProfileOutput, DomainError> => {
  // priority を全 focusSound に対して再計算する
  const recomputedSounds: FocusSound[] = [];
  for (const focusSound of focusSounds) {
    const recomputedResult = recomputeFocusPriority(focusSound, weights);
    if (recomputedResult.isErr()) {
      return err(recomputedResult.error);
    }
    recomputedSounds.push(recomputedResult.value);
  }

  const nonEmptyFocusSounds = createNonEmptyList(recomputedSounds);
  if (nonEmptyFocusSounds === null) {
    return err(
      validationFailed(
        "focusSounds",
        "WeaknessProfile の focusSounds は空にできません (DD-201不変条件1)",
      ),
    );
  }

  // priority 降順でソートする
  // nonEmptyFocusSounds は非空が保証されているため、sort 後も非空が保たれる。
  // createNonEmptyList で安全に NonEmptyList を再構築する（`as` キャスト回避）。
  const sortedArray = [...nonEmptyFocusSounds].sort(
    (a, b) => Number(b.priority) - Number(a.priority),
  );
  const sortedSounds = createNonEmptyList(sortedArray)!;

  const profile: WeaknessProfile = {
    identifier: profileIdentifier,
    learner,
    diagnosticSession,
    focusSounds: sortedSounds,
    lastUpdatedAt: now,
    createdAt: now,
  };

  return ok({
    profile,
    events: [
      {
        type: "weaknessProfileInitialized",
        weaknessProfile: profile,
        diagnosticSession,
        occurredAt: now,
      },
    ],
  });
};

/**
 * completeDiagnosticSession (DD-260)
 *
 * PendingDiagnosticSession を完了状態に遷移し、WeaknessProfile 参照を確定する。
 */
export const completeDiagnosticSession = (
  session: PendingDiagnosticSession,
  assessmentResults: NonEmptyList<AssessmentResultIdentifier>,
  weaknessProfile: WeaknessProfile,
  now: Date,
): Result<CompleteDiagnosticSessionOutput, DomainError> => {
  if (session.type !== "pending") {
    return err(
      validationFailed("session", "診断セッションは pending 状態でなければ完了できません"),
    );
  }

  const completed: CompletedDiagnosticSession = {
    type: "completed",
    identifier: session.identifier,
    learner: session.learner,
    promptSet: session.promptSet,
    assessmentResults,
    weaknessProfile: weaknessProfile.identifier,
    startedAt: session.startedAt,
    completedAt: now,
  };

  return ok({
    session: completed,
    events: [
      {
        type: "diagnosticSessionCompleted",
        diagnosticSession: completed,
        weaknessProfile,
        occurredAt: now,
      },
    ],
  });
};

/**
 * updateWeaknessProfile (DD-263)
 *
 * EWMA で対立別の出現頻度と習熟度を漸進更新する。
 * profile_new = α·observation + (1 − α)·profile_old
 * α は config 由来の EwmaConfig で受け取る（DD-293）。
 */
export const updateWeaknessProfile = (
  profile: WeaknessProfile,
  observation: FocusObservation,
  ewmaConfig: EwmaConfig,
  weights: PriorityWeights,
  now: Date,
): Result<UpdateWeaknessProfileOutput, DomainError> => {
  const alpha = ewmaConfig.alpha;

  const updatedSounds: FocusSound[] = [];
  for (const focusSound of profile.focusSounds) {
    if (focusSound.contrast === observation.contrast) {
      // EWMA 更新
      const newOccurrenceFrequencyValue =
        alpha * observation.observedOccurrenceFrequency +
        (1 - alpha) * Number(focusSound.occurrenceFrequency);
      const newMasteryValue =
        alpha * observation.observedMastery + (1 - alpha) * Number(focusSound.mastery);

      const newOccurrenceFrequencyResult = createOccurrenceFrequency(newOccurrenceFrequencyValue);
      if (newOccurrenceFrequencyResult.isErr()) {
        return err(newOccurrenceFrequencyResult.error);
      }
      const newMasteryResult = createMastery0To1(Math.min(1, Math.max(0, newMasteryValue)));
      if (newMasteryResult.isErr()) {
        return err(newMasteryResult.error);
      }

      const updatedFocusSound: FocusSound = {
        ...focusSound,
        occurrenceFrequency: newOccurrenceFrequencyResult.value,
        mastery: newMasteryResult.value,
      };

      const recomputedResult = recomputeFocusPriority(updatedFocusSound, weights);
      if (recomputedResult.isErr()) {
        return err(recomputedResult.error);
      }
      updatedSounds.push(recomputedResult.value);
    } else {
      updatedSounds.push(focusSound);
    }
  }

  // priority 降順でソート
  // profile.focusSounds は非空が保証されているため updatedSounds も非空が保たれる。
  // createNonEmptyList で安全に NonEmptyList を再構築する（`as` キャスト回避）。
  const sortedNonEmpty = createNonEmptyList(
    updatedSounds.sort((a, b) => Number(b.priority) - Number(a.priority)),
  );
  if (sortedNonEmpty === null) {
    return err(
      validationFailed(
        "focusSounds",
        "WeaknessProfile の focusSounds は空にできません (DD-201不変条件1)",
      ),
    );
  }
  const sortedSounds = sortedNonEmpty;

  const updatedProfile: WeaknessProfile = {
    ...profile,
    focusSounds: sortedSounds,
    lastUpdatedAt: now,
  };

  return ok({
    profile: updatedProfile,
    events: [
      {
        type: "weaknessProfileUpdated",
        weaknessProfile: updatedProfile,
        occurredAt: now,
      },
    ],
  });
};
