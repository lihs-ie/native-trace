import { eq, isNull, desc } from "drizzle-orm";
import { type DrizzleDatabase } from "../client";
import { materials } from "../schema";
import {
  type MaterialRepository,
  type MaterialPage,
} from "../../../usecase/port/material-repository";
import {
  type Material,
  type ActiveMaterial,
  type MaterialIdentifier,
  type MaterialTitle,
  type MaterialSource,
  createMaterialIdentifier,
} from "../../../domain/material";
import { type MaterialSearchCriteria } from "../../../domain/criteria";
import { notFound } from "../../../domain/shared";
import { okAsync, errAsync } from "neverthrow";
import { tryPersistence, tryPersistenceResult } from "./try-persistence";

type MaterialRow = typeof materials.$inferSelect;

const rowToMaterial = (row: MaterialRow): Material => {
  const identifier = createMaterialIdentifier(row.identifier);
  if (!identifier) throw new Error(`Invalid MaterialIdentifier: ${row.identifier}`);

  const title = row.title as MaterialTitle;

  if (row.deletedAt) {
    return {
      type: "deleted",
      identifier,
      title,
      deletedAt: new Date(row.deletedAt),
    };
  }

  let source: MaterialSource | null = null;
  if (row.sourceJson) {
    try {
      source = JSON.parse(row.sourceJson) as MaterialSource;
    } catch {
      source = null;
    }
  }

  return {
    type: "active",
    identifier,
    title,
    source,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
};

const materialToRow = (material: Material): MaterialRow => {
  if (material.type === "deleted") {
    return {
      identifier: String(material.identifier),
      title: String(material.title),
      sourceJson: null,
      createdAt: material.deletedAt.toISOString(),
      updatedAt: material.deletedAt.toISOString(),
      deletedAt: material.deletedAt.toISOString(),
    };
  }
  return {
    identifier: String(material.identifier),
    title: String(material.title),
    sourceJson: material.source ? JSON.stringify(material.source) : null,
    createdAt: material.createdAt.toISOString(),
    updatedAt: material.updatedAt.toISOString(),
    deletedAt: null,
  };
};

export const createDrizzleMaterialRepository = (db: DrizzleDatabase): MaterialRepository => ({
  find: (identifier: MaterialIdentifier) => {
    return tryPersistenceResult(() => {
      const row = db
        .select()
        .from(materials)
        .where(eq(materials.identifier, String(identifier)))
        .get();

      if (!row || row.deletedAt) {
        return errAsync(notFound("Material", String(identifier)));
      }

      return okAsync(rowToMaterial(row) as ActiveMaterial);
    });
  },

  search: (criteria: MaterialSearchCriteria) => {
    return tryPersistence(() => {
      if (criteria.type === "activeMaterials") {
        const rows = db
          .select()
          .from(materials)
          .where(isNull(materials.deletedAt))
          .orderBy(desc(materials.updatedAt))
          .offset(criteria.pagination.offset)
          .limit(criteria.pagination.limit)
          .all();

        const countRows = db.select().from(materials).where(isNull(materials.deletedAt)).all();

        return {
          items: rows.map(rowToMaterial),
          total: countRows.length,
        } as MaterialPage;
      }

      // includingRetiredForHistory
      const rows = db
        .select()
        .from(materials)
        .orderBy(desc(materials.updatedAt))
        .offset(criteria.pagination.offset)
        .limit(criteria.pagination.limit)
        .all();

      const countRows = db.select().from(materials).all();

      return {
        items: rows.map(rowToMaterial),
        total: countRows.length,
      } as MaterialPage;
    });
  },

  persist: (material: Material) => {
    return tryPersistence(() => {
      const row = materialToRow(material);
      db.insert(materials)
        .values(row)
        .onConflictDoUpdate({
          target: materials.identifier,
          set: {
            title: row.title,
            sourceJson: row.sourceJson,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
          },
        })
        .run();
      return undefined;
    });
  },
});
