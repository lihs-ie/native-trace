import { type ResultAsync } from "neverthrow";
import { type DomainError } from "../../domain/shared";
import {
  type DiagnosticSession,
  type DiagnosticSessionIdentifier,
  type LearnerIdentifier,
} from "../../domain/training";

/**
 * DiagnosticSessionRepository — 診断セッション永続化ポート
 *
 * 設計の正: docs/03-detailed-design/domain.md §14 (DD-200)
 *          docs/05-database-design/database-design.md §5b (DB-010)
 *
 * PPC との依存方向: Training Context UseCase → Training Context Port（内側のみ参照）
 */
export type DiagnosticSessionRepository = Readonly<{
  /**
   * find — 指定識別子の診断セッションを取得する。
   * 見つからない場合は notFound エラーを返す。
   */
  find: (
    identifier: DiagnosticSessionIdentifier,
  ) => ResultAsync<DiagnosticSession, DomainError>;

  /**
   * findLatestByLearner — 指定学習者の最新診断セッションを取得する。
   * 存在しない場合は null を返す（初回診断前は null）。
   */
  findLatestByLearner: (
    learner: LearnerIdentifier,
  ) => ResultAsync<DiagnosticSession | null, DomainError>;

  /**
   * persist — 診断セッションを保存する（新規作成 / 状態更新の両方）。
   */
  persist: (session: DiagnosticSession) => ResultAsync<void, DomainError>;
}>;
