import { eq, desc, asc } from "drizzle-orm";
import { type DrizzleDatabase } from "../client";
import { sectionSeries } from "../schema";
import {
  type SectionSeriesRepository,
  type SectionSeriesPage,
} from "../../../usecase/port/section-series-repository";
import {
  type SectionSeries,
  type ActiveSectionSeries,
  type SectionSeriesIdentifier,
  type SectionTitle,
  type SectionDisplayOrder,
  createSectionSeriesIdentifier,
} from "../../../domain/section-series";
import { type MaterialIdentifier } from "../../../domain/material";
import { type SectionSeriesSearchCriteria } from "../../../domain/criteria";
import { notFound } from "../../../domain/shared";
import { okAsync, errAsync } from "neverthrow";
import { tryPersistence, tryPersistenceResult } from "./try-persistence";

type SectionSeriesRow = typeof sectionSeries.$inferSelect;

const rowToSectionSeries = (row: SectionSeriesRow): SectionSeries => {
  const identifier = createSectionSeriesIdentifier(row.identifier);
  if (!identifier) throw new Error(`Invalid SectionSeriesIdentifier: ${row.identifier}`);

  const material = row.material as MaterialIdentifier;
  const title = row.title as SectionTitle;
  const displayOrder = row.displayOrder as SectionDisplayOrder;

  if (row.deletedAt) {
    return {
      type: "deleted",
      identifier,
      material,
      title,
      deletedAt: new Date(row.deletedAt),
    };
  }

  return {
    type: "active",
    identifier,
    material,
    title,
    displayOrder,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
};

const sectionSeriesToRow = (series: SectionSeries): SectionSeriesRow => {
  if (series.type === "deleted") {
    return {
      identifier: String(series.identifier),
      material: String(series.material),
      title: String(series.title),
      displayOrder: 0,
      createdAt: series.deletedAt.toISOString(),
      updatedAt: series.deletedAt.toISOString(),
      deletedAt: series.deletedAt.toISOString(),
    };
  }
  return {
    identifier: String(series.identifier),
    material: String(series.material),
    title: String(series.title),
    displayOrder: series.displayOrder,
    createdAt: series.createdAt.toISOString(),
    updatedAt: series.updatedAt.toISOString(),
    deletedAt: null,
  };
};

export const createDrizzleSectionSeriesRepository = (
  db: DrizzleDatabase,
): SectionSeriesRepository => ({
  find: (identifier: SectionSeriesIdentifier) => {
    return tryPersistenceResult(() => {
      const row = db
        .select()
        .from(sectionSeries)
        .where(eq(sectionSeries.identifier, String(identifier)))
        .get();

      if (!row || row.deletedAt) {
        return errAsync(notFound("SectionSeries", String(identifier)));
      }

      return okAsync(rowToSectionSeries(row) as ActiveSectionSeries);
    });
  },

  search: (criteria: SectionSeriesSearchCriteria) => {
    return tryPersistence(() => {
      if (criteria.type === "activeSeriesInMaterial") {
        const rows = db
          .select()
          .from(sectionSeries)
          .where(eq(sectionSeries.material, String(criteria.material)))
          .orderBy(asc(sectionSeries.displayOrder))
          .offset(criteria.pagination.offset)
          .limit(criteria.pagination.limit)
          .all()
          .filter((r) => !r.deletedAt);

        const countRows = db
          .select()
          .from(sectionSeries)
          .where(eq(sectionSeries.material, String(criteria.material)))
          .all()
          .filter((r) => !r.deletedAt);

        return {
          items: rows.map(rowToSectionSeries),
          total: countRows.length,
        } as SectionSeriesPage;
      }

      // seriesForHistory
      const rows = db
        .select()
        .from(sectionSeries)
        .where(eq(sectionSeries.material, String(criteria.material)))
        .orderBy(desc(sectionSeries.updatedAt))
        .offset(criteria.pagination.offset)
        .limit(criteria.pagination.limit)
        .all();

      const countRows = db
        .select()
        .from(sectionSeries)
        .where(eq(sectionSeries.material, String(criteria.material)))
        .all();

      return {
        items: rows.map(rowToSectionSeries),
        total: countRows.length,
      } as SectionSeriesPage;
    });
  },

  persist: (series: SectionSeries) => {
    return tryPersistence(() => {
      const row = sectionSeriesToRow(series);
      db.insert(sectionSeries)
        .values(row)
        .onConflictDoUpdate({
          target: sectionSeries.identifier,
          set: {
            title: row.title,
            displayOrder: row.displayOrder,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
          },
        })
        .run();
      return undefined;
    });
  },
});
