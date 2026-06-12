import { eq, and, isNull, inArray } from "drizzle-orm";
import { type DrizzleDatabase } from "../client";
import { findingDismissals } from "../schema";
import {
  type FindingDismissalRepository,
  type RecordDismissalInput,
} from "../../../usecase/port/finding-dismissal-repository";
import { type AssessmentResultIdentifier } from "../../../domain/assessment-result";
import { type DomainError } from "../../../domain/shared";
import { okAsync, errAsync } from "neverthrow";

export const createDrizzleFindingDismissalRepository = (
  db: DrizzleDatabase,
): FindingDismissalRepository => ({
  record: (input: RecordDismissalInput) => {
    return okAsync(null).andThen(() => {
      try {
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
        return okAsync(undefined);
      } catch (e) {
        return errAsync({ type: "persistenceFailed", reason: String(e) } as DomainError);
      }
    });
  },

  restore: (
    assessmentResult: AssessmentResultIdentifier,
    findingIdentifier: string,
    undoneAt: number,
  ) => {
    return okAsync(null).andThen(() => {
      try {
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
        return okAsync(undefined);
      } catch (e) {
        return errAsync({ type: "persistenceFailed", reason: String(e) } as DomainError);
      }
    });
  },

  findActiveDismissedIdentifiers: (assessmentResult: AssessmentResultIdentifier) => {
    return okAsync(null).andThen(() => {
      try {
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
        return okAsync(identifierSet as ReadonlySet<string>);
      } catch (e) {
        return errAsync({ type: "persistenceFailed", reason: String(e) } as DomainError);
      }
    });
  },

  findActiveDismissedIdentifiersByResults: (
    assessmentResults: ReadonlyArray<AssessmentResultIdentifier>,
  ) => {
    return okAsync(null).andThen(() => {
      try {
        if (assessmentResults.length === 0) {
          return okAsync(new Map() as ReadonlyMap<string, ReadonlySet<string>>);
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
        return okAsync(resultMap as ReadonlyMap<string, ReadonlySet<string>>);
      } catch (e) {
        return errAsync({ type: "persistenceFailed", reason: String(e) } as DomainError);
      }
    });
  },
});
