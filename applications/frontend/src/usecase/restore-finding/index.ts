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
import { type Clock } from "../port/clock";
import { parseInput } from "../shared/validation";
import { resolveAssessmentResultForFinding } from "../shared/finding-resolution";

// ---- Input ----

const restoreFindingSchema = z.object({
  section: z.string().min(1, "セクションIDは空にできません"),
  finding: z.string().min(1, "finding IDは空にできません"),
});

export type RestoreFindingInput = z.infer<typeof restoreFindingSchema>;

// ---- Output ----

export type RestoreFindingOutput = Readonly<{
  assessmentResult: string;
  findingIdentifier: string;
  undoneAt: number;
}>;

// ---- Dependencies ----

export type RestoreFindingDependencies = Readonly<{
  sectionRepository: SectionRepository;
  recordingAttemptRepository: RecordingAttemptRepository;
  analysisRunRepository: AnalysisRunRepository;
  analysisJobRepository: AnalysisJobRepository;
  assessmentResultRepository: AssessmentResultRepository;
  findingDismissalRepository: FindingDismissalRepository;
  clock: Clock;
}>;

// ---- Implementation ----

/**
 * finding の却下を取り消す（undone_at を現在時刻で埋める）。
 * 却下レコードが存在しない場合も成功として扱う（冪等）。
 */
export const createRestoreFinding =
  (dependencies: RestoreFindingDependencies) =>
  (input: RestoreFindingInput): ResultAsync<RestoreFindingOutput, DomainError> => {
    const parsedInput = parseInput(restoreFindingSchema, input);
    if (parsedInput.isErr()) {
      return errAsync(parsedInput.error);
    }
    const parsed = parsedInput.value;

    const sectionIdentifier = createSectionIdentifier(parsed.section);
    if (!sectionIdentifier) {
      return errAsync(validationFailed("section", "不正なセクションIDです"));
    }

    const findingIdentifier = parsed.finding;

    return resolveAssessmentResultForFinding(
      dependencies,
      sectionIdentifier,
      findingIdentifier,
    ).andThen((assessmentResultIdentifier) => {
      const now = dependencies.clock.now();
      const undoneAtMs = now.getTime();

      return dependencies.findingDismissalRepository
        .restore(assessmentResultIdentifier, findingIdentifier, undoneAtMs)
        .andThen(() =>
          okAsync({
            assessmentResult: String(assessmentResultIdentifier),
            findingIdentifier,
            undoneAt: undoneAtMs,
          } satisfies RestoreFindingOutput),
        );
    });
  };
