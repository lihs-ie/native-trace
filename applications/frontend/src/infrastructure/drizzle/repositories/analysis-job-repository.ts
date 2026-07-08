import { eq, and, or, lt, lte, inArray, desc, asc, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";
import { type DrizzleDatabase } from "../client";
import { analysisJobs } from "../schema";
import {
  type AnalysisJobRepository,
  type AnalysisJobPage,
} from "../../../usecase/port/analysis-job-repository";
import {
  type AnalysisJob,
  type LeasedAnalysisJob,
  type AnalysisJobIdentifier,
  type EngineType,
  createAnalysisJobIdentifier,
  createAnalysisLeaseToken,
} from "../../../domain/analysis-job";
import { type AnalysisRunIdentifier } from "../../../domain/analysis-run";
import { type AnalysisJobSearchCriteria } from "../../../domain/criteria";
import { notFound } from "../../../domain/shared";
import { okAsync, errAsync } from "neverthrow";
import { tryPersistence, tryPersistenceResult } from "./try-persistence";

type AnalysisJobRow = typeof analysisJobs.$inferSelect;

const rowToAnalysisJob = (row: AnalysisJobRow): AnalysisJob => {
  const identifier = createAnalysisJobIdentifier(row.identifier);
  if (!identifier) throw new Error(`Invalid AnalysisJobIdentifier: ${row.identifier}`);

  const analysisRun = row.analysisRun as AnalysisRunIdentifier;
  const engine = row.engine as EngineType;

  const base = {
    identifier,
    analysisRun,
    engine,
    engineConfigJson: row.engineConfigJson,
    priority: row.priority,
    queuedAt: new Date(row.queuedAt),
    createdAt: new Date(row.createdAt),
  };

  if (row.status === "queued") {
    return {
      ...base,
      type: "queued",
      attemptCount: row.attemptCount,
      maxAttempts: row.maxAttempts,
      nextRunAt: new Date(row.nextRunAt),
    };
  }

  if (row.status === "leased") {
    const leaseToken = createAnalysisLeaseToken(row.leaseToken ?? "");
    if (!leaseToken) throw new Error("Missing leaseToken for leased job");
    return {
      ...base,
      type: "leased",
      attemptCount: row.attemptCount,
      maxAttempts: row.maxAttempts,
      leaseToken,
      leasedUntil: new Date(row.leasedUntil ?? row.nextRunAt),
      leaseOwner: row.leaseOwner ?? "",
      nextRunAt: new Date(row.nextRunAt),
    };
  }

  if (row.status === "running") {
    const leaseToken = createAnalysisLeaseToken(row.leaseToken ?? "");
    if (!leaseToken) throw new Error("Missing leaseToken for running job");
    return {
      ...base,
      type: "running",
      attemptCount: row.attemptCount,
      maxAttempts: row.maxAttempts,
      leaseToken,
      leasedUntil: new Date(row.leasedUntil ?? row.nextRunAt),
      leaseOwner: row.leaseOwner ?? "",
      startedAt: new Date(row.startedAt ?? row.createdAt),
    };
  }

  if (row.status === "succeeded") {
    return {
      ...base,
      type: "succeeded",
      completedAt: new Date(row.completedAt ?? row.createdAt),
    };
  }

  if (row.status === "failed") {
    return {
      ...base,
      type: "failed",
      completedAt: new Date(row.completedAt ?? row.createdAt),
      lastErrorCode: row.lastErrorCode,
      lastErrorMessage: row.lastErrorMessage,
    };
  }

  // canceled
  return {
    ...base,
    type: "canceled",
    canceledAt: new Date(row.canceledAt ?? row.createdAt),
  };
};

const rowToLeasedJob = (row: AnalysisJobRow): LeasedAnalysisJob => {
  const job = rowToAnalysisJob(row);
  if (job.type !== "leased") throw new Error("Expected leased job");
  return job;
};

const analysisJobToRow = (job: AnalysisJob): AnalysisJobRow => {
  const now = new Date().toISOString();

  const priority = "priority" in job ? job.priority : 0;

  const base = {
    identifier: String(job.identifier),
    analysisRun: String(job.analysisRun),
    engine: job.engine,
    engineConfigJson: job.engineConfigJson,
    priority,
    queuedAt: job.queuedAt.toISOString(),
    createdAt: job.createdAt.toISOString(),
    updatedAt: now,
    deletedAt: null as string | null,
    leaseOwner: null as string | null,
    leaseToken: null as string | null,
    leasedUntil: null as string | null,
    startedAt: null as string | null,
    completedAt: null as string | null,
    canceledAt: null as string | null,
    lastErrorCode: null as string | null,
    lastErrorMessage: null as string | null,
  };

  if (job.type === "queued") {
    return {
      ...base,
      status: "queued",
      attemptCount: job.attemptCount,
      maxAttempts: job.maxAttempts,
      nextRunAt: job.nextRunAt.toISOString(),
    };
  }

  if (job.type === "leased") {
    return {
      ...base,
      status: "leased",
      attemptCount: job.attemptCount,
      maxAttempts: job.maxAttempts,
      nextRunAt: job.nextRunAt.toISOString(),
      leaseToken: String(job.leaseToken),
      leasedUntil: job.leasedUntil.toISOString(),
      leaseOwner: job.leaseOwner,
    };
  }

  if (job.type === "running") {
    return {
      ...base,
      status: "running",
      attemptCount: job.attemptCount,
      maxAttempts: job.maxAttempts,
      nextRunAt: job.startedAt.toISOString(),
      leaseToken: String(job.leaseToken),
      leasedUntil: job.leasedUntil.toISOString(),
      leaseOwner: job.leaseOwner,
      startedAt: job.startedAt.toISOString(),
    };
  }

  if (job.type === "succeeded") {
    return {
      ...base,
      status: "succeeded",
      attemptCount: 0,
      maxAttempts: 3,
      nextRunAt: job.completedAt.toISOString(),
      completedAt: job.completedAt.toISOString(),
    };
  }

  if (job.type === "failed") {
    return {
      ...base,
      status: "failed",
      attemptCount: 0,
      maxAttempts: 3,
      nextRunAt: job.completedAt.toISOString(),
      completedAt: job.completedAt.toISOString(),
      lastErrorCode: job.lastErrorCode,
      lastErrorMessage: job.lastErrorMessage,
    };
  }

  // canceled
  return {
    ...base,
    status: "canceled",
    attemptCount: 0,
    maxAttempts: 3,
    nextRunAt: job.canceledAt.toISOString(),
    canceledAt: job.canceledAt.toISOString(),
  };
};

export const createDrizzleAnalysisJobRepository = (db: DrizzleDatabase): AnalysisJobRepository => ({
  find: (identifier: AnalysisJobIdentifier) => {
    return tryPersistenceResult(() => {
      const row = db
        .select()
        .from(analysisJobs)
        .where(eq(analysisJobs.identifier, String(identifier)))
        .get();

      if (!row || row.deletedAt) {
        return errAsync(notFound("AnalysisJob", String(identifier)));
      }

      return okAsync(rowToAnalysisJob(row));
    });
  },

  search: (criteria: AnalysisJobSearchCriteria) => {
    return tryPersistence(() => {
      if (criteria.type === "jobsByAnalysisRun") {
        const rows = db
          .select()
          .from(analysisJobs)
          .where(
            and(
              eq(analysisJobs.analysisRun, String(criteria.analysisRun)),
              isNull(analysisJobs.deletedAt),
            ),
          )
          .all();

        return { items: rows.map(rowToAnalysisJob) } as AnalysisJobPage;
      }

      // runnableJobsForInspection
      const rows = db
        .select()
        .from(analysisJobs)
        .where(
          and(
            isNull(analysisJobs.deletedAt),
            inArray(analysisJobs.status, ["queued", "leased", "running"]),
          ),
        )
        .limit(criteria.limit)
        .all();

      return { items: rows.map(rowToAnalysisJob) } as AnalysisJobPage;
    });
  },

  persist: (job: AnalysisJob) => {
    return tryPersistence(() => {
      const row = analysisJobToRow(job);
      db.insert(analysisJobs)
        .values(row)
        .onConflictDoUpdate({
          target: analysisJobs.identifier,
          set: {
            status: row.status,
            attemptCount: row.attemptCount,
            leaseOwner: row.leaseOwner,
            leaseToken: row.leaseToken,
            leasedUntil: row.leasedUntil,
            startedAt: row.startedAt,
            completedAt: row.completedAt,
            canceledAt: row.canceledAt,
            lastErrorCode: row.lastErrorCode,
            lastErrorMessage: row.lastErrorMessage,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
          },
        })
        .run();
      return undefined;
    });
  },

  acquireLease: (leaseOwner: string, leaseDurationMs: number, now: Date) => {
    return tryPersistence(() => {
      const nowIso = now.toISOString();
      const leasedUntilIso = new Date(now.getTime() + leaseDurationMs).toISOString();
      const leaseToken = randomUUID();

      const runnableJob = db
        .select()
        .from(analysisJobs)
        .where(
          and(
            isNull(analysisJobs.deletedAt),
            or(
              and(eq(analysisJobs.status, "queued"), lte(analysisJobs.nextRunAt, nowIso)),
              and(
                inArray(analysisJobs.status, ["leased", "running"]),
                lt(analysisJobs.leasedUntil, nowIso),
              ),
            ),
            lt(analysisJobs.attemptCount, analysisJobs.maxAttempts),
          ),
        )
        .orderBy(
          desc(analysisJobs.priority),
          asc(analysisJobs.nextRunAt),
          asc(analysisJobs.createdAt),
        )
        .limit(1)
        .get();

      if (!runnableJob) return null;

      const updated = db
        .update(analysisJobs)
        .set({
          status: "leased",
          leaseToken,
          leasedUntil: leasedUntilIso,
          leaseOwner,
          attemptCount: runnableJob.attemptCount + 1,
          updatedAt: nowIso,
        })
        .where(
          and(
            eq(analysisJobs.identifier, runnableJob.identifier),
            eq(analysisJobs.status, runnableJob.status),
          ),
        )
        .run();

      if (updated.changes === 0) return null;

      const leasedRow = db
        .select()
        .from(analysisJobs)
        .where(eq(analysisJobs.identifier, runnableJob.identifier))
        .get();

      if (!leasedRow) return null;

      return rowToLeasedJob(leasedRow);
    });
  },
});
