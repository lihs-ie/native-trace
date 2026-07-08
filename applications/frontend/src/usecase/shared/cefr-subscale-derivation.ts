/**
 * CEFR 下位尺度導出の共有ロジック
 *
 * 設計の正: docs/specs/diagnostic-screen.md (M-DG-5)
 *          docs/specs/progress-screen.md (OQ-4)
 *
 * view-diagnostic-result と capture-progress-snapshot の両方で再利用する。
 * 重複実装禁止 (OQ-4)。
 * UseCase 層のロジックのため domain を import してよい。LLM 呼び出しなし (ADR-010)。
 */

import type { ScoreSet } from "../../domain/assessment-result";

/**
 * scoreToCefrBand — スコア (0-100) を CEFR 音韻統制バンドに変換する。
 * Haskell worker の buildCefrScore と同一ロジック（M-114 §8.3.4 準拠）。
 * 決定論的: スコアのみから導出、固定値禁止。
 */
export const scoreToCefrBand = (score: number): string => {
  if (score >= 90) return "C2";
  if (score >= 80) return "C1";
  if (score >= 70) return "B2";
  if (score >= 60) return "B1+";
  if (score >= 50) return "B1";
  if (score >= 40) return "A2+";
  if (score >= 30) return "A2";
  return "A1";
};

/**
 * CefrSubscaleResult — CEFR 下位尺度の導出結果型
 */
export type CefrSubscaleResult = Readonly<{
  overall: Readonly<{ score: number; band: string }> | null;
  segmental: Readonly<{ score: number; band: string }> | null;
  prosodic: Readonly<{ score: number; band: string }> | null;
}>;

/**
 * deriveCefrSubscalesFromScores — AssessmentResult の scores から CEFR 3 下位尺度を導出する。
 * worker が CEFR フィールドを返している場合はそれを使用し、null の場合（旧データ互換）は
 * overall/pronunciation/prosody スコアから決定論的に算出する（固定値禁止 M-DG-5）。
 */
export const deriveCefrSubscalesFromScores = (scores: ScoreSet): CefrSubscaleResult => {
  // worker から CEFR が提供されている場合は優先使用
  const overallCefr =
    scores.cefrOverall ??
    (() => {
      const score = Number(scores.overall);
      return { score, band: scoreToCefrBand(score) };
    })();

  const segmentalCefr =
    scores.cefrSegmental ??
    (() => {
      // segmental は pronunciation スコアに対応
      const score = Number(scores.pronunciation);
      return { score, band: scoreToCefrBand(score) };
    })();

  const prosodicCefr =
    scores.cefrProsodic ??
    (() => {
      // prosodic は prosody スコアに対応
      const score = Number(scores.prosody);
      return { score, band: scoreToCefrBand(score) };
    })();

  return {
    overall: overallCefr,
    segmental: segmentalCefr,
    prosodic: prosodicCefr,
  };
};
