import { eq, desc } from "drizzle-orm";
import { type DrizzleDatabase } from "../client";
import { analysisRuns } from "../schema";
import {
  type AnalysisRunRepository,
  type AnalysisRunPage,
} from "../../../usecase/port/analysis-run-repository";
import {
  type AnalysisRun,
  type AnalysisRunIdentifier,
  type AnalysisRunStatus,
  type AnalysisMode,
  createAnalysisRunIdentifier,
} from "../../../domain/analysis-run";
import { type RecordingAttemptIdentifier } from "../../../domain/recording-attempt";
import { type AnalysisRunSearchCriteria } from "../../../domain/criteria";
import { notFound } from "../../../domain/shared";
import { okAsync, errAsync } from "neverthrow";
import { tryPersistence, tryPersistenceResult } from "./try-persistence";

type AnalysisRunRow = typeof analysisRuns.$inferSelect;

const rowToAnalysisRun = (row: AnalysisRunRow): AnalysisRun => {
  const identifier = createAnalysisRunIdentifier(row.identifier);
  if (!identifier) throw new Error(`Invalid AnalysisRunIdentifier: ${row.identifier}`);

  return {
    identifier,
    recordingAttempt: row.recordingAttempt as RecordingAttemptIdentifier,
    mode: row.mode as AnalysisMode,
    status: row.status as AnalysisRunStatus,
    createdAt: new Date(row.createdAt),
  };
};

const analysisRunToRow = (analysisRun: AnalysisRun): AnalysisRunRow => {
  return {
    identifier: String(analysisRun.identifier),
    recordingAttempt: String(analysisRun.recordingAttempt),
    mode: analysisRun.mode,
    status: analysisRun.status,
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    createdAt: analysisRun.createdAt.toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  };
};

export const createDrizzleAnalysisRunRepository = (db: DrizzleDatabase): AnalysisRunRepository => ({
  find: (identifier: AnalysisRunIdentifier) => {
    return tryPersistenceResult(() => {
      const row = db
        .select()
        .from(analysisRuns)
        .where(eq(analysisRuns.identifier, String(identifier)))
        .get();

      if (!row || row.deletedAt) {
        return errAsync(notFound("AnalysisRun", String(identifier)));
      }

      return okAsync(rowToAnalysisRun(row));
    });
  },

  search: (criteria: AnalysisRunSearchCriteria) => {
    return tryPersistence(() => {
      if (criteria.type === "runsByRecordingAttempt") {
        const rows = db
          .select()
          .from(analysisRuns)
          .where(eq(analysisRuns.recordingAttempt, String(criteria.recordingAttempt)))
          .orderBy(desc(analysisRuns.createdAt))
          .offset(criteria.pagination.offset)
          .limit(criteria.pagination.limit)
          .all()
          .filter((r) => !r.deletedAt);

        const countRows = db
          .select()
          .from(analysisRuns)
          .where(eq(analysisRuns.recordingAttempt, String(criteria.recordingAttempt)))
          .all()
          .filter((r) => !r.deletedAt);

        return {
          items: rows.map(rowToAnalysisRun),
          total: countRows.length,
        } as AnalysisRunPage;
      }

      // runsForHistory
      const rows = db
        .select()
        .from(analysisRuns)
        .orderBy(desc(analysisRuns.createdAt))
        .offset(criteria.pagination.offset)
        .limit(criteria.pagination.limit)
        .all()
        .filter((r) => !r.deletedAt);

      return {
        items: rows.map(rowToAnalysisRun),
        total: rows.length,
      } as AnalysisRunPage;
    });
  },

  persist: (analysisRun: AnalysisRun) => {
    return tryPersistence(() => {
      const row = analysisRunToRow(analysisRun);
      db.insert(analysisRuns)
        .values(row)
        .onConflictDoUpdate({
          target: analysisRuns.identifier,
          set: {
            updatedAt: row.updatedAt,
          },
        })
        .run();
      return undefined;
    });
  },

  updateStatus: (identifier: AnalysisRunIdentifier, status: AnalysisRunStatus) => {
    return tryPersistence(() => {
      const now = new Date().toISOString();
      db.update(analysisRuns)
        .set({ status, updatedAt: now })
        .where(eq(analysisRuns.identifier, String(identifier)))
        .run();
      return undefined;
    });
  },
});
