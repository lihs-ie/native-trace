import { eq, and, isNull, asc } from "drizzle-orm";
import { type DrizzleDatabase } from "../client";
import { spacingSchedules } from "../schema";
import { type SpacingScheduleRepository } from "../../../usecase/port/spacing-schedule-repository";
import {
  type SpacingSchedule,
  type SpacingScheduleIdentifier,
  type LearnerIdentifier,
  type PhonemeContrast,
  type Accuracy0To1,
  createSpacingScheduleIdentifier,
  createLearnerIdentifier,
  createSpacingState,
  createAccuracy0To1,
} from "../../../domain/training";
import { type WeaknessProfileIdentifier } from "../../../domain/training";
import { notFound } from "../../../domain/shared";
import { okAsync, errAsync } from "neverthrow";
import { tryPersistence, tryPersistenceResult } from "./try-persistence";

type SpacingScheduleRow = typeof spacingSchedules.$inferSelect;

const rowToSpacingSchedule = (row: SpacingScheduleRow): SpacingSchedule => {
  const identifier = createSpacingScheduleIdentifier(row.identifier);
  if (!identifier) throw new Error(`Invalid SpacingScheduleIdentifier: ${row.identifier}`);

  const learner = createLearnerIdentifier(row.learner);
  if (!learner) throw new Error(`Invalid LearnerIdentifier: ${row.learner}`);

  const state = createSpacingState(row.state);
  if (!state) throw new Error(`Invalid SpacingState: ${row.state}`);

  const contrast = row.contrast as PhonemeContrast;
  const focusSound = row.focusSound as WeaknessProfileIdentifier;

  let recentAccuracy: Accuracy0To1 | null = null;
  if (row.recentAccuracy != null) {
    const accuracyResult = createAccuracy0To1(row.recentAccuracy);
    if (accuracyResult.isErr()) {
      throw new Error(
        `Invalid recentAccuracy for SpacingSchedule ${row.identifier}: ${row.recentAccuracy}`,
      );
    }
    recentAccuracy = accuracyResult.value;
  }

  return {
    identifier,
    learner,
    focusSound,
    contrast,
    state,
    nextPresentationAt: new Date(row.nextPresentationAt),
    recentAccuracy,
    updatedAt: new Date(row.updatedAt),
  };
};

const spacingScheduleToRow = (schedule: SpacingSchedule): SpacingScheduleRow => {
  const now = new Date().toISOString();
  return {
    identifier: String(schedule.identifier),
    learner: String(schedule.learner),
    focusSound: String(schedule.focusSound),
    contrast: String(schedule.contrast as PhonemeContrast),
    state: schedule.state,
    nextPresentationAt: schedule.nextPresentationAt.toISOString(),
    recentAccuracy: schedule.recentAccuracy != null ? Number(schedule.recentAccuracy) : null,
    createdAt: now,
    updatedAt: schedule.updatedAt.toISOString(),
    deletedAt: null,
  };
};

export const createDrizzleSpacingScheduleRepository = (
  db: DrizzleDatabase,
): SpacingScheduleRepository => ({
  find: (identifier: SpacingScheduleIdentifier) => {
    return tryPersistenceResult(() => {
      const row = db
        .select()
        .from(spacingSchedules)
        .where(
          and(
            eq(spacingSchedules.identifier, String(identifier)),
            isNull(spacingSchedules.deletedAt),
          ),
        )
        .get();

      if (!row) {
        return errAsync(notFound("SpacingSchedule", String(identifier)));
      }

      return okAsync(rowToSpacingSchedule(row));
    });
  },

  findByLearnerAndContrast: (learner: LearnerIdentifier, contrast: string) => {
    return tryPersistence(() => {
      const row = db
        .select()
        .from(spacingSchedules)
        .where(
          and(
            eq(spacingSchedules.learner, String(learner)),
            eq(spacingSchedules.contrast, contrast),
            isNull(spacingSchedules.deletedAt),
          ),
        )
        .get();

      if (!row) {
        return null;
      }

      return rowToSpacingSchedule(row);
    });
  },

  findDueByLearner: (learner: LearnerIdentifier) => {
    return tryPersistence(() => {
      const rows = db
        .select()
        .from(spacingSchedules)
        .where(
          and(
            eq(spacingSchedules.learner, String(learner)),
            eq(spacingSchedules.state, "due"),
            isNull(spacingSchedules.deletedAt),
          ),
        )
        .orderBy(asc(spacingSchedules.nextPresentationAt))
        .all();

      return rows.map(rowToSpacingSchedule);
    });
  },

  findAllByLearner: (learner: LearnerIdentifier) => {
    return tryPersistence(() => {
      const rows = db
        .select()
        .from(spacingSchedules)
        .where(
          and(eq(spacingSchedules.learner, String(learner)), isNull(spacingSchedules.deletedAt)),
        )
        .orderBy(asc(spacingSchedules.nextPresentationAt))
        .all();

      return rows.map(rowToSpacingSchedule);
    });
  },

  persist: (schedule: SpacingSchedule) => {
    return tryPersistence(() => {
      const row = spacingScheduleToRow(schedule);
      db.insert(spacingSchedules)
        .values(row)
        .onConflictDoUpdate({
          target: spacingSchedules.identifier,
          set: {
            state: row.state,
            nextPresentationAt: row.nextPresentationAt,
            recentAccuracy: row.recentAccuracy,
            updatedAt: row.updatedAt,
          },
        })
        .run();
      return undefined;
    });
  },
});
