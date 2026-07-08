/**
 * CaptureProgressSnapshot UseCase
 *
 * 設計の正: docs/specs/progress-screen.md (M-PG-2)
 *          docs/03-detailed-design/domain.md §14 (DD-205/268)
 *          adr/007-training-context-bounded-context.md (識別子のみ参照)
 *          adr/008-training-progress-timeseries-data-model.md
 *
 * 診断完了時の baseline ProgressSnapshot を生成して永続化する。
 * CEFR は deriveCefrSubscalesFromScores (shared)、
 * focusScores は WeaknessProfile.focusSounds から mastery → 0-100 スコアに変換。
 * cumulativeTrainingMinutes = 0 (training 未実装 / honest empty)。
 * section = DiagnosticSession 識別子 (training スライスまでの honest 設計)。
 */

import { type ResultAsync, errAsync } from "neverthrow";
import { type DomainError, validationFailed } from "../../domain/shared";
import {
  type LearnerIdentifier,
  type WeaknessProfile,
  createProgressSnapshotIdentifier,
  createCefrSubscaleScores,
  createCumulativeTrainingMinutes,
  captureProgressSnapshot,
} from "../../domain/training";
import {
  type AssessmentResult,
  type AssessmentResultIdentifier,
} from "../../domain/assessment-result";
import { type SectionIdentifier } from "../../domain/section";
import { type ProgressSnapshotRepository } from "../port/progress-snapshot-repository";
import { type EntropyProvider } from "../port/entropy-provider";
import { type Clock } from "../port/clock";
import { deriveCefrSubscalesFromScores } from "../shared/cefr-subscale-derivation";
import { deriveFocusScoresFromWeaknessProfile } from "../shared/focus-score";

// ---- Input ----

export type CaptureProgressSnapshotInput = Readonly<{
  /** sentinel LearnerIdentifier (config 由来、ドメインに literal を埋め込まない DD-293) */
  learner: LearnerIdentifier;
  /**
   * source section — diagnostic baseline では DiagnosticSession 識別子を使用。
   * training スライス実装後は実 Section 識別子を渡す。
   */
  section: SectionIdentifier;
  /** baseline を生成した AssessmentResult */
  assessmentResult: AssessmentResult;
  /** WeaknessProfile.focusSounds から focusScores を構成する */
  weaknessProfile: WeaknessProfile;
}>;

// ---- Output ----

export type CaptureProgressSnapshotOutput = Readonly<{
  progressSnapshotIdentifier: string;
}>;

// ---- Dependencies ----

export type CaptureProgressSnapshotDependencies = Readonly<{
  progressSnapshotRepository: ProgressSnapshotRepository;
  entropyProvider: EntropyProvider;
  clock: Clock;
}>;

// ---- Implementation ----

export const createCaptureProgressSnapshot =
  (dependencies: CaptureProgressSnapshotDependencies) =>
  (
    input: CaptureProgressSnapshotInput,
  ): ResultAsync<CaptureProgressSnapshotOutput, DomainError> => {
    const snapshotIdentifierRaw = dependencies.entropyProvider.generateUlid();
    const snapshotIdentifier = createProgressSnapshotIdentifier(snapshotIdentifierRaw);
    if (!snapshotIdentifier) {
      return errAsync(
        validationFailed(
          "progressSnapshotIdentifier",
          "ProgressSnapshot 識別子の生成に失敗しました",
        ),
      );
    }

    const now = dependencies.clock.now();

    // CEFR 3 下位尺度を AssessmentResult.scores から導出 (shared モジュール再利用、重複実装禁止 OQ-4)
    const cefrResult = deriveCefrSubscalesFromScores(input.assessmentResult.scores);

    // CEFR スコアを 0-100 整数にする (null の場合は 0 で honest empty)
    const overallScore = Math.round(cefrResult.overall?.score ?? 0);
    const segmentalScore = Math.round(cefrResult.segmental?.score ?? 0);
    const prosodicScore = Math.round(cefrResult.prosodic?.score ?? 0);

    const cefrScoresResult = createCefrSubscaleScores(overallScore, segmentalScore, prosodicScore);
    if (cefrScoresResult.isErr()) {
      return errAsync(cefrScoresResult.error);
    }

    // focusScores — WeaknessProfile.focusSounds の mastery を 0-100 スコアに変換 (OQ-5)
    const focusScoresResult = deriveFocusScoresFromWeaknessProfile(input.weaknessProfile);
    if (focusScoresResult.isErr()) {
      return errAsync(focusScoresResult.error);
    }

    const focusScores = focusScoresResult.value;

    // cumulativeTrainingMinutes = 0 (training 未実装、honest empty DD-253)
    const cumulativeResult = createCumulativeTrainingMinutes(0);
    if (cumulativeResult.isErr()) {
      return errAsync(cumulativeResult.error);
    }

    const sourceAssessmentIdentifier = input.assessmentResult
      .identifier as AssessmentResultIdentifier;

    const captureResult = captureProgressSnapshot({
      identifier: snapshotIdentifier,
      learner: input.learner,
      section: input.section,
      sourceAssessment: sourceAssessmentIdentifier,
      taskKind: "rereading",
      cefrScores: cefrScoresResult.value,
      focusScores,
      cumulativeTrainingMinutes: cumulativeResult.value,
      capturedAt: now,
    });

    if (captureResult.isErr()) {
      return errAsync(captureResult.error);
    }

    const { progressSnapshot } = captureResult.value;

    return dependencies.progressSnapshotRepository.save(progressSnapshot).map(() => ({
      progressSnapshotIdentifier: String(progressSnapshot.identifier),
    }));
  };
