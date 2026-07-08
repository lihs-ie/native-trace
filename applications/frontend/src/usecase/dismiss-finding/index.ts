import { type ResultAsync, errAsync, okAsync } from "neverthrow";
import { z } from "zod";
import { type DomainError, validationFailed } from "../../domain/shared";
import { createSectionIdentifier } from "../../domain/section";
import { type SectionRepository } from "../port/section-repository";
import { type RecordingAttemptRepository } from "../port/recording-attempt-repository";
import { type AnalysisRunRepository } from "../port/analysis-run-repository";
import { type AnalysisJobRepository } from "../port/analysis-job-repository";
import { type AssessmentResultRepository } from "../port/assessment-result-repository";
import { type FindingDismissalRepository } from "../port/finding-dismissal-repository";
import { type EntropyProvider } from "../port/entropy-provider";
import { type Clock } from "../port/clock";
import { parseInput } from "../shared/validation";
import { resolveAssessmentResultForFinding } from "../shared/finding-resolution";

// ---- Input ----

const dismissFindingSchema = z.object({
  section: z.string().min(1, "セクションIDは空にできません"),
  finding: z.string().min(1, "finding IDは空にできません"),
  reason: z.string().nullable().optional(),
});

export type DismissFindingInput = z.infer<typeof dismissFindingSchema>;

// ---- Output ----

export type DismissFindingOutput = Readonly<{
  dismissalIdentifier: string;
  assessmentResult: string;
  findingIdentifier: string;
  dismissedAt: number;
}>;

// ---- Dependencies ----

export type DismissFindingDependencies = Readonly<{
  sectionRepository: SectionRepository;
  recordingAttemptRepository: RecordingAttemptRepository;
  analysisRunRepository: AnalysisRunRepository;
  analysisJobRepository: AnalysisJobRepository;
  assessmentResultRepository: AssessmentResultRepository;
  findingDismissalRepository: FindingDismissalRepository;
  entropyProvider: EntropyProvider;
  clock: Clock;
}>;

// ---- Implementation ----

/**
 * 指定セクションの最新解析結果内の finding を却下として記録する。
 * 既に却下済みの場合は成功として扱う（冪等）。
 */
export const createDismissFinding =
  (dependencies: DismissFindingDependencies) =>
  (input: DismissFindingInput): ResultAsync<DismissFindingOutput, DomainError> => {
    const parsedInput = parseInput(dismissFindingSchema, input);
    if (parsedInput.isErr()) {
      return errAsync(parsedInput.error);
    }
    const parsed = parsedInput.value;

    const sectionIdentifier = createSectionIdentifier(parsed.section);
    if (!sectionIdentifier) {
      return errAsync(validationFailed("section", "不正なセクションIDです"));
    }

    const findingIdentifier = parsed.finding;
    const reason = parsed.reason ?? null;

    return resolveAssessmentResultForFinding(
      dependencies,
      sectionIdentifier,
      findingIdentifier,
    ).andThen((assessmentResultIdentifier) => {
      // 既に active 却下があれば冪等に成功を返す
      return dependencies.findingDismissalRepository
        .findActiveDismissedIdentifiers(assessmentResultIdentifier)
        .andThen((activeDismissed) => {
          const now = dependencies.clock.now();
          const dismissedAtMs = now.getTime();

          if (activeDismissed.has(findingIdentifier)) {
            // 冪等: 既存の却下をそのまま返す
            return okAsync({
              dismissalIdentifier: "",
              assessmentResult: String(assessmentResultIdentifier),
              findingIdentifier,
              dismissedAt: dismissedAtMs,
            } satisfies DismissFindingOutput);
          }

          const dismissalIdentifier = dependencies.entropyProvider.generateUlid();

          return dependencies.findingDismissalRepository
            .record({
              identifier: dismissalIdentifier,
              assessmentResult: assessmentResultIdentifier,
              findingIdentifier,
              dismissedAt: dismissedAtMs,
              reason,
            })
            .map(() => ({
              dismissalIdentifier,
              assessmentResult: String(assessmentResultIdentifier),
              findingIdentifier,
              dismissedAt: dismissedAtMs,
            }));
        });
    });
  };
