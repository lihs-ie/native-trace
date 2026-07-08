import { eq, desc } from "drizzle-orm";
import { type DrizzleDatabase } from "../client";
import { recordingAttempts } from "../schema";
import {
  type RecordingAttemptRepository,
  type RecordingAttemptPage,
} from "../../../usecase/port/recording-attempt-repository";
import {
  type RecordingAttempt,
  type ReadyRecordingAttempt,
  type SavingRecordingAttempt,
  type RecordingAttemptIdentifier,
  type RecordingDuration,
  type RecordingOrigin,
  type BrowserEnvironment,
  type OriginalFileName,
  createRecordingAttemptIdentifier,
  createRecordingFailureReason,
} from "../../../domain/recording-attempt";
import { type SectionIdentifier } from "../../../domain/section";
import { type AudioFileIdentifier } from "../../../domain/audio-file";
import { type RecordingAttemptSearchCriteria } from "../../../domain/criteria";
import { notFound } from "../../../domain/shared";
import { okAsync, errAsync } from "neverthrow";
import { tryPersistence, tryPersistenceResult } from "./try-persistence";

type RecordingAttemptRow = typeof recordingAttempts.$inferSelect;

const rowToRecordingAttempt = (row: RecordingAttemptRow): RecordingAttempt => {
  const identifier = createRecordingAttemptIdentifier(row.identifier);
  if (!identifier) throw new Error(`Invalid RecordingAttemptIdentifier: ${row.identifier}`);

  const section = row.section as SectionIdentifier;

  if (row.deletedAt) {
    return {
      type: "deleted",
      identifier,
      section,
      deletedAt: new Date(row.deletedAt),
    };
  }

  if (row.status === "failed") {
    return {
      type: "failed",
      identifier,
      section,
      inputKind: row.inputKind as RecordingOrigin["type"],
      failedAt: new Date(row.updatedAt),
      failureReason: createRecordingFailureReason(row.failureReason ?? ""),
    };
  }

  if (row.status === "saving") {
    return {
      type: "saving",
      identifier,
      section,
      inputKind: row.inputKind as RecordingOrigin["type"],
      createdAt: new Date(row.createdAt),
    } as SavingRecordingAttempt;
  }

  // ready
  let origin: RecordingOrigin;
  if (row.inputKind === "browser_recording") {
    const browserEnvironment = row.browserInfoJson
      ? (JSON.parse(row.browserInfoJson) as BrowserEnvironment)
      : { browserName: "", deviceType: "pc" as const, recordingApiType: "", userAgent: "" };
    origin = {
      type: "browser_recording",
      startedAt: new Date(row.startedAt ?? row.createdAt),
      endedAt: new Date(row.endedAt ?? row.updatedAt),
      browserEnvironment,
    };
  } else {
    origin = {
      type: "uploaded_file",
      originalFileName: (row.originalFileName ?? "") as OriginalFileName,
      uploadedAt: new Date(row.createdAt),
    };
  }

  return {
    type: "ready",
    identifier,
    section,
    audioFile: identifier as unknown as AudioFileIdentifier,
    origin,
    duration: (row.durationMilliseconds ?? 0) as RecordingDuration,
    createdAt: new Date(row.createdAt),
  } as ReadyRecordingAttempt;
};

const recordingAttemptToRow = (attempt: RecordingAttempt): RecordingAttemptRow => {
  const base = {
    identifier: String(attempt.identifier),
    section: String(attempt.section),
    createdAt:
      "createdAt" in attempt ? (attempt.createdAt as Date).toISOString() : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null as string | null,
    startedAt: null as string | null,
    endedAt: null as string | null,
    durationMilliseconds: null as number | null,
    browserInfoJson: null as string | null,
    originalFileName: null as string | null,
    failureReason: null as string | null,
  };

  if (attempt.type === "deleted") {
    return {
      ...base,
      status: "saving",
      inputKind: "browser_recording",
      updatedAt: attempt.deletedAt.toISOString(),
      deletedAt: attempt.deletedAt.toISOString(),
    };
  }

  if (attempt.type === "failed") {
    return {
      ...base,
      status: "failed",
      inputKind: attempt.inputKind,
      failureReason: String(attempt.failureReason),
      updatedAt: attempt.failedAt.toISOString(),
    };
  }

  if (attempt.type === "saving") {
    return {
      ...base,
      status: "saving",
      inputKind: attempt.inputKind,
    };
  }

  // ready
  const row = {
    ...base,
    status: "ready",
    inputKind: attempt.origin.type,
    durationMilliseconds: attempt.duration,
  };

  if (attempt.origin.type === "browser_recording") {
    return {
      ...row,
      startedAt: attempt.origin.startedAt.toISOString(),
      endedAt: attempt.origin.endedAt.toISOString(),
      browserInfoJson: JSON.stringify(attempt.origin.browserEnvironment),
    };
  }

  return {
    ...row,
    originalFileName: String(attempt.origin.originalFileName),
  };
};

export const createDrizzleRecordingAttemptRepository = (
  db: DrizzleDatabase,
): RecordingAttemptRepository => ({
  find: (identifier: RecordingAttemptIdentifier) => {
    return tryPersistenceResult(() => {
      const row = db
        .select()
        .from(recordingAttempts)
        .where(eq(recordingAttempts.identifier, String(identifier)))
        .get();

      if (!row || row.deletedAt || row.status !== "ready") {
        return errAsync(notFound("ReadyRecordingAttempt", String(identifier)));
      }

      return okAsync(rowToRecordingAttempt(row) as ReadyRecordingAttempt);
    });
  },

  findSaving: (identifier: RecordingAttemptIdentifier) => {
    return tryPersistenceResult(() => {
      const row = db
        .select()
        .from(recordingAttempts)
        .where(eq(recordingAttempts.identifier, String(identifier)))
        .get();

      if (!row || row.deletedAt || row.status !== "saving") {
        return errAsync(notFound("SavingRecordingAttempt", String(identifier)));
      }

      return okAsync(rowToRecordingAttempt(row) as SavingRecordingAttempt);
    });
  },

  search: (criteria: RecordingAttemptSearchCriteria) => {
    return tryPersistence(() => {
      if (criteria.type === "attemptsInSection") {
        const rows = db
          .select()
          .from(recordingAttempts)
          .where(eq(recordingAttempts.section, String(criteria.section)))
          .orderBy(desc(recordingAttempts.createdAt))
          .offset(criteria.pagination.offset)
          .limit(criteria.pagination.limit)
          .all()
          .filter((r) => !r.deletedAt);

        const countRows = db
          .select()
          .from(recordingAttempts)
          .where(eq(recordingAttempts.section, String(criteria.section)))
          .all()
          .filter((r) => !r.deletedAt);

        return {
          items: rows.map(rowToRecordingAttempt),
          total: countRows.length,
        } as RecordingAttemptPage;
      }

      // attemptsForHistory — section_series 経由の結合が必要だが MVP では section 直引きで代替
      const rows = db
        .select()
        .from(recordingAttempts)
        .orderBy(desc(recordingAttempts.createdAt))
        .offset(criteria.pagination.offset)
        .limit(criteria.pagination.limit)
        .all()
        .filter((r) => !r.deletedAt);

      return {
        items: rows.map(rowToRecordingAttempt),
        total: rows.length,
      } as RecordingAttemptPage;
    });
  },

  persist: (attempt: RecordingAttempt) => {
    return tryPersistence(() => {
      const row = recordingAttemptToRow(attempt);
      db.insert(recordingAttempts)
        .values(row)
        .onConflictDoUpdate({
          target: recordingAttempts.identifier,
          set: {
            status: row.status,
            startedAt: row.startedAt,
            endedAt: row.endedAt,
            durationMilliseconds: row.durationMilliseconds,
            browserInfoJson: row.browserInfoJson,
            originalFileName: row.originalFileName,
            failureReason: row.failureReason,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
          },
        })
        .run();
      return undefined;
    });
  },
});
