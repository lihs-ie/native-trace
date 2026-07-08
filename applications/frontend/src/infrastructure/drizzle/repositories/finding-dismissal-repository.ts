import { eq, and, isNull, inArray } from "drizzle-orm";
import { type DrizzleDatabase } from "../client";
import { findingDismissals } from "../schema";
import {
  type FindingDismissalRepository,
  type RecordDismissalInput,
} from "../../../usecase/port/finding-dismissal-repository";
import { type AssessmentResultIdentifier } from "../../../domain/assessment-result";
import { tryPersistence } from "./try-persistence";

export const createDrizzleFindingDismissalRepository = (
  db: DrizzleDatabase,
): FindingDismissalRepository => ({
  record: (input: RecordDismissalInput) => {
    return tryPersistence(() => {
      db.insert(findingDismissals)
        .values({
          identifier: input.identifier,
          assessmentResult: String(input.assessmentResult),
          findingIdentifier: input.findingIdentifier,
          dismissedAt: input.dismissedAt,
          reason: input.reason ?? null,
          undoneAt: null,
        })
        .run();
      return undefined;
    });
  },

  restore: (
    assessmentResult: AssessmentResultIdentifier,
    findingIdentifier: string,
    undoneAt: number,
  ) => {
    return tryPersistence(() => {
      db.update(findingDismissals)
        .set({ undoneAt })
        .where(
          and(
            eq(findingDismissals.assessmentResult, String(assessmentResult)),
            eq(findingDismissals.findingIdentifier, findingIdentifier),
            isNull(findingDismissals.undoneAt),
          ),
        )
        .run();
      return undefined;
    });
  },

  findActiveDismissedIdentifiers: (assessmentResult: AssessmentResultIdentifier) => {
    return tryPersistence(() => {
      const rows = db
        .select({ findingIdentifier: findingDismissals.findingIdentifier })
        .from(findingDismissals)
        .where(
          and(
            eq(findingDismissals.assessmentResult, String(assessmentResult)),
            isNull(findingDismissals.undoneAt),
          ),
        )
        .all();
      const identifierSet: Set<string> = new Set(rows.map((r) => r.findingIdentifier));
      return identifierSet as ReadonlySet<string>;
    });
  },

  findActiveDismissedIdentifiersByResults: (
    assessmentResults: ReadonlyArray<AssessmentResultIdentifier>,
  ) => {
    return tryPersistence(() => {
      if (assessmentResults.length === 0) {
        return new Map() as ReadonlyMap<string, ReadonlySet<string>>;
      }
      const assessmentResultStrings = assessmentResults.map(String);
      const rows = db
        .select({
          assessmentResult: findingDismissals.assessmentResult,
          findingIdentifier: findingDismissals.findingIdentifier,
        })
        .from(findingDismissals)
        .where(
          and(
            inArray(findingDismissals.assessmentResult, assessmentResultStrings),
            isNull(findingDismissals.undoneAt),
          ),
        )
        .all();

      const resultMap = new Map<string, Set<string>>();
      for (const row of rows) {
        const existing = resultMap.get(row.assessmentResult);
        if (existing) {
          existing.add(row.findingIdentifier);
        } else {
          resultMap.set(row.assessmentResult, new Set([row.findingIdentifier]));
        }
      }
      return resultMap as ReadonlyMap<string, ReadonlySet<string>>;
    });
  },
});
