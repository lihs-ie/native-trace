/**
 * DrillSectionFixture — 産出ドリル録音用の固定 Material/Section の自動初期化
 *
 * 設計の正: docs/specs/training-screen.md (M-TR-4 / OQ-6)
 *          adr/007-training-context-bounded-context.md (識別子のみ参照)
 *
 * 産出ドリルの録音は PPC の recording → analysis パスを再利用する。
 * そのために産出ドリル専用の固定 Material / SectionSeries / Section を DB に保持する。
 * ADR-007: Training Context は Section 識別子のみで参照（識別子を返すのみ）。
 *
 * 各 TrainingSession × exampleSentence に対応する Section を 1:1 で作成・取得する。
 * Section が存在しない場合のみ INSERT する（idempotent）。
 *
 * ensure-upsert の共通実装は sentinel-section-fixture.ts の ensureSentinelSectionExists に
 * パラメータ化抽出済み（W27）。本ファイルは固定識別子・タイトル定数と薄い委譲のみを持つ。
 */

import type { DrizzleDatabase } from "../drizzle/client";
import { ensureSentinelSectionExists } from "./sentinel-section-fixture";

// ---- 産出ドリル用 Material / SectionSeries の固定識別子 ----

const DRILL_MATERIAL_ID = "DRILL_MATERIAL_SINGLETON";
const DRILL_SECTION_SERIES_ID = "DRILL_SECTION_SERIES_SINGLETON";

// TrainingSession 識別子 → Section 識別子の写像
// 同一 TrainingSession の異なる例文に対応できるよう、session + 例文テキストハッシュで決定論的に生成する
const toDrillSectionIdentifier = (trainingSessionIdentifier: string): string =>
  `DRILL_SECTION_${trainingSessionIdentifier.toUpperCase().replace(/-/g, "_")}`;

/**
 * ensureDrillSectionExists — 産出ドリルセッションに対応する Section 識別子を取得または作成する。
 *
 * @param database - Drizzle DB インスタンス
 * @param trainingSessionIdentifier - TrainingSession.identifier
 * @param exampleSentence - Section の body_text として使用する例文
 * @returns Section 識別子（string）
 */
export const ensureDrillSectionExists = async (
  database: DrizzleDatabase,
  trainingSessionIdentifier: string,
  exampleSentence: string,
): Promise<string> => {
  const sectionIdentifier = toDrillSectionIdentifier(trainingSessionIdentifier);
  const bodyTextHash = Buffer.from(exampleSentence).toString("base64").slice(0, 32);

  return ensureSentinelSectionExists({
    database,
    materialIdentifier: DRILL_MATERIAL_ID,
    seriesIdentifier: DRILL_SECTION_SERIES_ID,
    materialTitle: "産出ドリル（システム生成）",
    seriesTitle: "産出ドリル例文セット",
    sectionIdentifier,
    bodyText: exampleSentence,
    bodyTextHash,
  });
};
