import { eq, and, isNull } from "drizzle-orm";
import { type DrizzleDatabase } from "../client";
import { weaknessProfiles } from "../schema";
import { type WeaknessProfileRepository } from "../../../usecase/port/weakness-profile-repository";
import {
  type WeaknessProfile,
  type WeaknessProfileIdentifier,
  type LearnerIdentifier,
  type FocusSound,
  type PhonemeContrast,
  type CatalogId,
  type OccurrenceFrequency,
  type Mastery0To1,
  type PriorityScore,
  createWeaknessProfileIdentifier,
  createLearnerIdentifier,
  createDiagnosticSessionIdentifier,
} from "../../../domain/training";
import { type FunctionalLoadRank } from "../../../domain/error-catalog";
import { type NonEmptyList, createNonEmptyList, notFound } from "../../../domain/shared";
import { okAsync, errAsync } from "neverthrow";
import { tryPersistence, tryPersistenceResult } from "./try-persistence";

type WeaknessProfileRow = typeof weaknessProfiles.$inferSelect;

type FocusSoundJson = Readonly<{
  contrast: string;
  catalogId: string;
  functionalLoadRank: string;
  occurrenceFrequency: number;
  mastery: number;
  priority: number;
}>;

const rowToWeaknessProfile = (row: WeaknessProfileRow): WeaknessProfile => {
  const identifier = createWeaknessProfileIdentifier(row.identifier);
  if (!identifier) throw new Error(`Invalid WeaknessProfileIdentifier: ${row.identifier}`);

  const learner = createLearnerIdentifier(row.learner);
  if (!learner) throw new Error(`Invalid LearnerIdentifier: ${row.learner}`);

  const diagnosticSession = createDiagnosticSessionIdentifier(row.diagnosticSession);
  if (!diagnosticSession) {
    throw new Error(`Invalid DiagnosticSessionIdentifier: ${row.diagnosticSession}`);
  }

  const focusSoundsJson = JSON.parse(row.focusSoundsJson) as FocusSoundJson[];
  const focusSoundList: FocusSound[] = focusSoundsJson.map((json) => ({
    contrast: json.contrast as PhonemeContrast,
    catalogId: json.catalogId as CatalogId,
    functionalLoadRank: json.functionalLoadRank as FunctionalLoadRank,
    occurrenceFrequency: json.occurrenceFrequency as OccurrenceFrequency,
    mastery: json.mastery as Mastery0To1,
    priority: json.priority as PriorityScore,
  }));

  const focusSounds = createNonEmptyList(focusSoundList);
  if (!focusSounds) {
    throw new Error(
      `WeaknessProfile must have non-empty focusSounds (DD-201不変条件1): ${row.identifier}`,
    );
  }

  return {
    identifier,
    learner,
    diagnosticSession,
    focusSounds: focusSounds as NonEmptyList<FocusSound>,
    lastUpdatedAt: new Date(row.lastUpdatedAt),
    createdAt: new Date(row.createdAt),
  };
};

const weaknessProfileToRow = (profile: WeaknessProfile): WeaknessProfileRow => {
  const now = new Date().toISOString();
  const focusSoundsJson: FocusSoundJson[] = profile.focusSounds.map((sound) => ({
    contrast: String(sound.contrast),
    catalogId: String(sound.catalogId),
    functionalLoadRank: sound.functionalLoadRank,
    occurrenceFrequency: Number(sound.occurrenceFrequency),
    mastery: Number(sound.mastery),
    priority: Number(sound.priority),
  }));

  return {
    identifier: String(profile.identifier),
    learner: String(profile.learner),
    diagnosticSession: String(profile.diagnosticSession),
    focusSoundsJson: JSON.stringify(focusSoundsJson),
    lastUpdatedAt: profile.lastUpdatedAt.toISOString(),
    createdAt: profile.createdAt.toISOString(),
    updatedAt: now,
    deletedAt: null,
  };
};

export const createDrizzleWeaknessProfileRepository = (
  db: DrizzleDatabase,
): WeaknessProfileRepository => ({
  find: (identifier: WeaknessProfileIdentifier) => {
    return tryPersistenceResult(() => {
      const row = db
        .select()
        .from(weaknessProfiles)
        .where(
          and(
            eq(weaknessProfiles.identifier, String(identifier)),
            isNull(weaknessProfiles.deletedAt),
          ),
        )
        .get();

      if (!row) {
        return errAsync(notFound("WeaknessProfile", String(identifier)));
      }

      return okAsync(rowToWeaknessProfile(row));
    });
  },

  findByLearner: (learner: LearnerIdentifier) => {
    return tryPersistence(() => {
      const row = db
        .select()
        .from(weaknessProfiles)
        .where(
          and(eq(weaknessProfiles.learner, String(learner)), isNull(weaknessProfiles.deletedAt)),
        )
        .get();

      if (!row) {
        return null;
      }

      return rowToWeaknessProfile(row);
    });
  },

  persist: (profile: WeaknessProfile) => {
    return tryPersistence(() => {
      const row = weaknessProfileToRow(profile);
      db.insert(weaknessProfiles)
        .values(row)
        .onConflictDoUpdate({
          target: weaknessProfiles.identifier,
          set: {
            focusSoundsJson: row.focusSoundsJson,
            lastUpdatedAt: row.lastUpdatedAt,
            updatedAt: row.updatedAt,
          },
        })
        .run();
      return undefined;
    });
  },
});
