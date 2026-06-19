/**
 * FindingRetrySectionFixture — finding 単位の再録音 retry 専用固定 Material/Section の自動初期化
 *
 * 設計の正: docs/specs/closed-remediation-loop.md (M-CRL-5)
 *          adr/022-closed-remediation-improvement-measurement-loop.md (D4)
 *
 * finding retry 録音は既存の recording→analysis パスを再利用する。
 * そのために finding 単位の固定 Material / SectionSeries / Section を DB に保持する。
 * ADR-007: Training Context は Section 識別子のみで参照（識別子を返すのみ）。
 *
 * 各 finding × referenceText に対応する Section を 1:1 で作成・取得する。
 * Section が存在しない場合のみ INSERT する（idempotent）。
 *
 * drill-section-fixture.ts と同型の実装パターンを踏襲する。
 *
 * 隔離保証: FINDING_RETRY_MATERIAL_SINGLETON を fixture 外から参照しないことで
 * workspace の実 Section 履歴クエリから混入しない。
 * grep -rn "FINDING_RETRY_MATERIAL_SINGLETON" src/ | grep -v "finding-retry-section-fixture.ts"
 * の結果が 0 件であることを確認する。
 *
 * ADR-008: progress_snapshots への書き込みは行わない。
 * Drizzle スキーマの変更（新テーブル・新カラム）はこのスライスでは行わない。
 */

import { eq } from "drizzle-orm";
import type { DrizzleDatabase } from "../drizzle/client";
import { materials, sectionSeries, sections } from "../drizzle/schema";

// ---- finding retry 専用 Material / SectionSeries の固定識別子 ----

export const FINDING_RETRY_MATERIAL_SINGLETON = "FINDING_RETRY_MATERIAL_SINGLETON";
export const FINDING_RETRY_SECTION_SERIES_SINGLETON = "FINDING_RETRY_SECTION_SERIES_SINGLETON";

// finding 識別子 → Section 識別子の写像（決定論的・idempotent）
const toFindingRetrySectionIdentifier = (findingIdentifier: string): string =>
  `FINDING_RETRY_SECTION_${findingIdentifier.toUpperCase().replace(/-/g, "_")}`;

/**
 * ensureFindingRetrySectionExists — finding retry に対応する Section 識別子を取得または作成する。
 *
 * @param database - Drizzle DB インスタンス
 * @param findingIdentifier - EngineFinding.finding（所見 identifier）
 * @param referenceText - Section の body_text として使用する参照テキスト（単語）
 * @returns Section 識別子（string）
 */
export const ensureFindingRetrySectionExists = async (
  database: DrizzleDatabase,
  findingIdentifier: string,
  referenceText: string,
): Promise<string> => {
  const sectionIdentifier = toFindingRetrySectionIdentifier(findingIdentifier);
  const now = new Date().toISOString();

  // Material が存在しない場合は INSERT
  const existingMaterial = await database
    .select({ identifier: materials.identifier })
    .from(materials)
    .where(eq(materials.identifier, FINDING_RETRY_MATERIAL_SINGLETON))
    .limit(1);

  if (existingMaterial.length === 0) {
    await database
      .insert(materials)
      .values({
        identifier: FINDING_RETRY_MATERIAL_SINGLETON,
        title: "所見 retry 録音（システム生成）",
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
    .where(eq(sectionSeries.identifier, FINDING_RETRY_SECTION_SERIES_SINGLETON))
    .limit(1);

  if (existingSeriesRows.length === 0) {
    await database
      .insert(sectionSeries)
      .values({
        identifier: FINDING_RETRY_SECTION_SERIES_SINGLETON,
        material: FINDING_RETRY_MATERIAL_SINGLETON,
        title: "所見 retry 録音セット",
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
    const bodyTextHash = Buffer.from(referenceText).toString("base64").slice(0, 32);
    await database
      .insert(sections)
      .values({
        identifier: sectionIdentifier,
        sectionSeries: FINDING_RETRY_SECTION_SERIES_SINGLETON,
        versionNumber: 1,
        bodyText: referenceText,
        bodyTextHash,
        createdAt: now,
      })
      .onConflictDoNothing();
  }

  return sectionIdentifier;
};
