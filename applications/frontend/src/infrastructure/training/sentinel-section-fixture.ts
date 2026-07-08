/**
 * SentinelSectionFixture — 固定 Material/SectionSeries/Section の ensure-upsert 共通実装
 *
 * 設計の正: docs/plans/2026-07-04-refactoring-plan.md W27
 *
 * diagnostic-section-fixture.ts / drill-section-fixture.ts / finding-retry-section-fixture.ts
 * の 3 ファイルで重複していた「固定（sentinel）Material → SectionSeries → Section の
 * ensure-upsert」ロジックを、テスト済みの finding-retry 版を canonical としてパラメータ化抽出する。
 *
 * ADR-007: Training Context は Section 識別子のみで参照（識別子を返すのみ）。
 * Section が存在しない場合のみ INSERT する（idempotent）。
 *
 * body_text_hash の計算（`Buffer.from(text).toString("base64").slice(0, 32)`）は
 * 呼び出し元 3 本の現行実装のまま維持し、この共通関数には計算済みの値を渡す
 * （section-repository の sha256 との不整合は既知だが統一は挙動変更のため対象外）。
 */

import { eq } from "drizzle-orm";
import type { DrizzleDatabase } from "../drizzle/client";
import { materials, sectionSeries, sections } from "../drizzle/schema";

export interface EnsureSentinelSectionExistsParameters {
  readonly database: DrizzleDatabase;
  readonly materialIdentifier: string;
  readonly seriesIdentifier: string;
  readonly materialTitle: string;
  readonly seriesTitle: string;
  readonly sectionIdentifier: string;
  readonly bodyText: string;
  readonly bodyTextHash: string;
}

/**
 * ensureSentinelSectionExists — 固定 Material/SectionSeries/Section を取得または作成する。
 *
 * @returns 引数で渡された sectionIdentifier をそのまま返す
 */
export const ensureSentinelSectionExists = async ({
  database,
  materialIdentifier,
  seriesIdentifier,
  materialTitle,
  seriesTitle,
  sectionIdentifier,
  bodyText,
  bodyTextHash,
}: EnsureSentinelSectionExistsParameters): Promise<string> => {
  const now = new Date().toISOString();

  // Material が存在しない場合は INSERT
  const existingMaterial = await database
    .select({ identifier: materials.identifier })
    .from(materials)
    .where(eq(materials.identifier, materialIdentifier))
    .limit(1);

  if (existingMaterial.length === 0) {
    await database
      .insert(materials)
      .values({
        identifier: materialIdentifier,
        title: materialTitle,
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
    .where(eq(sectionSeries.identifier, seriesIdentifier))
    .limit(1);

  if (existingSeriesRows.length === 0) {
    await database
      .insert(sectionSeries)
      .values({
        identifier: seriesIdentifier,
        material: materialIdentifier,
        title: seriesTitle,
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
    await database
      .insert(sections)
      .values({
        identifier: sectionIdentifier,
        sectionSeries: seriesIdentifier,
        versionNumber: 1,
        bodyText,
        bodyTextHash,
        createdAt: now,
      })
      .onConflictDoNothing();
  }

  return sectionIdentifier;
};
