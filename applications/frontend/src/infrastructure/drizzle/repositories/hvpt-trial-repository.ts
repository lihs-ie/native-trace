import { eq, and, isNull, asc } from "drizzle-orm";
import { type DrizzleDatabase } from "../client";
import { hvptTrials } from "../schema";
import { type HvptTrialRepository } from "../../../usecase/port/hvpt-trial-repository";
import {
  type HvptTrial,
  type HvptTrialIdentifier,
  type TrainingSessionIdentifier,
  type ReactionTime,
  type PhonemeContrast,
  createHvptTrialIdentifier,
  createTrainingSessionIdentifier,
  createStimulusIdentifier,
  createResponseLabel,
  createReactionTime,
} from "../../../domain/training";
import { notFound } from "../../../domain/shared";
import { okAsync, errAsync } from "neverthrow";
import { tryPersistence, tryPersistenceResult } from "./try-persistence";

type HvptTrialRow = typeof hvptTrials.$inferSelect;

type ResponseLabelJson = Readonly<{
  type: string;
  value: string;
}>;

const rowToHvptTrial = (row: HvptTrialRow): HvptTrial => {
  const identifier = createHvptTrialIdentifier(row.identifier);
  if (!identifier) throw new Error(`Invalid HvptTrialIdentifier: ${row.identifier}`);

  const trainingSession = createTrainingSessionIdentifier(row.trainingSession);
  if (!trainingSession)
    throw new Error(`Invalid TrainingSessionIdentifier: ${row.trainingSession}`);

  const stimulus = createStimulusIdentifier(row.stimulus);
  if (!stimulus) throw new Error(`Invalid StimulusIdentifier: ${row.stimulus}`);

  const contrast = row.contrast as PhonemeContrast;

  const correctLabelJson = JSON.parse(row.correctLabelJson) as ResponseLabelJson;
  const correctLabelResult = createResponseLabel(correctLabelJson.type, correctLabelJson.value);
  if (correctLabelResult.isErr()) {
    throw new Error(`Invalid correctLabel for HvptTrial ${row.identifier}`);
  }

  const responseJson = JSON.parse(row.responseJson) as ResponseLabelJson;
  const responseResult = createResponseLabel(responseJson.type, responseJson.value);
  if (responseResult.isErr()) {
    throw new Error(`Invalid response for HvptTrial ${row.identifier}`);
  }

  const reactionTimeResult = createReactionTime(row.reactionTimeMilliseconds);
  if (reactionTimeResult.isErr()) {
    throw new Error(`Invalid reactionTimeMilliseconds for HvptTrial ${row.identifier}`);
  }

  return {
    identifier,
    trainingSession,
    stimulus,
    contrast,
    correctLabel: correctLabelResult.value,
    response: responseResult.value,
    correct: row.correct === 1,
    reactionTimeMilliseconds: reactionTimeResult.value as ReactionTime,
    presentedAt: new Date(row.presentedAt),
  };
};

const hvptTrialToRow = (trial: HvptTrial): HvptTrialRow => {
  const correctLabelJson: ResponseLabelJson = {
    type: trial.correctLabel.type,
    value: trial.correctLabel.value,
  };
  const responseJson: ResponseLabelJson = {
    type: trial.response.type,
    value: trial.response.value,
  };

  return {
    identifier: String(trial.identifier),
    trainingSession: String(trial.trainingSession),
    stimulus: String(trial.stimulus),
    contrast: String(trial.contrast as PhonemeContrast),
    correctLabelJson: JSON.stringify(correctLabelJson),
    responseJson: JSON.stringify(responseJson),
    correct: trial.correct ? 1 : 0,
    reactionTimeMilliseconds: Number(trial.reactionTimeMilliseconds),
    presentedAt: trial.presentedAt.toISOString(),
    createdAt: trial.presentedAt.toISOString(),
    deletedAt: null,
  };
};

export const createDrizzleHvptTrialRepository = (db: DrizzleDatabase): HvptTrialRepository => ({
  find: (identifier: HvptTrialIdentifier) => {
    return tryPersistenceResult(() => {
      const row = db
        .select()
        .from(hvptTrials)
        .where(and(eq(hvptTrials.identifier, String(identifier)), isNull(hvptTrials.deletedAt)))
        .get();

      if (!row) {
        return errAsync(notFound("HvptTrial", String(identifier)));
      }

      return okAsync(rowToHvptTrial(row));
    });
  },

  findByTrainingSessionOrderedByPresentedAt: (trainingSession: TrainingSessionIdentifier) => {
    return tryPersistence(() => {
      const rows = db
        .select()
        .from(hvptTrials)
        .where(
          and(
            eq(hvptTrials.trainingSession, String(trainingSession)),
            isNull(hvptTrials.deletedAt),
          ),
        )
        .orderBy(asc(hvptTrials.presentedAt))
        .all();

      return rows.map(rowToHvptTrial);
    });
  },

  save: (trial: HvptTrial) => {
    return tryPersistence(() => {
      const row = hvptTrialToRow(trial);
      db.insert(hvptTrials).values(row).run();
      return undefined;
    });
  },
});
