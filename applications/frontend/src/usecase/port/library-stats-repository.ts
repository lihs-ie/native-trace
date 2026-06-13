import { type ResultAsync } from "neverthrow";
import { type DomainError } from "../../domain/shared";

/**
 * per-material 集計統計の value object。
 * library 画面の .mcard に必要なデータを集約する。
 */
export type MaterialStats = Readonly<{
  /** section_series の active 件数 */
  sectionSeriesCount: number;
  /** recording_attempts の ready 件数（全セクション合算） */
  recordingAttemptCount: number;
  /** assessment_results.overall_score の最大値。試行なし = null（honest empty） */
  bestOverallScore: number | null;
  /**
   * スコア推移: assessment_results の overall_score を createdAt 昇順で返す配列。
   * 点が 0 件のときは [] (honest empty)。UI は 1 件以下のとき spark を非表示にする。
   */
  overallScoreHistory: ReadonlyArray<number>;
  /**
   * 全セクションの recording_attempts で最後に練習した日時。
   * 試行なし = null（honest empty）
   */
  lastPracticedAt: Date | null;
}>;

export type LibraryStatsRepository = Readonly<{
  /**
   * 指定 material 識別子のリストに対して MaterialStats を一括取得する。
   * 存在しない material の identifier に対しては省略される（Map に含まれない）。
   */
  findStatsByMaterials: (
    materialIdentifiers: ReadonlyArray<string>,
  ) => ResultAsync<ReadonlyMap<string, MaterialStats>, DomainError>;
}>;
