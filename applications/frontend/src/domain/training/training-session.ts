/**
 * TrainingSession Aggregate — domain layer
 *
 * 設計の正: docs/03-detailed-design/domain.md §14 (DD-202/241/242/264)
 *          adr/011 (sessionCutoffAt20To30Minutes / gateRetryIntervalHours)
 *
 * domain 純粋性: I/O なし、class 構文禁止、数値 literal 禁止 (DD-293)
 */

import { err, ok } from "neverthrow";
import { type Result } from "neverthrow";
import {
  type Brand,
  type DomainError,
  type NonEmptyList,
  createNonEmptyBrandedString,
  validationFailed,
} from "../shared";
import { type LearnerIdentifier, type PhonemeContrast } from "./diagnostic";

// ============================================================
// TrainingSession Aggregate (DD-202)
// ============================================================

// ---- Branded types (TrainingSession) ----

export type TrainingSessionIdentifier = Brand<string, "TrainingSessionIdentifier">;

export const createTrainingSessionIdentifier = (value: string): TrainingSessionIdentifier | null =>
  createNonEmptyBrandedString<TrainingSessionIdentifier>(value);

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
