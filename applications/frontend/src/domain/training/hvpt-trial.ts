/**
 * HvptTrial Aggregate — domain layer
 *
 * 設計の正: docs/03-detailed-design/domain.md §14 (DD-203/245/246/265/266)
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
import { type PhonemeContrast } from "./diagnostic";
import { type TrainingSessionIdentifier, type Accuracy0To1 } from "./training-session";

// ============================================================
// HvptTrial Aggregate (DD-203)
// ============================================================

// ---- Branded types (HvptTrial) ----

export type HvptTrialIdentifier = Brand<string, "HvptTrialIdentifier">;
export type StimulusIdentifier = Brand<string, "StimulusIdentifier">;
export type ReactionTime = Brand<number, "ReactionTime">;

export const createHvptTrialIdentifier = (value: string): HvptTrialIdentifier | null =>
  createNonEmptyBrandedString<HvptTrialIdentifier>(value);

export const createStimulusIdentifier = (value: string): StimulusIdentifier | null =>
  createNonEmptyBrandedString<StimulusIdentifier>(value);

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
