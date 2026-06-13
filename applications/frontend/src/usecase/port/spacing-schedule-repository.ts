import { type ResultAsync } from "neverthrow";
import { type DomainError } from "../../domain/shared";
import {
  type SpacingSchedule,
  type SpacingScheduleIdentifier,
  type LearnerIdentifier,
} from "../../domain/training";

/**
 * SpacingScheduleRepository — 分散学習スケジュール永続化ポート
 *
 * 設計の正: docs/03-detailed-design/domain.md §14 (DD-204)
 *          docs/05-database-design/database-design.md §5b (DB-014)
 *          adr/011-spacing-scheduler-fixed-interval-mastery-gate.md
 *
 * Training Context UseCase → Training Context Port（内側のみ参照）
 */
export type SpacingScheduleRepository = Readonly<{
  /**
   * find — 指定識別子のスケジュールを取得する。
   * 見つからない場合は notFound エラーを返す。
   */
  find: (identifier: SpacingScheduleIdentifier) => ResultAsync<SpacingSchedule, DomainError>;

  /**
   * findByLearnerAndContrast — 学習者・対立別のスケジュールを取得する。
   * uq_spacing_schedules_learner_contrast の一意性を利用 (DD-204不変条件5)。
   * 存在しない場合は null を返す（スケジュール未作成）。
   */
  findByLearnerAndContrast: (
    learner: LearnerIdentifier,
    contrast: string,
  ) => ResultAsync<SpacingSchedule | null, DomainError>;

  /**
   * findDueByLearner — 学習者の提示候補（due 状態）スケジュールを返す。
   * idx_spacing_schedules_due を使用する（ADR-011 提示候補取得）。
   */
  findDueByLearner: (
    learner: LearnerIdentifier,
  ) => ResultAsync<ReadonlyArray<SpacingSchedule>, DomainError>;

  /**
   * findAllByLearner — 学習者の全スケジュール（全 state）を返す。
   * training 画面の .sched rail 表示用。nextPresentationAt 昇順。
   */
  findAllByLearner: (
    learner: LearnerIdentifier,
  ) => ResultAsync<ReadonlyArray<SpacingSchedule>, DomainError>;

  /**
   * persist — スケジュールを保存する（新規作成 / 状態更新の両方）。
   * 全遷移を repository 経由で書き戻す（DD-204不変条件4、メモリ保持にしない）。
   */
  persist: (schedule: SpacingSchedule) => ResultAsync<void, DomainError>;
}>;
