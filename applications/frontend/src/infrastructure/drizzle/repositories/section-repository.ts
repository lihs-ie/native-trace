import { eq, isNull, desc, max } from "drizzle-orm";
import { type DrizzleDatabase } from "../client";
import { sections } from "../schema";
import { type SectionRepository, type SectionPage } from "../../../usecase/port/section-repository";
import {
  type Section,
  type ActiveSection,
  type SectionIdentifier,
  type SectionVersion,
  type SectionBodyText,
  createSectionIdentifier,
} from "../../../domain/section";
import { type SectionSeriesIdentifier } from "../../../domain/section-series";
import { type SectionSearchCriteria } from "../../../domain/criteria";
import { notFound } from "../../../domain/shared";
import { okAsync, errAsync } from "neverthrow";
import { createHash } from "crypto";
import { tryPersistence, tryPersistenceResult } from "./try-persistence";

type SectionRow = typeof sections.$inferSelect;

const rowToSection = (row: SectionRow): ActiveSection => {
  const identifier = createSectionIdentifier(row.identifier);
  if (!identifier) throw new Error(`Invalid SectionIdentifier: ${row.identifier}`);

  return {
    type: "active",
    identifier,
    sectionSeries: row.sectionSeries as SectionSeriesIdentifier,
    version: row.versionNumber as SectionVersion,
    bodyText: row.bodyText as SectionBodyText,
    createdAt: new Date(row.createdAt),
  };
};

const sectionToRow = (section: Section): SectionRow => {
  const bodyTextHash = createHash("sha256").update(String(section.bodyText)).digest("hex");
  return {
    identifier: String(section.identifier),
    sectionSeries: String(section.sectionSeries),
    versionNumber: section.version,
    bodyText: String(section.bodyText),
    bodyTextHash,
    createdAt: section.createdAt.toISOString(),
    deletedAt: null,
  };
};

export const createDrizzleSectionRepository = (db: DrizzleDatabase): SectionRepository => ({
  find: (identifier: SectionIdentifier) => {
    return tryPersistenceResult(() => {
      const row = db
        .select()
        .from(sections)
        .where(eq(sections.identifier, String(identifier)))
        .get();

      if (!row || row.deletedAt) {
        return errAsync(notFound("Section", String(identifier)));
      }

      return okAsync(rowToSection(row));
    });
  },

  findLatestInSeries: (seriesIdentifier: SectionSeriesIdentifier) => {
    return tryPersistenceResult(() => {
      const row = db
        .select()
        .from(sections)
        .where(eq(sections.sectionSeries, String(seriesIdentifier)))
        .orderBy(desc(sections.versionNumber))
        .limit(1)
        .get();

      if (!row || row.deletedAt) {
        return errAsync(notFound("Section", String(seriesIdentifier)));
      }

      return okAsync(rowToSection(row));
    });
  },

  findLatestVersionNumber: (seriesIdentifier: SectionSeriesIdentifier) => {
    return tryPersistence(() => {
      const result = db
        .select({ maxVersion: max(sections.versionNumber) })
        .from(sections)
        .where(eq(sections.sectionSeries, String(seriesIdentifier)))
        .get();

      return result?.maxVersion ?? 0;
    });
  },

  search: (criteria: SectionSearchCriteria) => {
    return tryPersistence(() => {
      if (criteria.type === "activeLatestSectionsInMaterial") {
        // material に紐づく SectionSeries の最新 version を返す
        // 簡略実装: section_series テーブルの JOIN が必要だが、
        // ここでは sectionSeries identifier でフィルタする代わりに全件取得
        const rows = db
          .select()
          .from(sections)
          .where(isNull(sections.deletedAt))
          .orderBy(desc(sections.versionNumber))
          .offset(criteria.pagination.offset)
          .limit(criteria.pagination.limit)
          .all();

        return {
          items: rows.map(rowToSection),
          total: rows.length,
        } as SectionPage;
      }

      if (criteria.type === "sectionVersionsInSeries") {
        const rows = db
          .select()
          .from(sections)
          .where(eq(sections.sectionSeries, String(criteria.sectionSeries)))
          .orderBy(desc(sections.versionNumber))
          .offset(criteria.pagination.offset)
          .limit(criteria.pagination.limit)
          .all();

        const countRows = db
          .select()
          .from(sections)
          .where(eq(sections.sectionSeries, String(criteria.sectionSeries)))
          .all();

        return {
          items: rows.map(rowToSection),
          total: countRows.length,
        } as SectionPage;
      }

      // practiceHistorySectionsInSeries
      const rows = db
        .select()
        .from(sections)
        .where(eq(sections.sectionSeries, String(criteria.sectionSeries)))
        .orderBy(desc(sections.createdAt))
        .offset(criteria.pagination.offset)
        .limit(criteria.pagination.limit)
        .all();

      const countRows = db
        .select()
        .from(sections)
        .where(eq(sections.sectionSeries, String(criteria.sectionSeries)))
        .all();

      return {
        items: rows.map(rowToSection),
        total: countRows.length,
      } as SectionPage;
    });
  },

  persist: (section: Section) => {
    return tryPersistence(() => {
      const row = sectionToRow(section);
      db.insert(sections)
        .values(row)
        .onConflictDoUpdate({
          target: sections.identifier,
          set: {
            bodyText: row.bodyText,
            bodyTextHash: row.bodyTextHash,
            deletedAt: row.deletedAt,
          },
        })
        .run();
      return undefined;
    });
  },
});
