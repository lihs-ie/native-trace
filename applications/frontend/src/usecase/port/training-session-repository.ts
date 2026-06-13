import { type ResultAsync } from "neverthrow";
import { type DomainError } from "../../domain/shared";
import {
  type TrainingSession,
  type TrainingSessionIdentifier,
  type TrainingKind,
  type LearnerIdentifier,
} from "../../domain/training";

/**
 * TrainingSessionRepository — 訓練セッション永続化ポート
 *
 * 設計の正: docs/03-detailed-design/domain.md §14 (DD-202)
 *          docs/05-database-design/database-design.md §5b (DB-012)
 *          adr/011-spacing-scheduler-fixed-interval-mastery-gate.md
 *
 * Training Context UseCase → Training Context Port（内側のみ参照）
 */
export type TrainingSessionRepository = Readonly<{
  /**
   * find — 指定識別子の訓練セッションを取得する。
   * 見つからない場合は notFound エラーを返す。
   */
  find: (identifier: TrainingSessionIdentifier) => ResultAsync<TrainingSession, DomainError>;

  /**
   * findByLearnerAndContrastOrderedByStartedAt — 学習者・対立別のセッション履歴を startedAt 昇順で返す。
   * idx_training_sessions_contrast_started を使用する (ADR-011 正答率ゲート算出)。
   */
  findByLearnerAndContrastOrderedByStartedAt: (
    learner: LearnerIdentifier,
    contrast: string,
  ) => ResultAsync<ReadonlyArray<TrainingSession>, DomainError>;

  /**
   * persist — 訓練セッションを保存する（新規作成 / 状態更新の両方）。
   */
  persist: (session: TrainingSession) => ResultAsync<void, DomainError>;

  /**
   * countByLearnerAndKindSince — 指定日時以降の kind 別セッション完了件数を返す。
   * training 画面の週次実施回数表示 (.scope-note) に使用する (M-SHL-4)。
   */
  countByLearnerAndKindSince: (
    learner: LearnerIdentifier,
    kind: TrainingKind,
    since: Date,
  ) => ResultAsync<number, DomainError>;
}>;
