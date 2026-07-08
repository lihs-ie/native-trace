import { type ResultAsync } from "neverthrow";
import { type DomainError } from "../../domain/shared";

/**
 * per-section-series 集計統計の value object。
 * material-detail 画面の .ss-stats / .plan-side に必要なデータを集約する。
 */
export type SectionSeriesStats = Readonly<{
  /** section_series 識別子 */
  sectionSeriesIdentifier: string;
  /**
   * 最新本文版のワード数 (スペース区切りトークン数)。
   * section が存在しない場合は null (honest empty)。
   */
  wordCount: number | null;
  /** recording_attempts の ready 件数（全 section バージョン合算）。試行なし = 0 */
  recordingAttemptCount: number;
  /** assessment_results.overall_score の最大値。試行なし = null（honest empty） */
  bestOverallScore: number | null;
  /**
   * スコア推移: assessment_results の overall_score を createdAt 昇順で返す配列。
   * 0 件のとき [] (honest empty)。UI は 1 件以下のとき spark を非表示にする。
   */
  overallScoreHistory: ReadonlyArray<number>;
}>;

export type SectionSeriesStatsRepository = Readonly<{
  /**
   * 指定 section_series 識別子のリストに対して SectionSeriesStats を一括取得する。
   * 存在しない identifier に対しては省略される（Map に含まれない）。
   * latestBodyText は section_series の最新版 body_text（語数計算用）。
   */
  findStatsBySectionSeries: (
    sectionSeriesIdentifiers: ReadonlyArray<string>,
    latestBodyTextBySeries: ReadonlyMap<string, string>,
  ) => ResultAsync<ReadonlyMap<string, SectionSeriesStats>, DomainError>;
}>;
