/**
 * DiagnosticSectionFixture — 診断録音用の固定 Material/Section の自動初期化
 *
 * 設計の正: docs/specs/diagnostic-screen.md (M-DG-2 / OQ-2)
 *
 * 診断プロンプトの録音は PPC の recording → analysis パスを再利用する。
 * そのために診断専用の固定 Material / SectionSeries / Section を DB に保持する。
 * ADR-007: Training Context は Section 識別子のみで参照（識別子を返すのみ）。
 *
 * 各 DiagnosticPrompt に対応する Section を 1:1 で作成・取得する。
 * Section が存在しない場合のみ INSERT する（idempotent）。
 */

import { eq } from "drizzle-orm";
import type { DrizzleDatabase } from "../drizzle/client";
import { materials, sectionSeries, sections } from "../drizzle/schema";

// ---- 診断用 Material / SectionSeries の固定識別子 ----
// OQ-1 解決: シングルトン学習者と同様に、診断用 Material も sentinel 定数で管理する
const DIAGNOSTIC_MATERIAL_ID = "DIAGNOSTIC_MATERIAL_SINGLETON";
const DIAGNOSTIC_SECTION_SERIES_ID = "DIAGNOSTIC_SECTION_SERIES_SINGLETON";

// 診断プロンプト識別子 → Section 識別子の写像
// DiagnosticPrompt.identifier は "dp-lr-01" 等の固定値なので、Section 識別子を決定論的に導出する
const toSectionIdentifier = (promptIdentifier: string): string =>
  `DIAGNOSTIC_SECTION_${promptIdentifier.toUpperCase().replace(/-/g, "_")}`;

/**
 * ensureDiagnosticSectionExists — 診断プロンプトに対応する Section 識別子を取得または作成する。
 *
 * @param database - Drizzle DB インスタンス
 * @param promptIdentifier - DiagnosticPrompt.identifier（例: "dp-lr-01"）
 * @param promptText - Section の body_text として使用するプロンプト本文
 * @returns Section 識別子（string）
 */
export const ensureDiagnosticSectionExists = async (
  database: DrizzleDatabase,
  promptIdentifier: string,
  promptText: string,
): Promise<string> => {
  const sectionIdentifier = toSectionIdentifier(promptIdentifier);
  const now = new Date().toISOString();

  // Material が存在しない場合は INSERT
  const existingMaterial = await database
    .select({ identifier: materials.identifier })
    .from(materials)
    .where(eq(materials.identifier, DIAGNOSTIC_MATERIAL_ID))
    .limit(1);

  if (existingMaterial.length === 0) {
    await database
      .insert(materials)
      .values({
        identifier: DIAGNOSTIC_MATERIAL_ID,
        title: "診断テスト（システム生成）",
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
    .where(eq(sectionSeries.identifier, DIAGNOSTIC_SECTION_SERIES_ID))
    .limit(1);

  if (existingSeriesRows.length === 0) {
    await database
      .insert(sectionSeries)
      .values({
        identifier: DIAGNOSTIC_SECTION_SERIES_ID,
        material: DIAGNOSTIC_MATERIAL_ID,
        title: "診断プロンプトセット",
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
    const bodyTextHash = Buffer.from(promptText).toString("base64").slice(0, 32);
    await database
      .insert(sections)
      .values({
        identifier: sectionIdentifier,
        sectionSeries: DIAGNOSTIC_SECTION_SERIES_ID,
        versionNumber: 1,
        bodyText: promptText,
        bodyTextHash,
        createdAt: now,
      })
      .onConflictDoNothing();
  }

  return sectionIdentifier;
};
