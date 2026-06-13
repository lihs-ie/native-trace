import { eq, and, isNull, asc } from "drizzle-orm";
import { type DrizzleDatabase } from "../client";
import { trainingSessions } from "../schema";
import { type TrainingSessionRepository } from "../../../usecase/port/training-session-repository";
import {
  type TrainingSession,
  type InProgressTrainingSession,
  type CompletedTrainingSession,
  type AbortedTrainingSession,
  type TrainingSessionIdentifier,
  type LearnerIdentifier,
  type TrainingKind,
  type PhonemeContrast,
  type Accuracy0To1,
  createTrainingSessionIdentifier,
  createLearnerIdentifier,
  createTrainingKind,
  createAccuracy0To1,
} from "../../../domain/training";
import { type DomainError } from "../../../domain/shared";
import { okAsync, errAsync } from "neverthrow";

type TrainingSessionRow = typeof trainingSessions.$inferSelect;

const rowToTrainingSession = (row: TrainingSessionRow): TrainingSession => {
  const identifier = createTrainingSessionIdentifier(row.identifier);
  if (!identifier) throw new Error(`Invalid TrainingSessionIdentifier: ${row.identifier}`);

  const learner = createLearnerIdentifier(row.learner);
  if (!learner) throw new Error(`Invalid LearnerIdentifier: ${row.learner}`);

  const kind = createTrainingKind(row.kind);
  if (!kind) throw new Error(`Invalid TrainingKind: ${row.kind}`);

  const contrast = row.contrast as PhonemeContrast;

  if (row.status === "completed") {
    if (!row.endedAt || row.durationMinutes == null) {
      throw new Error(
        `Completed TrainingSession must have endedAt and durationMinutes: ${row.identifier}`,
      );
    }
    let sessionAccuracy: Accuracy0To1 | null = null;
    if (row.sessionAccuracy != null) {
      const accuracyResult = createAccuracy0To1(row.sessionAccuracy);
      if (accuracyResult.isErr()) {
        throw new Error(
          `Invalid sessionAccuracy for TrainingSession ${row.identifier}: ${row.sessionAccuracy}`,
        );
      }
      sessionAccuracy = accuracyResult.value;
    }
    const completed: CompletedTrainingSession = {
      type: "completed",
      identifier,
      learner,
      kind: kind as TrainingKind,
      contrast,
      startedAt: new Date(row.startedAt),
      endedAt: new Date(row.endedAt),
      durationMinutes: row.durationMinutes as CompletedTrainingSession["durationMinutes"],
      sessionAccuracy,
    };
    return completed;
  }

  if (row.status === "aborted") {
    if (!row.abortedAt) {
      throw new Error(`Aborted TrainingSession must have abortedAt: ${row.identifier}`);
    }
    const aborted: AbortedTrainingSession = {
      type: "aborted",
      identifier,
      learner,
      kind: kind as TrainingKind,
      contrast,
      startedAt: new Date(row.startedAt),
      abortedAt: new Date(row.abortedAt),
    };
    return aborted;
  }

  const inProgress: InProgressTrainingSession = {
    type: "in_progress",
    identifier,
    learner,
    kind: kind as TrainingKind,
    contrast,
    startedAt: new Date(row.startedAt),
  };
  return inProgress;
};

const trainingSessionToRow = (session: TrainingSession): TrainingSessionRow => {
  const now = new Date().toISOString();
  const base = {
    identifier: String(session.identifier),
    learner: String(session.learner),
    kind: session.kind,
    contrast: String(session.contrast),
    createdAt: session.startedAt.toISOString(),
    updatedAt: now,
    deletedAt: null,
  };

  if (session.type === "completed") {
    return {
      ...base,
      status: "completed",
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt.toISOString(),
      abortedAt: null,
      durationMinutes: Number(session.durationMinutes),
      sessionAccuracy: session.sessionAccuracy != null ? Number(session.sessionAccuracy) : null,
    };
  }

  if (session.type === "aborted") {
    return {
      ...base,
      status: "aborted",
      startedAt: session.startedAt.toISOString(),
      endedAt: null,
      abortedAt: session.abortedAt.toISOString(),
      durationMinutes: null,
      sessionAccuracy: null,
    };
  }

  return {
    ...base,
    status: "in_progress",
    startedAt: session.startedAt.toISOString(),
    endedAt: null,
    abortedAt: null,
    durationMinutes: null,
    sessionAccuracy: null,
  };
};

export const createDrizzleTrainingSessionRepository = (
  db: DrizzleDatabase,
): TrainingSessionRepository => ({
  find: (identifier: TrainingSessionIdentifier) => {
    return okAsync(null).andThen(() => {
      try {
        const row = db
          .select()
          .from(trainingSessions)
          .where(
            and(
              eq(trainingSessions.identifier, String(identifier)),
              isNull(trainingSessions.deletedAt),
            ),
          )
          .get();

        if (!row) {
          return errAsync({
            type: "notFound",
            resource: "TrainingSession",
            identifier: String(identifier),
          } as DomainError);
        }

        return okAsync(rowToTrainingSession(row));
      } catch (e) {
        return errAsync({ type: "persistenceFailed", reason: String(e) } as DomainError);
      }
    });
  },

  findByLearnerAndContrastOrderedByStartedAt: (learner: LearnerIdentifier, contrast: string) => {
    return okAsync(null).andThen(() => {
      try {
        const rows = db
          .select()
          .from(trainingSessions)
          .where(
            and(
              eq(trainingSessions.learner, String(learner)),
              eq(trainingSessions.contrast, contrast),
              isNull(trainingSessions.deletedAt),
            ),
          )
          .orderBy(asc(trainingSessions.startedAt))
          .all();

        return okAsync(rows.map(rowToTrainingSession));
      } catch (e) {
        return errAsync({ type: "persistenceFailed", reason: String(e) } as DomainError);
      }
    });
  },

  persist: (session: TrainingSession) => {
    return okAsync(null).andThen(() => {
      try {
        const row = trainingSessionToRow(session);
        db.insert(trainingSessions)
          .values(row)
          .onConflictDoUpdate({
            target: trainingSessions.identifier,
            set: {
              status: row.status,
              endedAt: row.endedAt,
              abortedAt: row.abortedAt,
              durationMinutes: row.durationMinutes,
              sessionAccuracy: row.sessionAccuracy,
              updatedAt: row.updatedAt,
            },
          })
          .run();
        return okAsync(undefined);
      } catch (e) {
        return errAsync({ type: "persistenceFailed", reason: String(e) } as DomainError);
      }
    });
  },
});
