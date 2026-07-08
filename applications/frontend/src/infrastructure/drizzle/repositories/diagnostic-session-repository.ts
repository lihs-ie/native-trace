import { eq, and, isNull, desc } from "drizzle-orm";
import { type DrizzleDatabase } from "../client";
import { diagnosticSessions } from "../schema";
import { type DiagnosticSessionRepository } from "../../../usecase/port/diagnostic-session-repository";
import {
  type DiagnosticSession,
  type PendingDiagnosticSession,
  type CompletedDiagnosticSession,
  type DiagnosticSessionIdentifier,
  type LearnerIdentifier,
  type WeaknessProfileIdentifier,
  type DiagnosticPromptSet,
  createDiagnosticSessionIdentifier,
  createLearnerIdentifier,
  createWeaknessProfileIdentifier,
} from "../../../domain/training";
import { type AssessmentResultIdentifier } from "../../../domain/assessment-result";
import { createNonEmptyList, notFound } from "../../../domain/shared";
import { okAsync, errAsync } from "neverthrow";
import { tryPersistence, tryPersistenceResult } from "./try-persistence";

type DiagnosticSessionRow = typeof diagnosticSessions.$inferSelect;

const rowToDiagnosticSession = (row: DiagnosticSessionRow): DiagnosticSession => {
  const identifier = createDiagnosticSessionIdentifier(row.identifier);
  if (!identifier) throw new Error(`Invalid DiagnosticSessionIdentifier: ${row.identifier}`);

  const learner = createLearnerIdentifier(row.learner);
  if (!learner) throw new Error(`Invalid LearnerIdentifier: ${row.learner}`);

  const promptSet = JSON.parse(row.promptSetJson) as DiagnosticPromptSet;

  if (row.status === "completed") {
    const weaknessProfileIdentifier = createWeaknessProfileIdentifier(row.weaknessProfile ?? "");
    if (!weaknessProfileIdentifier) {
      throw new Error(`Invalid WeaknessProfileIdentifier for completed session: ${row.identifier}`);
    }

    const assessmentResultIdentifiers: AssessmentResultIdentifier[] = row.assessmentResultJson
      ? (JSON.parse(row.assessmentResultJson) as string[]).map(
          (id) => id as AssessmentResultIdentifier,
        )
      : [];

    const assessmentResults = createNonEmptyList(assessmentResultIdentifiers);
    if (!assessmentResults) {
      throw new Error(
        `Completed diagnostic session must have non-empty assessmentResults: ${row.identifier}`,
      );
    }

    const completed: CompletedDiagnosticSession = {
      type: "completed",
      identifier,
      learner,
      promptSet,
      assessmentResults,
      weaknessProfile: weaknessProfileIdentifier as WeaknessProfileIdentifier,
      startedAt: new Date(row.startedAt),
      completedAt: new Date(row.completedAt!),
    };
    return completed;
  }

  const pending: PendingDiagnosticSession = {
    type: "pending",
    identifier,
    learner,
    promptSet,
    startedAt: new Date(row.startedAt),
  };
  return pending;
};

const diagnosticSessionToRow = (session: DiagnosticSession): DiagnosticSessionRow => {
  const now = new Date().toISOString();

  if (session.type === "completed") {
    return {
      identifier: String(session.identifier),
      learner: String(session.learner),
      promptSetJson: JSON.stringify(session.promptSet),
      status: "completed",
      weaknessProfile: String(session.weaknessProfile),
      assessmentResultJson: JSON.stringify(session.assessmentResults.map((id) => String(id))),
      startedAt: session.startedAt.toISOString(),
      completedAt: session.completedAt.toISOString(),
      createdAt: session.startedAt.toISOString(),
      updatedAt: now,
      deletedAt: null,
    };
  }

  return {
    identifier: String(session.identifier),
    learner: String(session.learner),
    promptSetJson: JSON.stringify(session.promptSet),
    status: "pending",
    weaknessProfile: null,
    assessmentResultJson: null,
    startedAt: session.startedAt.toISOString(),
    completedAt: null,
    createdAt: session.startedAt.toISOString(),
    updatedAt: now,
    deletedAt: null,
  };
};

export const createDrizzleDiagnosticSessionRepository = (
  db: DrizzleDatabase,
): DiagnosticSessionRepository => ({
  find: (identifier: DiagnosticSessionIdentifier) => {
    return tryPersistenceResult(() => {
      const row = db
        .select()
        .from(diagnosticSessions)
        .where(
          and(
            eq(diagnosticSessions.identifier, String(identifier)),
            isNull(diagnosticSessions.deletedAt),
          ),
        )
        .get();

      if (!row) {
        return errAsync(notFound("DiagnosticSession", String(identifier)));
      }

      return okAsync(rowToDiagnosticSession(row));
    });
  },

  findLatestByLearner: (learner: LearnerIdentifier) => {
    return tryPersistence(() => {
      const row = db
        .select()
        .from(diagnosticSessions)
        .where(
          and(
            eq(diagnosticSessions.learner, String(learner)),
            isNull(diagnosticSessions.deletedAt),
          ),
        )
        .orderBy(desc(diagnosticSessions.createdAt))
        .limit(1)
        .get();

      if (!row) {
        return null;
      }

      return rowToDiagnosticSession(row);
    });
  },

  persist: (session: DiagnosticSession) => {
    return tryPersistence(() => {
      const row = diagnosticSessionToRow(session);
      db.insert(diagnosticSessions)
        .values(row)
        .onConflictDoUpdate({
          target: diagnosticSessions.identifier,
          set: {
            status: row.status,
            weaknessProfile: row.weaknessProfile,
            assessmentResultJson: row.assessmentResultJson,
            completedAt: row.completedAt,
            updatedAt: row.updatedAt,
          },
        })
        .run();
      return undefined;
    });
  },
});
