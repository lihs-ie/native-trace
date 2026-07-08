/**
 * CompleteHvptSession UseCase — HVPT 識別課題セッションを完了する (REQ-122/127)
 *
 * 設計の正: docs/specs/training-screen.md (M-TR-2/3/6, サブ(3b))
 *          docs/03-detailed-design/domain.md §14 (DD-202/204/205/264/266/267/268)
 *          adr/007-training-context-bounded-context.md (識別子のみ参照)
 *          adr/008-training-progress-timeseries-data-model.md
 *          adr/011-spacing-scheduler-fixed-interval-mastery-gate.md (60% ゲート)
 *
 * 処理フロー:
 *   1. セッション内の HvptTrial 全件を取得する
 *   2. computeSessionAccuracy (DD-266) でセッション正答率を算出する
 *   3. completeTrainingSession (DD-264) で InProgress → Completed 遷移する
 *   4. applySpacingTransition (DD-267) で SpacingSchedule を更新する（60% ゲート）
 *   5. SpacingSchedule を永続化する（DD-204 不変条件 4）
 *   6. captureProgressSnapshot で progress_snapshots に接続する（M-TR-3）
 *
 * SpacingSchedule が存在しない場合は新規作成する（初回セッション）。
 *
 * OQ-4（progress snapshot の section/sourceAssessment）:
 *   HVPT セッションは産出ドリルと異なり AssessmentResult を持たない。
 *   section / sourceAssessment はともに null を渡す（DD-205 nullable 変更済）。
 *   progress_snapshots.source_assessment は FK + nullable なので FK 違反にならない。
 *
 * LLM 呼び出しなし（ADR-007）。閾値は config 由来（DD-293）。
 */

import { type ResultAsync, errAsync, okAsync } from "neverthrow";
import { type DomainError, validationFailed, createNonEmptyList } from "../../domain/shared";
import {
  type SpacingSchedule,
  type WeaknessProfileIdentifier,
  type Accuracy0To1,
  type SpacingSchedulerConfig,
  createTrainingSessionIdentifier,
  createLearnerIdentifier,
  createSpacingScheduleIdentifier,
  createPhonemeContrast,
  createCefrSubscaleScores,
  createCumulativeTrainingMinutes,
  createProgressSnapshotIdentifier,
  computeSessionAccuracy,
  completeTrainingSession,
  applySpacingTransition,
  captureProgressSnapshot,
} from "../../domain/training";
import { toScore0To100, deriveFocusScoresFromWeaknessProfile } from "../shared/focus-score";
import { generateIdentifier } from "../shared/identifier";
import { type TrainingSessionRepository } from "../port/training-session-repository";
import { type HvptTrialRepository } from "../port/hvpt-trial-repository";
import { type SpacingScheduleRepository } from "../port/spacing-schedule-repository";
import { type WeaknessProfileRepository } from "../port/weakness-profile-repository";
import { type ProgressSnapshotRepository } from "../port/progress-snapshot-repository";
import { type TransactionManager } from "../port/transaction-manager";
import { type EntropyProvider } from "../port/entropy-provider";
import { type Clock } from "../port/clock";

// ---- Input ----

export type CompleteHvptSessionInput = Readonly<{
  /** 完了する TrainingSession 識別子 */
  trainingSessionIdentifier: string;
  /** sentinel LearnerIdentifier */
  learnerIdentifier: string;
  /**
   * セッション経過時間（分）。
   * SpacingSchedulerConfig.sessionCutoffMinutesMax 以下であること。
   */
  durationMinutes: number;
  /** WeaknessProfile 識別子（SpacingSchedule の focusSound 参照に使用） */
  weaknessProfileIdentifier: string;
  /**
   * SpacingScheduler config（config 由来の確定値 DD-293）。
   * masteryGateThreshold: 60% ゲート。spacingIntervalHours: 24h。
   */
  schedulerConfig: SpacingSchedulerConfig;
}>;

// ---- Output ----

export type CompleteHvptSessionOutput = Readonly<{
  trainingSessionIdentifier: string;
  sessionAccuracy: number;
  /** applySpacingTransition 後の SpacingSchedule 状態 */
  spacingState: "rest" | "gate";
  cumulativeTrainingMinutes: number;
}>;

// ---- Dependencies ----

export type CompleteHvptSessionDependencies = Readonly<{
  trainingSessionRepository: TrainingSessionRepository;
  hvptTrialRepository: HvptTrialRepository;
  spacingScheduleRepository: SpacingScheduleRepository;
  weaknessProfileRepository: WeaknessProfileRepository;
  progressSnapshotRepository: ProgressSnapshotRepository;
  transactionManager: TransactionManager;
  entropyProvider: EntropyProvider;
  clock: Clock;
}>;

// ---- Implementation ----

export const createCompleteHvptSession =
  (dependencies: CompleteHvptSessionDependencies) =>
  (input: CompleteHvptSessionInput): ResultAsync<CompleteHvptSessionOutput, DomainError> => {
    const trainingSessionIdentifier = createTrainingSessionIdentifier(
      input.trainingSessionIdentifier,
    );
    if (!trainingSessionIdentifier) {
      return errAsync(
        validationFailed("trainingSessionIdentifier", "不正な訓練セッション識別子です"),
      );
    }

    const learner = createLearnerIdentifier(input.learnerIdentifier);
    if (!learner) {
      return errAsync(validationFailed("learnerIdentifier", "不正な学習者識別子です"));
    }

    const weaknessProfileIdentifier = input.weaknessProfileIdentifier as WeaknessProfileIdentifier;
    if (!weaknessProfileIdentifier || weaknessProfileIdentifier.trim() === "") {
      return errAsync(
        validationFailed("weaknessProfileIdentifier", "不正な WeaknessProfile 識別子です"),
      );
    }

    // 1. TrainingSession を取得する（トランザクション外：read-only）
    return dependencies.trainingSessionRepository
      .find(trainingSessionIdentifier)
      .andThen((trainingSession) => {
        if (trainingSession.type !== "in_progress") {
          return errAsync(
            validationFailed(
              "trainingSession",
              "HVPT セッションは in_progress 状態でなければ完了できません",
            ),
          );
        }

        const contrast = createPhonemeContrast(String(trainingSession.contrast));
        if (!contrast) {
          return errAsync(validationFailed("contrast", "訓練セッションの対立文字列が不正です"));
        }

        // 2. セッション内の HvptTrial 全件を取得して正答率を算出する（DD-266、read-only）
        return dependencies.hvptTrialRepository
          .findByTrainingSessionOrderedByPresentedAt(trainingSessionIdentifier)
          .andThen((trials) => {
            const nonEmptyTrials = createNonEmptyList([...trials]);

            // 試行が 0 件の場合は accuracy = null（セッション中断に相当）
            const sessionAccuracy: Accuracy0To1 | null =
              nonEmptyTrials !== null ? computeSessionAccuracy(nonEmptyTrials) : null;

            const accuracyValue = sessionAccuracy !== null ? Number(sessionAccuracy) : 0;

            const now = dependencies.clock.now();

            // 3. completeTrainingSession (DD-264)
            const completeResult = completeTrainingSession(
              trainingSession,
              input.durationMinutes,
              sessionAccuracy,
              input.schedulerConfig,
              now,
            );

            if (completeResult.isErr()) {
              return errAsync(completeResult.error);
            }

            const { session: completedSession } = completeResult.value;

            // 4. SpacingSchedule を取得（read-only、トランザクション外）
            return dependencies.spacingScheduleRepository
              .findByLearnerAndContrast(learner, String(contrast))
              .andThen((existingSchedule) => {
                let schedule: SpacingSchedule;

                if (existingSchedule !== null) {
                  schedule = existingSchedule;
                } else {
                  // 初回セッション: SpacingSchedule を新規作成する
                  const scheduleIdentifierResult = generateIdentifier(
                    dependencies.entropyProvider,
                    createSpacingScheduleIdentifier,
                    "spacingScheduleIdentifier",
                  );
                  if (scheduleIdentifierResult.isErr()) {
                    return errAsync(scheduleIdentifierResult.error);
                  }

                  schedule = {
                    identifier: scheduleIdentifierResult.value,
                    learner,
                    focusSound: weaknessProfileIdentifier,
                    contrast,
                    state: "due",
                    nextPresentationAt: now,
                    recentAccuracy: null,
                    updatedAt: now,
                  };
                }

                // applySpacingTransition: 60% ゲート判定（ADR-011）
                const updatedSchedule = applySpacingTransition(
                  schedule,
                  sessionAccuracy,
                  input.schedulerConfig,
                  now,
                );

                const spacingState: "rest" | "gate" =
                  updatedSchedule.state === "gate" ? "gate" : "rest";

                // WeaknessProfile を取得して focusScores を生成する（read-only）
                return dependencies.weaknessProfileRepository
                  .find(weaknessProfileIdentifier)
                  .andThen((weaknessProfile) => {
                    const snapshotIdentifierResult = generateIdentifier(
                      dependencies.entropyProvider,
                      createProgressSnapshotIdentifier,
                      "progressSnapshotIdentifier",
                    );
                    if (snapshotIdentifierResult.isErr()) {
                      return errAsync(snapshotIdentifierResult.error);
                    }
                    const snapshotIdentifier = snapshotIdentifierResult.value;

                    // CEFR スコア: HVPT は分節スコアを正答率から近似
                    // accuracy 0-1 → 0-100 スコア変換（honest empty、実 CEFR 計算は産出ドリルで行う）
                    const segmentalScore = toScore0To100(accuracyValue);
                    const cefrScoresResult = createCefrSubscaleScores(
                      segmentalScore,
                      segmentalScore,
                      0,
                    );
                    if (cefrScoresResult.isErr()) {
                      return errAsync(cefrScoresResult.error);
                    }

                    // focusScores: WeaknessProfile の mastery から生成
                    const focusScoresResult = deriveFocusScoresFromWeaknessProfile(weaknessProfile);
                    if (focusScoresResult.isErr()) {
                      return errAsync(focusScoresResult.error);
                    }
                    const focusScores = focusScoresResult.value;

                    // cumulativeTrainingMinutes: このセッションの durationMinutes
                    const cumulativeResult = createCumulativeTrainingMinutes(input.durationMinutes);
                    if (cumulativeResult.isErr()) {
                      return errAsync(cumulativeResult.error);
                    }

                    // OQ-4: HVPT は AssessmentResult を持たない。
                    // section / sourceAssessment は null（DD-205 nullable 変更済、FK 違反なし）。
                    const captureResult = captureProgressSnapshot({
                      identifier: snapshotIdentifier,
                      learner,
                      section: null,
                      sourceAssessment: null,
                      taskKind: "drill",
                      cefrScores: cefrScoresResult.value,
                      focusScores,
                      cumulativeTrainingMinutes: cumulativeResult.value,
                      capturedAt: now,
                    });

                    if (captureResult.isErr()) {
                      return errAsync(captureResult.error);
                    }

                    const { progressSnapshot } = captureResult.value;

                    // 全 write 操作を単一トランザクションで囲む（部分 commit 防止）
                    return dependencies.transactionManager.execute(() =>
                      // 5. SpacingSchedule を永続化する（DD-204 不変条件 4）
                      dependencies.spacingScheduleRepository
                        .persist(updatedSchedule)
                        .andThen(() =>
                          // 6. TrainingSession を completed として永続化する
                          dependencies.trainingSessionRepository.persist(completedSession),
                        )
                        .andThen(() =>
                          // 7. progress_snapshots に接続する（M-TR-3、section/sourceAssessment は null）
                          dependencies.progressSnapshotRepository.save(progressSnapshot),
                        )
                        .andThen(() =>
                          okAsync({
                            trainingSessionIdentifier: String(completedSession.identifier),
                            sessionAccuracy: accuracyValue,
                            spacingState,
                            cumulativeTrainingMinutes: input.durationMinutes,
                          }),
                        ),
                    );
                  });
              });
          });
      });
  };
