import { type ResultAsync } from "neverthrow";
import { type DomainError } from "../../domain/shared";
import {
  type HvptTrial,
  type HvptTrialIdentifier,
  type TrainingSessionIdentifier,
} from "../../domain/training";

/**
 * HvptTrialRepository — HVPT 試行永続化ポート
 *
 * 設計の正: docs/03-detailed-design/domain.md §14 (DD-203)
 *          docs/05-database-design/database-design.md §5b (DB-013)
 *
 * Training Context UseCase → Training Context Port（内側のみ参照）
 */
export type HvptTrialRepository = Readonly<{
  /**
   * find — 指定識別子の試行を取得する。
   * 見つからない場合は notFound エラーを返す。
   */
  find: (identifier: HvptTrialIdentifier) => ResultAsync<HvptTrial, DomainError>;

  /**
   * findByTrainingSessionOrderedByPresentedAt — セッション内の試行を presentedAt 昇順で返す。
   * idx_hvpt_trials_training_session を使用する（セッション正答率算出 ADR-011）。
   */
  findByTrainingSessionOrderedByPresentedAt: (
    trainingSession: TrainingSessionIdentifier,
  ) => ResultAsync<ReadonlyArray<HvptTrial>, DomainError>;

  /**
   * save — 試行を新規保存する（HvptTrial は作成後不変、updated_at なし）。
   */
  save: (trial: HvptTrial) => ResultAsync<void, DomainError>;
}>;
