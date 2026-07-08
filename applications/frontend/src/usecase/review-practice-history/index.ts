import { type ResultAsync, errAsync } from "neverthrow";
import { z } from "zod";
import { type DomainError, validationFailed } from "../../domain/shared";
import { createSectionSeriesIdentifier } from "../../domain/section-series";
import { createMaterialIdentifier } from "../../domain/material";
import { type SectionSeriesRepository } from "../port/section-series-repository";
import { type SectionRepository } from "../port/section-repository";
import { type RecordingAttemptRepository } from "../port/recording-attempt-repository";
import { type AnalysisRunRepository } from "../port/analysis-run-repository";
import { type AssessmentResultRepository } from "../port/assessment-result-repository";
import { toDomainPagination, firstPage } from "../shared/pagination";
import { parseInput } from "../shared/validation";
import { traverseSequentially } from "../shared/traverse";

// ---- Input ----

const reviewPracticeHistorySchema = z.object({
  sectionSeries: z.string().min(1, "SectionSeriesIDは空にできません"),
  material: z.string().optional(),
  pagination: z
    .object({
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    })
    .optional(),
});

export type ReviewPracticeHistoryInput = z.infer<typeof reviewPracticeHistorySchema>;

// ---- Output ----

export type PerAxisScoresOutput = Readonly<{
  accuracy: number;
  nativeLikeness: number;
  connectedSpeech: number;
  prosody: number;
}>;

export type AssessmentResultSummaryOutput = Readonly<{
  identifier: string;
  overallScore: number;
  findingsCount: number;
  engineKind: string;
  perAxisScores: PerAxisScoresOutput;
  createdAt: string;
}>;

export type AnalysisRunHistoryOutput = Readonly<{
  identifier: string;
  mode: string;
  status: string;
  createdAt: string;
  assessmentResults: ReadonlyArray<AssessmentResultSummaryOutput>;
}>;

export type RecordingAttemptHistoryOutput = Readonly<{
  identifier: string;
  state: string;
  createdAt: string;
  analysisRuns: ReadonlyArray<AnalysisRunHistoryOutput>;
}>;

export type SectionVersionHistoryOutput = Readonly<{
  sectionIdentifier: string;
  version: number;
  bodyText: string;
  createdAt: string;
  recordingAttempts: ReadonlyArray<RecordingAttemptHistoryOutput>;
}>;

export type SectionSeriesHistoryOutput = Readonly<{
  sectionSeriesIdentifier: string;
  title: string;
  sectionVersions: ReadonlyArray<SectionVersionHistoryOutput>;
}>;

export type ReviewPracticeHistoryOutput = Readonly<{
  sectionSeriesGroups: ReadonlyArray<SectionSeriesHistoryOutput>;
  page: Readonly<{
    offset: number;
    limit: number;
    total: number;
  }>;
}>;

// ---- Dependencies ----

export type ReviewPracticeHistoryDependencies = Readonly<{
  sectionSeriesRepository: SectionSeriesRepository;
  sectionRepository: SectionRepository;
  recordingAttemptRepository: RecordingAttemptRepository;
  analysisRunRepository: AnalysisRunRepository;
  assessmentResultRepository: AssessmentResultRepository;
}>;

// ---- Helpers ----

const buildRunHistory = (
  dependencies: ReviewPracticeHistoryDependencies,
  runIdentifier: import("../../domain/analysis-run").AnalysisRunIdentifier,
  runMode: string,
  runStatus: string,
  runCreatedAt: Date,
): ResultAsync<AnalysisRunHistoryOutput, DomainError> =>
  dependencies.assessmentResultRepository
    .search({ type: "resultsByAnalysisRun", analysisRun: runIdentifier })
    .map((resultPage) => ({
      identifier: runIdentifier as string,
      mode: runMode,
      status: runStatus,
      createdAt: runCreatedAt.toISOString(),
      assessmentResults: resultPage.items.map((result) => ({
        identifier: result.identifier as string,
        overallScore: result.scores.overall as number,
        findingsCount: result.findings.length,
        engineKind: result.engineSnapshot.type,
        perAxisScores: {
          accuracy: result.scores.accuracy as number,
          nativeLikeness: result.scores.nativeLikeness as number,
          connectedSpeech: result.scores.connectedSpeech as number,
          prosody: result.scores.prosody as number,
        },
        createdAt: result.createdAt.toISOString(),
      })),
    }));

const buildAttemptHistory = (
  dependencies: ReviewPracticeHistoryDependencies,
  attempt: import("../../domain/recording-attempt").RecordingAttempt,
): ResultAsync<RecordingAttemptHistoryOutput, DomainError> => {
  const attemptCreatedAt =
    attempt.type === "failed"
      ? attempt.failedAt.toISOString()
      : attempt.type === "deleted"
        ? attempt.deletedAt.toISOString()
        : attempt.createdAt.toISOString();

  return dependencies.analysisRunRepository
    .search({
      type: "runsByRecordingAttempt",
      recordingAttempt: attempt.identifier,
      pagination: firstPage(20),
      sort: "createdAt_desc",
    })
    .andThen((runPage) =>
      traverseSequentially(runPage.items, (run) =>
        buildRunHistory(dependencies, run.identifier, run.mode, run.status, run.createdAt),
      ).map((analysisRuns) => ({
        identifier: attempt.identifier as string,
        state: attempt.type,
        createdAt: attemptCreatedAt,
        analysisRuns,
      })),
    );
};

const buildSectionVersionHistory = (
  dependencies: ReviewPracticeHistoryDependencies,
  section: import("../../domain/section").Section,
): ResultAsync<SectionVersionHistoryOutput, DomainError> =>
  dependencies.recordingAttemptRepository
    .search({
      type: "attemptsInSection",
      section: section.identifier,
      pagination: firstPage(50),
      sort: "createdAt_desc",
    })
    .andThen((attemptPage) =>
      traverseSequentially(attemptPage.items, (attempt) =>
        buildAttemptHistory(dependencies, attempt),
      ).map((recordingAttempts) => ({
        sectionIdentifier: section.identifier as string,
        version: section.version as number,
        bodyText: section.bodyText as string,
        createdAt: section.createdAt.toISOString(),
        recordingAttempts,
      })),
    );

// ---- Implementation ----

export const createReviewPracticeHistory =
  (dependencies: ReviewPracticeHistoryDependencies) =>
  (input: ReviewPracticeHistoryInput): ResultAsync<ReviewPracticeHistoryOutput, DomainError> => {
    const parsedInput = parseInput(reviewPracticeHistorySchema, input);
    if (parsedInput.isErr()) {
      return errAsync(parsedInput.error);
    }
    const parsed = parsedInput.value;

    const sectionSeriesIdentifier = createSectionSeriesIdentifier(parsed.sectionSeries);
    if (!sectionSeriesIdentifier) {
      return errAsync(validationFailed("sectionSeries", "不正な SectionSeries ID です"));
    }

    if (parsed.material !== undefined) {
      const materialIdentifier = createMaterialIdentifier(parsed.material);
      if (!materialIdentifier) {
        return errAsync(validationFailed("material", "不正な Material ID です"));
      }
    }

    const pagination = toDomainPagination(parsed.pagination);

    return dependencies.sectionSeriesRepository
      .find(sectionSeriesIdentifier)
      .andThen((sectionSeries) =>
        dependencies.sectionRepository
          .search({
            type: "practiceHistorySectionsInSeries",
            sectionSeries: sectionSeriesIdentifier,
            pagination,
            sort: "createdAt_desc",
          })
          .andThen((sectionPage) =>
            traverseSequentially(
              sectionPage.items.filter((section) => section.type === "active"),
              (section) => buildSectionVersionHistory(dependencies, section),
            ).map((sectionVersions) => ({
              sectionSeriesGroups: [
                {
                  sectionSeriesIdentifier: sectionSeries.identifier as string,
                  title: sectionSeries.title as string,
                  sectionVersions,
                },
              ],
              page: {
                offset: pagination.offset as number,
                limit: pagination.limit as number,
                total: sectionPage.total,
              },
            })),
          ),
      );
  };
