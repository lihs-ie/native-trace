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
 * 診断パターン（diagnostic-section-fixture.ts）と同じ設計。
 */

import { eq } from "drizzle-orm";
import type { DrizzleDatabase } from "../drizzle/client";
import { materials, sectionSeries, sections } from "../drizzle/schema";

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
  const now = new Date().toISOString();

  // Material が存在しない場合は INSERT
  const existingMaterial = await database
    .select({ identifier: materials.identifier })
    .from(materials)
    .where(eq(materials.identifier, DRILL_MATERIAL_ID))
    .limit(1);

  if (existingMaterial.length === 0) {
    await database
      .insert(materials)
      .values({
        identifier: DRILL_MATERIAL_ID,
        title: "産出ドリル（システム生成）",
        sourceJson: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
  }

  // SectionSeries が存在しない場合は INSERT
  const existingSeriesRows = await database
    .select({ identifier: sectionSeries.identifier })
    .from(sectionSeries)
    .where(eq(sectionSeries.identifier, DRILL_SECTION_SERIES_ID))
    .limit(1);

  if (existingSeriesRows.length === 0) {
    await database
      .insert(sectionSeries)
      .values({
        identifier: DRILL_SECTION_SERIES_ID,
        material: DRILL_MATERIAL_ID,
        title: "産出ドリル例文セット",
        displayOrder: 0,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
  }

  // Section が存在しない場合は INSERT
  const existingSectionRows = await database
    .select({ identifier: sections.identifier })
    .from(sections)
    .where(eq(sections.identifier, sectionIdentifier))
    .limit(1);

  if (existingSectionRows.length === 0) {
    const bodyTextHash = Buffer.from(exampleSentence).toString("base64").slice(0, 32);
    await database
      .insert(sections)
      .values({
        identifier: sectionIdentifier,
        sectionSeries: DRILL_SECTION_SERIES_ID,
        versionNumber: 1,
        bodyText: exampleSentence,
        bodyTextHash,
        createdAt: now,
      })
      .onConflictDoNothing();
  }

  return sectionIdentifier;
};
