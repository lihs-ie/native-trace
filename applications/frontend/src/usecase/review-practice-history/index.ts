import { type ResultAsync, errAsync, okAsync } from "neverthrow";
import { z } from "zod";
import { type DomainError, validationFailed } from "../../domain/shared";
import { createSectionSeriesIdentifier } from "../../domain/section-series";
import { createMaterialIdentifier } from "../../domain/material";
import { type SectionSeriesRepository } from "../port/section-series-repository";
import { type SectionRepository } from "../port/section-repository";
import { type RecordingAttemptRepository } from "../port/recording-attempt-repository";
import { type AnalysisRunRepository } from "../port/analysis-run-repository";
import { type AssessmentResultRepository } from "../port/assessment-result-repository";
import { toDomainPagination } from "../shared/pagination";

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

const buildRunsSequentially = (
  dependencies: ReviewPracticeHistoryDependencies,
  runs: ReadonlyArray<import("../../domain/analysis-run").AnalysisRun>,
  index: number,
  accumulated: AnalysisRunHistoryOutput[],
): ResultAsync<AnalysisRunHistoryOutput[], DomainError> => {
  if (index >= runs.length) return okAsync(accumulated);
  const run = runs[index];
  return buildRunHistory(dependencies, run.identifier, run.mode, run.status, run.createdAt).andThen(
    (runHistory) =>
      buildRunsSequentially(dependencies, runs, index + 1, [...accumulated, runHistory]),
  );
};

const buildAttemptsSequentially = (
  dependencies: ReviewPracticeHistoryDependencies,
  attempts: ReadonlyArray<import("../../domain/recording-attempt").RecordingAttempt>,
  index: number,
  accumulated: RecordingAttemptHistoryOutput[],
): ResultAsync<RecordingAttemptHistoryOutput[], DomainError> => {
  if (index >= attempts.length) return okAsync(accumulated);
  const attempt = attempts[index];

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
      pagination: { type: "offset", offset: 0 as never, limit: 20 as never },
      sort: "createdAt_desc",
    })
    .andThen((runPage) =>
      buildRunsSequentially(dependencies, runPage.items, 0, []).andThen((runs) =>
        buildAttemptsSequentially(dependencies, attempts, index + 1, [
          ...accumulated,
          {
            identifier: attempt.identifier as string,
            state: attempt.type,
            createdAt: attemptCreatedAt,
            analysisRuns: runs,
          },
        ]),
      ),
    );
};

const buildSectionVersionsSequentially = (
  dependencies: ReviewPracticeHistoryDependencies,
  sections: ReadonlyArray<import("../../domain/section").Section>,
  index: number,
  accumulated: SectionVersionHistoryOutput[],
): ResultAsync<SectionVersionHistoryOutput[], DomainError> => {
  if (index >= sections.length) return okAsync(accumulated);
  const section = sections[index];
  if (section.type !== "active") {
    return buildSectionVersionsSequentially(dependencies, sections, index + 1, accumulated);
  }

  return dependencies.recordingAttemptRepository
    .search({
      type: "attemptsInSection",
      section: section.identifier,
      pagination: { type: "offset", offset: 0 as never, limit: 50 as never },
      sort: "createdAt_desc",
    })
    .andThen((attemptPage) =>
      buildAttemptsSequentially(dependencies, attemptPage.items, 0, []).andThen((attempts) =>
        buildSectionVersionsSequentially(dependencies, sections, index + 1, [
          ...accumulated,
          {
            sectionIdentifier: section.identifier as string,
            version: section.version as number,
            bodyText: section.bodyText as string,
            createdAt: section.createdAt.toISOString(),
            recordingAttempts: attempts,
          },
        ]),
      ),
    );
};

// ---- Implementation ----

export const createReviewPracticeHistory =
  (dependencies: ReviewPracticeHistoryDependencies) =>
  (input: ReviewPracticeHistoryInput): ResultAsync<ReviewPracticeHistoryOutput, DomainError> => {
    const parsed = reviewPracticeHistorySchema.safeParse(input);
    if (!parsed.success) {
      return errAsync(
        validationFailed("input", parsed.error.errors.map((e) => e.message).join(", ")),
      );
    }

    const sectionSeriesIdentifier = createSectionSeriesIdentifier(parsed.data.sectionSeries);
    if (!sectionSeriesIdentifier) {
      return errAsync(validationFailed("sectionSeries", "不正な SectionSeries ID です"));
    }

    if (parsed.data.material !== undefined) {
      const materialIdentifier = createMaterialIdentifier(parsed.data.material);
      if (!materialIdentifier) {
        return errAsync(validationFailed("material", "不正な Material ID です"));
      }
    }

    const pagination = toDomainPagination(parsed.data.pagination);

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
            buildSectionVersionsSequentially(dependencies, sectionPage.items, 0, []).map(
              (sectionVersions) => ({
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
              }),
            ),
          ),
      );
  };
