/**
 * SpacingSchedule Aggregate — domain layer
 *
 * 設計の正: docs/03-detailed-design/domain.md §14 (DD-204/248/267)
 *          adr/011 (spacing / gate 遷移規則)
 *
 * domain 純粋性: I/O なし、class 構文禁止、数値 literal 禁止 (DD-293)
 * 他 BC 参照: WeaknessProfileIdentifier を識別子のみで参照 (ADR-007)
 */

import { type Brand, hoursToMilliseconds, createNonEmptyBrandedString } from "../shared";
import {
  type LearnerIdentifier,
  type PhonemeContrast,
  type WeaknessProfileIdentifier,
} from "./diagnostic";
import { type Accuracy0To1, type SpacingSchedulerConfig } from "./training-session";

// ============================================================
// SpacingSchedule Aggregate (DD-204)
// ============================================================

// ---- Branded types (SpacingSchedule) ----

export type SpacingScheduleIdentifier = Brand<string, "SpacingScheduleIdentifier">;

export const createSpacingScheduleIdentifier = (value: string): SpacingScheduleIdentifier | null =>
  createNonEmptyBrandedString<SpacingScheduleIdentifier>(value);

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
