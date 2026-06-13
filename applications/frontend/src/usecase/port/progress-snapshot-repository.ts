import { type ResultAsync } from "neverthrow";
import { type DomainError } from "../../domain/shared";
import { type ProgressSnapshot, type ProgressSnapshotIdentifier } from "../../domain/training";
import { type LearnerIdentifier } from "../../domain/training";

/**
 * ProgressSnapshotRepository — 進捗スナップショット永続化ポート
 *
 * 設計の正: docs/03-detailed-design/domain.md §14 (DD-205)
 *          docs/05-database-design/database-design.md §5b (DB-015)
 *          adr/008-training-progress-timeseries-data-model.md
 *
 * PPC との依存方向: Training Context UseCase → Training Context Port（内側のみ参照）
 */
export type ProgressSnapshotRepository = Readonly<{
  /**
   * save — 進捗スナップショットを新規保存する。
   * ProgressSnapshot は作成後不変 (updated_at なし)。
   */
  save: (snapshot: ProgressSnapshot) => ResultAsync<void, DomainError>;

  /**
   * findByLearnerOrderedByCapturedAt — 指定学習者の進捗スナップショットを capturedAt 昇順で返す。
   * 存在しない場合は空配列を返す（空集合は valid、honest empty）。
   * idx_progress_snapshots_learner_captured を使用する。
   */
  findByLearnerOrderedByCapturedAt: (
    learner: LearnerIdentifier,
  ) => ResultAsync<ReadonlyArray<ProgressSnapshot>, DomainError>;

  /**
   * find — 指定識別子の進捗スナップショットを取得する。
   * 見つからない場合は notFound エラーを返す。
   */
  find: (
    identifier: ProgressSnapshotIdentifier,
  ) => ResultAsync<ProgressSnapshot, DomainError>;
}>;
