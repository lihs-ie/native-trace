/**
 * ProgressSnapshot Aggregate — domain layer
 *
 * 設計の正: docs/03-detailed-design/domain.md §14 (DD-205/268)
 *          adr/007-training-context-bounded-context.md (識別子のみ参照)
 *          adr/008 (E-2: 自発タスクからはスナップショットを作らない)
 *
 * domain 純粋性: I/O なし、class 構文禁止、数値 literal 禁止 (DD-293)
 * 他 BC 参照: AssessmentResultIdentifier / SectionIdentifier を識別子のみで参照
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
import {
  type AssessmentResultIdentifier,
  type Score0To100,
  createScore0To100,
} from "../assessment-result";
import { type SectionIdentifier } from "../section";
import { type LearnerIdentifier, type PhonemeContrast, createPhonemeContrast } from "./diagnostic";

// ============================================================
// ProgressSnapshot Aggregate (DD-205)
// ============================================================

// ---- Branded types (ProgressSnapshot) ----

export type ProgressSnapshotIdentifier = Brand<string, "ProgressSnapshotIdentifier">;

export const createProgressSnapshotIdentifier = (
  value: string,
): ProgressSnapshotIdentifier | null =>
  createNonEmptyBrandedString<ProgressSnapshotIdentifier>(value);

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
