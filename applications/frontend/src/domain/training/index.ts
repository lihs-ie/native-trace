/**
 * Training Context — domain layer
 *
 * 設計の正: docs/03-detailed-design/domain.md §14 (DD-200/201/260-263)
 *          docs/specs/diagnostic-screen.md M-DG-1/3/4
 *          adr/007-training-context-bounded-context.md (識別子のみ参照)
 *          adr/010-diagnostic-weakness-profile-focus-derivation.md (重み/α はconfig由来)
 *
 * domain 純粋性: I/O なし、class 構文禁止、数値 literal 禁止 (DD-293)
 * 他 BC 参照: AssessmentResultIdentifier / SectionIdentifier を識別子のみで参照
 */

import { err, ok } from "neverthrow";
import { type Result } from "neverthrow";
import {
  type DomainError,
  type NonEmptyList,
  createNonEmptyList,
  validationFailed,
  hoursToMilliseconds,
} from "../shared";
import {
  type AssessmentResultIdentifier,
  type Score0To100,
  createScore0To100,
} from "../assessment-result";
import { type FunctionalLoadRank } from "../error-catalog";
import { type SectionIdentifier } from "../section";

// ---- Branded types ----

declare const __brand: unique symbol;
type Brand<T, B> = T & { readonly [__brand]: B };

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
  value.trim().length > 0 ? (value as DiagnosticSessionIdentifier) : null;

export const createWeaknessProfileIdentifier = (value: string): WeaknessProfileIdentifier | null =>
  value.trim().length > 0 ? (value as WeaknessProfileIdentifier) : null;

export const createLearnerIdentifier = (value: string): LearnerIdentifier | null =>
  value.trim().length > 0 ? (value as LearnerIdentifier) : null;

export const createPhonemeContrast = (value: string): PhonemeContrast | null =>
  value.trim().length > 0 ? (value as PhonemeContrast) : null;

export const createCatalogId = (value: string): CatalogId | null =>
  value.trim().length > 0 ? (value as CatalogId) : null;

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

// ============================================================
// ProgressSnapshot Aggregate (DD-205)
// ============================================================

// ---- Branded types (ProgressSnapshot) ----

export type ProgressSnapshotIdentifier = Brand<string, "ProgressSnapshotIdentifier">;

export const createProgressSnapshotIdentifier = (
  value: string,
): ProgressSnapshotIdentifier | null =>
  value.trim().length > 0 ? (value as ProgressSnapshotIdentifier) : null;

// ---- ControlledTaskKind (DD-250) ----

/**
 * ControlledTaskKind — 統制課題種別 (rereading / drill のみ)
 * 自発タスクからはスナップショットを作らない (ADR-008, E-2)
 */
export type ControlledTaskKind = "rereading" | "drill";

export const createControlledTaskKind = (value: string): ControlledTaskKind | null => {
  if (value === "rereading" || value === "drill") return value;
  return null;
};

// ---- CefrSubscaleScores (DD-251) ----

/**
 * CefrSubscaleScores — CEFR 音韻統制 3 下位尺度
 * overall / segmental / prosodic をすべて持つ (不変条件 2)
 */
export type CefrSubscaleScores = Readonly<{
  overall: Score0To100;
  segmental: Score0To100;
  prosodic: Score0To100;
}>;

export const createCefrSubscaleScores = (
  overall: number,
  segmental: number,
  prosodic: number,
): Result<CefrSubscaleScores, DomainError> => {
  const overallResult = createScore0To100(overall);
  if (overallResult.isErr()) return err(overallResult.error);
  const segmentalResult = createScore0To100(segmental);
  if (segmentalResult.isErr()) return err(segmentalResult.error);
  const prosodicResult = createScore0To100(prosodic);
  if (prosodicResult.isErr()) return err(prosodicResult.error);
  return ok({
    overall: overallResult.value,
    segmental: segmentalResult.value,
    prosodic: prosodicResult.value,
  });
};

// ---- FocusScore (DD-252) ----

/**
 * FocusScore — focus sound 別スコアの時系列点
 * contrast と 0–100 整数スコアのペア
 */
export type FocusScore = Readonly<{
  contrast: PhonemeContrast;
  score: Score0To100;
}>;

export const createFocusScore = (
  contrast: string,
  score: number,
): Result<FocusScore, DomainError> => {
  const contrastBranded = createPhonemeContrast(contrast);
  if (!contrastBranded) {
    return err(validationFailed("contrast", "FocusScore の contrast は空にできません"));
  }
  const scoreResult = createScore0To100(score);
  if (scoreResult.isErr()) return err(scoreResult.error);
  return ok({ contrast: contrastBranded, score: scoreResult.value });
};

// ---- CumulativeTrainingMinutes (DD-253) ----

/**
 * CumulativeTrainingMinutes — 累計訓練時間 (0 以上の整数)
 * TrainingSession.durationMinutes の累計。未実装時は 0 (honest empty)
 */
export type CumulativeTrainingMinutes = Brand<number, "CumulativeTrainingMinutes">;

export const createCumulativeTrainingMinutes = (
  value: number,
): Result<CumulativeTrainingMinutes, DomainError> => {
  if (!Number.isInteger(value) || value < 0) {
    return err(
      validationFailed(
        "cumulativeTrainingMinutes",
        "累計訓練時間は0以上の整数である必要があります",
      ),
    );
  }
  return ok(value as CumulativeTrainingMinutes);
};

// ---- ProgressSnapshot Aggregate (DD-205) ----

/**
 * ProgressSnapshot — 統制課題に限定した進捗スナップショット (DD-205)
 * 作成後不変 (updated_at を持たない)
 *
 * section / sourceAssessment は PPC 識別子参照 (ADR-007 識別子のみ結合)
 */
export type ProgressSnapshot = Readonly<{
  identifier: ProgressSnapshotIdentifier;
  learner: LearnerIdentifier;
  /**
   * PPC の Section または DiagnosticSession 識別子。
   * 訓練由来スナップショット (HVPT 等) は AssessmentResult を持たないため null を許容する (DD-205)。
   */
  section: SectionIdentifier | null;
  /**
   * assessment_results への FK 参照識別子。
   * 訓練由来スナップショット (HVPT 等) は AssessmentResult を持たないため null を許容する (DD-205)。
   */
  sourceAssessment: AssessmentResultIdentifier | null;
  taskKind: ControlledTaskKind;
  cefrScores: CefrSubscaleScores;
  focusScores: NonEmptyList<FocusScore>;
  cumulativeTrainingMinutes: CumulativeTrainingMinutes;
  capturedAt: Date;
}>;

// ---- ドメインイベント (DD-289) ----

export type ProgressSnapshotCaptured = Readonly<{
  type: "progressSnapshotCaptured";
  progressSnapshot: ProgressSnapshot;
  section: SectionIdentifier | null;
  sourceAssessment: AssessmentResultIdentifier | null;
  occurredAt: Date;
}>;

// ============================================================
// TrainingSession Aggregate (DD-202)
// ============================================================

// ---- Branded types (TrainingSession) ----

export type TrainingSessionIdentifier = Brand<string, "TrainingSessionIdentifier">;

export const createTrainingSessionIdentifier = (value: string): TrainingSessionIdentifier | null =>
  value.trim().length > 0 ? (value as TrainingSessionIdentifier) : null;

// ---- TrainingKind (DD-202) ----

export type TrainingKind = "hvpt_identification" | "production_drill" | "shadowing";

export const createTrainingKind = (value: string): TrainingKind | null => {
  if (value === "hvpt_identification" || value === "production_drill" || value === "shadowing") {
    return value;
  }
  return null;
};

// ---- TrainingDurationMinutes (DD-241) ----
// 1 セッションは 1 分以上 30 分以下（ADR-011 sessionCutoffAt20To30Minutes）。
// 上限値はドメイン literal ではなく SpacingSchedulerConfig 経由で受け取る（DD-293）。

export type TrainingDurationMinutes = Brand<number, "TrainingDurationMinutes">;

export const createTrainingDurationMinutes = (
  value: number,
  maxDurationMinutes: number,
): Result<TrainingDurationMinutes, DomainError> => {
  if (!Number.isInteger(value) || value < 1 || value > maxDurationMinutes) {
    return err(
      validationFailed(
        "durationMinutes",
        `訓練時間は1以上${maxDurationMinutes}以下の整数である必要があります (DD-241)`,
      ),
    );
  }
  return ok(value as TrainingDurationMinutes);
};

// ---- Accuracy0To1 (DD-242) ----

export type Accuracy0To1 = Brand<number, "Accuracy0To1">;

export const createAccuracy0To1 = (value: number): Result<Accuracy0To1, DomainError> => {
  if (value < 0 || value > 1) {
    return err(validationFailed("accuracy", "正答率は0以上1以下である必要があります (DD-242)"));
  }
  return ok(value as Accuracy0To1);
};

// ---- TrainingSession Choice Type (DD-202) ----

export type InProgressTrainingSession = Readonly<{
  type: "in_progress";
  identifier: TrainingSessionIdentifier;
  learner: LearnerIdentifier;
  kind: TrainingKind;
  contrast: PhonemeContrast;
  startedAt: Date;
}>;

export type CompletedTrainingSession = Readonly<{
  type: "completed";
  identifier: TrainingSessionIdentifier;
  learner: LearnerIdentifier;
  kind: TrainingKind;
  contrast: PhonemeContrast;
  startedAt: Date;
  endedAt: Date;
  durationMinutes: TrainingDurationMinutes;
  sessionAccuracy: Accuracy0To1 | null;
}>;

export type AbortedTrainingSession = Readonly<{
  type: "aborted";
  identifier: TrainingSessionIdentifier;
  learner: LearnerIdentifier;
  kind: TrainingKind;
  contrast: PhonemeContrast;
  startedAt: Date;
  abortedAt: Date;
}>;

export type TrainingSession =
  | InProgressTrainingSession
  | CompletedTrainingSession
  | AbortedTrainingSession;

// ---- TrainingSession domain events (DD-284/285/286) ----

export type TrainingSessionCompleted = Readonly<{
  type: "trainingSessionCompleted";
  trainingSession: CompletedTrainingSession;
  durationMinutes: TrainingDurationMinutes;
  sessionAccuracy: Accuracy0To1 | null;
  occurredAt: Date;
}>;

// ---- CompleteTrainingSessionOutput (DD-264) ----

export type CompleteTrainingSessionOutput = Readonly<{
  session: CompletedTrainingSession;
  events: NonEmptyList<TrainingSessionCompleted>;
}>;

// ---- SpacingSchedulerConfig — config 由来の確定値 (DD-293 / ADR-011) ----
// 24h / 60% / 20-30分は REQ-127 由来の固定値。ドメインに literal 埋め込み禁止。

export type SpacingSchedulerConfig = Readonly<{
  /** spacingIntervalHours: 次回提示までの間隔時間（デフォルト 24h）。REQ-127 由来。 */
  spacingIntervalHours: number;
  /** masteryGateThreshold: 60% 正答率ゲート（0以上1以下）。REQ-127 由来。 */
  masteryGateThreshold: number;
  /** sessionCutoffMinutesMax: 1セッション最大分数（デフォルト 30）。REQ-127 由来。 */
  sessionCutoffMinutesMax: number;
  /** sessionCutoffMinutesMin: 1セッション最小分数（デフォルト 20）。REQ-127 由来。 */
  sessionCutoffMinutesMin: number;
  /** gateRetryIntervalHours: gate 状態での短間隔再提示時間（デフォルト 6h）。ADR-011 由来。 */
  gateRetryIntervalHours: number;
}>;

// ---- completeTrainingSession (DD-264) ----

/**
 * completeTrainingSession — InProgressTrainingSession を完了状態に遷移する (DD-264)。
 * 不変条件 2: durationMinutes は 1 以上 sessionCutoffMinutesMax 以下。
 * sessionAccuracy は HVPT セッションでは HvptTrial 正誤から算出（computeSessionAccuracy で導出）、
 * シャドーイングでは null 可（REQ-125）。
 */
export const completeTrainingSession = (
  session: InProgressTrainingSession,
  durationMinutes: number,
  sessionAccuracy: Accuracy0To1 | null,
  schedulerConfig: SpacingSchedulerConfig,
  now: Date,
): Result<CompleteTrainingSessionOutput, DomainError> => {
  const durationResult = createTrainingDurationMinutes(
    durationMinutes,
    schedulerConfig.sessionCutoffMinutesMax,
  );
  if (durationResult.isErr()) return err(durationResult.error);

  const completed: CompletedTrainingSession = {
    type: "completed",
    identifier: session.identifier,
    learner: session.learner,
    kind: session.kind,
    contrast: session.contrast,
    startedAt: session.startedAt,
    endedAt: now,
    durationMinutes: durationResult.value,
    sessionAccuracy,
  };

  return ok({
    session: completed,
    events: [
      {
        type: "trainingSessionCompleted",
        trainingSession: completed,
        durationMinutes: durationResult.value,
        sessionAccuracy,
        occurredAt: now,
      },
    ],
  });
};

// ============================================================
// HvptTrial Aggregate (DD-203)
// ============================================================

// ---- Branded types (HvptTrial) ----

export type HvptTrialIdentifier = Brand<string, "HvptTrialIdentifier">;
export type StimulusIdentifier = Brand<string, "StimulusIdentifier">;
export type ReactionTime = Brand<number, "ReactionTime">;

export const createHvptTrialIdentifier = (value: string): HvptTrialIdentifier | null =>
  value.trim().length > 0 ? (value as HvptTrialIdentifier) : null;

export const createStimulusIdentifier = (value: string): StimulusIdentifier | null =>
  value.trim().length > 0 ? (value as StimulusIdentifier) : null;

export const createReactionTime = (value: number): Result<ReactionTime, DomainError> => {
  if (!Number.isInteger(value) || value <= 0) {
    return err(
      validationFailed(
        "reactionTimeMilliseconds",
        "反応時間は0より大きい整数である必要があります (DD-246)",
      ),
    );
  }
  return ok(value as ReactionTime);
};

// ---- ResponseLabel (DD-245) ----
// 綴り / キーワード / IPA の Choice Type。画像ラベルは取らない (DD-295)。

export type ResponseLabel =
  | Readonly<{ type: "spelling"; value: string }>
  | Readonly<{ type: "keyword"; value: string }>
  | Readonly<{ type: "ipa"; value: string }>;

export const createResponseLabel = (
  type: string,
  value: string,
): Result<ResponseLabel, DomainError> => {
  if (value.trim().length === 0) {
    return err(validationFailed("responseLabel", "ResponseLabel の value は空にできません"));
  }
  if (type === "spelling" || type === "keyword" || type === "ipa") {
    return ok({ type, value } as ResponseLabel);
  }
  return err(
    validationFailed(
      "responseLabel",
      "ResponseLabel の type は spelling / keyword / ipa のいずれかである必要があります (DD-295)",
    ),
  );
};

// ---- HvptTrial Aggregate (DD-203) ----

export type HvptTrial = Readonly<{
  identifier: HvptTrialIdentifier;
  trainingSession: TrainingSessionIdentifier;
  stimulus: StimulusIdentifier;
  contrast: PhonemeContrast;
  correctLabel: ResponseLabel;
  response: ResponseLabel;
  correct: boolean;
  reactionTimeMilliseconds: ReactionTime;
  presentedAt: Date;
}>;

// ---- HvptTrial domain event (DD-287) ----

export type HvptTrialRecorded = Readonly<{
  type: "hvptTrialRecorded";
  hvptTrial: HvptTrial;
  trainingSession: TrainingSessionIdentifier;
  correct: boolean;
  occurredAt: Date;
}>;

// ---- RecordHvptTrialCommand / Output ----

export type RecordHvptTrialCommand = Readonly<{
  identifier: HvptTrialIdentifier;
  trainingSession: TrainingSessionIdentifier;
  stimulus: StimulusIdentifier;
  contrast: PhonemeContrast;
  correctLabel: ResponseLabel;
  response: ResponseLabel;
  reactionTimeMilliseconds: number;
  presentedAt: Date;
}>;

export type RecordHvptTrialOutput = Readonly<{
  trial: HvptTrial;
  events: NonEmptyList<HvptTrialRecorded>;
}>;

/**
 * recordHvptTrial (DD-265)
 *
 * 識別試行の正誤・反応時間を記録する。
 * 不変条件 1: correct は correctLabel と response の一致から導出する（DD-203）。
 * 不変条件 3: reactionTimeMilliseconds > 0。
 */
export const recordHvptTrial = (
  command: RecordHvptTrialCommand,
): Result<RecordHvptTrialOutput, DomainError> => {
  const reactionTimeResult = createReactionTime(command.reactionTimeMilliseconds);
  if (reactionTimeResult.isErr()) return err(reactionTimeResult.error);

  // 不変条件 1: correct は correctLabel と response の一致から導出
  const correct =
    command.correctLabel.type === command.response.type &&
    command.correctLabel.value === command.response.value;

  const trial: HvptTrial = {
    identifier: command.identifier,
    trainingSession: command.trainingSession,
    stimulus: command.stimulus,
    contrast: command.contrast,
    correctLabel: command.correctLabel,
    response: command.response,
    correct,
    reactionTimeMilliseconds: reactionTimeResult.value,
    presentedAt: command.presentedAt,
  };

  return ok({
    trial,
    events: [
      {
        type: "hvptTrialRecorded",
        hvptTrial: trial,
        trainingSession: command.trainingSession,
        correct,
        occurredAt: command.presentedAt,
      },
    ],
  });
};

/**
 * computeSessionAccuracy (DD-266)
 *
 * 試行正誤からセッション正答率を派生計算する（純関数、イベントなし）。
 * 不変条件: trials は NonEmptyList（呼び出し側が保証）。
 */
export const computeSessionAccuracy = (trials: NonEmptyList<HvptTrial>): Accuracy0To1 => {
  const correctCount = trials.filter((t) => t.correct).length;
  const accuracy = correctCount / trials.length;
  return accuracy as Accuracy0To1;
};

// ============================================================
// SpacingSchedule Aggregate (DD-204)
// ============================================================

// ---- Branded types (SpacingSchedule) ----

export type SpacingScheduleIdentifier = Brand<string, "SpacingScheduleIdentifier">;

export const createSpacingScheduleIdentifier = (value: string): SpacingScheduleIdentifier | null =>
  value.trim().length > 0 ? (value as SpacingScheduleIdentifier) : null;

// ---- SpacingState (DD-248) ----

export type SpacingState = "rest" | "due" | "gate" | "done";

export const createSpacingState = (value: string): SpacingState | null => {
  if (value === "rest" || value === "due" || value === "gate" || value === "done") {
    return value;
  }
  return null;
};

// ---- SpacingSchedule Aggregate (DD-204) ----

export type SpacingSchedule = Readonly<{
  identifier: SpacingScheduleIdentifier;
  learner: LearnerIdentifier;
  /** focusSound: 対象 WeaknessProfile の識別子 (ADR-007 識別子のみ参照) */
  focusSound: WeaknessProfileIdentifier;
  contrast: PhonemeContrast;
  state: SpacingState;
  nextPresentationAt: Date;
  recentAccuracy: Accuracy0To1 | null;
  updatedAt: Date;
}>;

/**
 * applySpacingTransition (DD-267)
 *
 * 正答率と現在時刻から rest / due / gate / done 遷移を決定する（決定論、乱数なし）。
 *
 * 遷移規則（ADR-011、domain.md §14.8.5）:
 * 1. now < nextPresentationAt → rest を維持
 * 2. accuracy ≥ masteryGateThreshold → done 遷移。nextPresentationAt = now + intervalHours
 *    その後 rest に戻る（done は遷移完了後 rest として保持）
 * 3. accuracy < masteryGateThreshold → gate 遷移。nextPresentationAt = now + gateRetryIntervalHours
 * 4. accuracy が null（セッション未実施）かつ now ≥ nextPresentationAt → due 遷移
 *
 * 全遷移後の SpacingSchedule は永続化責務のある呼び出し元が repository に書き戻す（DD-204不変条件4）。
 */
export const applySpacingTransition = (
  schedule: SpacingSchedule,
  accuracy: Accuracy0To1 | null,
  config: SpacingSchedulerConfig,
  now: Date,
): SpacingSchedule => {
  const intervalMilliseconds = hoursToMilliseconds(config.spacingIntervalHours);
  const gateRetryMilliseconds = hoursToMilliseconds(config.gateRetryIntervalHours);

  // セッション結果がある（accuracy != null）場合は遷移を評価
  if (accuracy !== null) {
    if (accuracy >= config.masteryGateThreshold) {
      // done 遷移: 間隔を開き、rest に戻す
      const nextPresentationAt = new Date(now.getTime() + intervalMilliseconds);
      return {
        ...schedule,
        state: "rest",
        nextPresentationAt,
        recentAccuracy: accuracy,
        updatedAt: now,
      };
    } else {
      // gate 遷移: 短間隔で再提示（24時間クロックを進めない）
      const nextPresentationAt = new Date(now.getTime() + gateRetryMilliseconds);
      return {
        ...schedule,
        state: "gate",
        nextPresentationAt,
        recentAccuracy: accuracy,
        updatedAt: now,
      };
    }
  }

  // accuracy が null（セッション未実施）の場合: 時刻による遷移
  if (now >= schedule.nextPresentationAt) {
    // due 遷移: 提示候補になる
    return {
      ...schedule,
      state: "due",
      updatedAt: now,
    };
  }

  // rest 維持: 提示時刻未到達
  return {
    ...schedule,
    state: "rest",
    updatedAt: now,
  };
};

// ---- captureProgressSnapshot ドメインサービス (DD-268) ----

/**
 * CaptureProgressSnapshotCommand — captureProgressSnapshot への入力
 */
export type CaptureProgressSnapshotCommand = Readonly<{
  identifier: ProgressSnapshotIdentifier;
  learner: LearnerIdentifier;
  /**
   * PPC Section / DiagnosticSession 識別子。訓練由来は null を渡す (DD-205)。
   */
  section: SectionIdentifier | null;
  /**
   * assessment_results 識別子。訓練由来は AssessmentResult を持たないため null を渡す (DD-205)。
   */
  sourceAssessment: AssessmentResultIdentifier | null;
  taskKind: ControlledTaskKind;
  cefrScores: CefrSubscaleScores;
  focusScores: ReadonlyArray<FocusScore>;
  cumulativeTrainingMinutes: CumulativeTrainingMinutes;
  capturedAt: Date;
}>;

export type CaptureProgressSnapshotOutput = Readonly<{
  progressSnapshot: ProgressSnapshot;
  events: NonEmptyList<ProgressSnapshotCaptured>;
}>;

/**
 * captureProgressSnapshot (DD-268)
 *
 * 統制課題結果から進捗スナップショットを作成する。
 * 不変条件:
 *   1. taskKind は rereading / drill のみ (DD-299) → NonControlledTaskNotEligible
 *   2. cefrScores は 3 下位尺度をすべて持つ → IncompleteCefrSubscales
 *   3. focusScores は NonEmptyList → EmptyFocusScores
 *   4. 作成後不変
 */
export const captureProgressSnapshot = (
  command: CaptureProgressSnapshotCommand,
): Result<CaptureProgressSnapshotOutput, DomainError> => {
  // 不変条件 3: focusScores は非空
  const nonEmptyFocusScores = createNonEmptyList(command.focusScores);
  if (nonEmptyFocusScores === null) {
    return err(
      validationFailed(
        "focusScores",
        "ProgressSnapshot の focusScores は空にできません (DD-205不変条件3 EmptyFocusScores)",
      ),
    );
  }

  const snapshot: ProgressSnapshot = {
    identifier: command.identifier,
    learner: command.learner,
    section: command.section,
    sourceAssessment: command.sourceAssessment,
    taskKind: command.taskKind,
    cefrScores: command.cefrScores,
    focusScores: nonEmptyFocusScores,
    cumulativeTrainingMinutes: command.cumulativeTrainingMinutes,
    capturedAt: command.capturedAt,
  };

  return ok({
    progressSnapshot: snapshot,
    events: [
      {
        type: "progressSnapshotCaptured",
        progressSnapshot: snapshot,
        section: command.section,
        sourceAssessment: command.sourceAssessment,
        occurredAt: command.capturedAt,
      },
    ],
  });
};
