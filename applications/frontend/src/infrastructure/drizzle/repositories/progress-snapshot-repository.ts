import { eq, and, isNull, asc } from "drizzle-orm";
import { type DrizzleDatabase } from "../client";
import { progressSnapshots } from "../schema";
import { type ProgressSnapshotRepository } from "../../../usecase/port/progress-snapshot-repository";
import {
  type ProgressSnapshot,
  type ProgressSnapshotIdentifier,
  type LearnerIdentifier,
  type FocusScore,
  type PhonemeContrast,
  createProgressSnapshotIdentifier,
  createLearnerIdentifier,
  createControlledTaskKind,
  createCefrSubscaleScores,
  createFocusScore,
  createCumulativeTrainingMinutes,
} from "../../../domain/training";
import { type SectionIdentifier } from "../../../domain/section";
import { type AssessmentResultIdentifier } from "../../../domain/assessment-result";
import { createNonEmptyList, notFound } from "../../../domain/shared";
import { okAsync, errAsync } from "neverthrow";
import { tryPersistence, tryPersistenceResult } from "./try-persistence";

type ProgressSnapshotRow = typeof progressSnapshots.$inferSelect;

type FocusScoreJson = Readonly<{
  contrast: string;
  score: number;
}>;

const rowToProgressSnapshot = (row: ProgressSnapshotRow): ProgressSnapshot => {
  const identifier = createProgressSnapshotIdentifier(row.identifier);
  if (!identifier) throw new Error(`Invalid ProgressSnapshotIdentifier: ${row.identifier}`);

  const learner = createLearnerIdentifier(row.learner);
  if (!learner) throw new Error(`Invalid LearnerIdentifier: ${row.learner}`);

  const taskKind = createControlledTaskKind(row.taskKind);
  if (!taskKind) throw new Error(`Invalid ControlledTaskKind: ${row.taskKind}`);

  const cefrScoresResult = createCefrSubscaleScores(
    row.cefrOverallScore,
    row.cefrSegmentalScore,
    row.cefrProsodicScore,
  );
  if (cefrScoresResult.isErr()) {
    throw new Error(`Invalid CefrSubscaleScores for snapshot: ${row.identifier}`);
  }

  const focusScoresJson = JSON.parse(row.focusScoresJson) as FocusScoreJson[];
  const focusScoreList: FocusScore[] = focusScoresJson.map((json) => {
    const result = createFocusScore(json.contrast, json.score);
    if (result.isErr()) {
      throw new Error(`Invalid FocusScore in snapshot ${row.identifier}: ${json.contrast}`);
    }
    return result.value;
  });

  const focusScores = createNonEmptyList(focusScoreList);
  if (!focusScores) {
    throw new Error(
      `ProgressSnapshot must have non-empty focusScores (DD-205不変条件3): ${row.identifier}`,
    );
  }

  const cumulativeResult = createCumulativeTrainingMinutes(row.cumulativeTrainingMinutes);
  if (cumulativeResult.isErr()) {
    throw new Error(`Invalid CumulativeTrainingMinutes for snapshot: ${row.identifier}`);
  }

  return {
    identifier,
    learner,
    section: row.section !== null ? (row.section as SectionIdentifier) : null,
    sourceAssessment:
      row.sourceAssessment !== null ? (row.sourceAssessment as AssessmentResultIdentifier) : null,
    taskKind,
    cefrScores: cefrScoresResult.value,
    focusScores,
    cumulativeTrainingMinutes: cumulativeResult.value,
    capturedAt: new Date(row.capturedAt),
  };
};

const progressSnapshotToRow = (snapshot: ProgressSnapshot): ProgressSnapshotRow => {
  const focusScoresJson: FocusScoreJson[] = snapshot.focusScores.map((fs) => ({
    contrast: String(fs.contrast as PhonemeContrast),
    score: Number(fs.score),
  }));

  return {
    identifier: String(snapshot.identifier),
    learner: String(snapshot.learner),
    section: snapshot.section !== null ? String(snapshot.section) : null,
    sourceAssessment: snapshot.sourceAssessment !== null ? String(snapshot.sourceAssessment) : null,
    taskKind: snapshot.taskKind,
    cefrOverallScore: Number(snapshot.cefrScores.overall),
    cefrSegmentalScore: Number(snapshot.cefrScores.segmental),
    cefrProsodicScore: Number(snapshot.cefrScores.prosodic),
    focusScoresJson: JSON.stringify(focusScoresJson),
    cumulativeTrainingMinutes: Number(snapshot.cumulativeTrainingMinutes),
    capturedAt: snapshot.capturedAt.toISOString(),
    createdAt: snapshot.capturedAt.toISOString(),
    deletedAt: null,
  };
};

export const createDrizzleProgressSnapshotRepository = (
  db: DrizzleDatabase,
): ProgressSnapshotRepository => ({
  save: (snapshot: ProgressSnapshot) => {
    return tryPersistence(() => {
      const row = progressSnapshotToRow(snapshot);
      db.insert(progressSnapshots).values(row).run();
      return undefined;
    });
  },

  findByLearnerOrderedByCapturedAt: (learner: LearnerIdentifier) => {
    return tryPersistence(() => {
      const rows = db
        .select()
        .from(progressSnapshots)
        .where(
          and(eq(progressSnapshots.learner, String(learner)), isNull(progressSnapshots.deletedAt)),
        )
        .orderBy(asc(progressSnapshots.capturedAt))
        .all();

      return rows.map(rowToProgressSnapshot);
    });
  },

  find: (identifier: ProgressSnapshotIdentifier) => {
    return tryPersistenceResult(() => {
      const row = db
        .select()
        .from(progressSnapshots)
        .where(
          and(
            eq(progressSnapshots.identifier, String(identifier)),
            isNull(progressSnapshots.deletedAt),
          ),
        )
        .get();

      if (!row) {
        return errAsync(notFound("ProgressSnapshot", String(identifier)));
      }

      return okAsync(rowToProgressSnapshot(row));
    });
  },
});
