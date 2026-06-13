import { type ResultAsync } from "neverthrow";
import { type DomainError } from "../../domain/shared";
import {
  type WeaknessProfile,
  type WeaknessProfileIdentifier,
  type LearnerIdentifier,
} from "../../domain/training";

/**
 * WeaknessProfileRepository — 弱点プロファイル永続化ポート
 *
 * 設計の正: docs/03-detailed-design/domain.md §14 (DD-201)
 *          docs/05-database-design/database-design.md §5b (DB-011)
 *
 * PPC との依存方向: Training Context UseCase → Training Context Port（内側のみ参照）
 */
export type WeaknessProfileRepository = Readonly<{
  /**
   * find — 指定識別子の弱点プロファイルを取得する。
   * 見つからない場合は notFound エラーを返す。
   */
  find: (
    identifier: WeaknessProfileIdentifier,
  ) => ResultAsync<WeaknessProfile, DomainError>;

  /**
   * findByLearner — 指定学習者の弱点プロファイルを取得する。
   * 学習者ごと1プロファイル（uq_weakness_profiles_learner）。
   * 存在しない場合は null を返す（診断前は null）。
   */
  findByLearner: (
    learner: LearnerIdentifier,
  ) => ResultAsync<WeaknessProfile | null, DomainError>;

  /**
   * persist — 弱点プロファイルを保存する（新規作成 / EWMA 更新の両方）。
   */
  persist: (profile: WeaknessProfile) => ResultAsync<void, DomainError>;
}>;
