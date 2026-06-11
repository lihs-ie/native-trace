import { type ResultAsync, okAsync, errAsync } from "neverthrow";
import { z } from "zod";
import { type DomainError, validationFailed, createNonEmptyList } from "../../domain/shared";
import { createSectionIdentifier } from "../../domain/section";
import { deriveAnalysisRunStatus } from "../../domain/analysis-run";
import { type SectionRepository } from "../port/section-repository";
import { type RecordingAttemptRepository } from "../port/recording-attempt-repository";
import { type AnalysisRunRepository } from "../port/analysis-run-repository";
import { type AnalysisJobRepository } from "../port/analysis-job-repository";
import { type AssessmentResultRepository } from "../port/assessment-result-repository";
import { type AudioFileRepository } from "../port/audio-file-repository";
import { tokenizeSectionBody, type SectionToken } from "../shared/tokenizer";

// ---- Input ----

const viewPracticeWorkspaceSchema = z.object({
  section: z.string().min(1, "セクションIDは空にできません"),
});

export type ViewPracticeWorkspaceInput = z.infer<typeof viewPracticeWorkspaceSchema>;

// ---- Output ----

export type SectionTokenOutput = Readonly<{
  tokenIndex: number;
  text: string;
  startChar: number;
  endChar: number;
}>;

export type SectionWorkspaceSectionOutput = Readonly<{
  identifier: string;
  sectionSeries: string;
  version: number;
  bodyText: string;
  createdAt: string;
}>;

export type RecordingAttemptSummaryOutput = Readonly<{
  identifier: string;
  state: "saving" | "ready" | "failed" | "deleted";
  createdAt: string;
}>;

export type AnalysisRunWorkspaceOutput = Readonly<{
  identifier: string;
  mode: string;
  status: string;
  createdAt: string;
}>;

export type HighlightRangeOutput = Readonly<{
  finding: string;
  severity: "critical" | "major" | "minor" | "suggestion";
  category: "accuracy" | "pronunciation" | "connectedSpeech" | "prosody" | "nativeLikeness";
  textRange: Readonly<{ startChar: number; endChar: number }>;
  tokenRange: Readonly<{ startTokenIndex: number; endTokenIndex: number }>;
  audioRange: Readonly<{ startMilliseconds: number; endMilliseconds: number }> | null;
  scoreImpact: number;
  confidence: number;
}>;

export type EngineHighlightRangesOutput = Readonly<{
  analysisEngine: string;
  engineKind: "cloud" | "oss_worker";
  result: string;
  highlights: ReadonlyArray<HighlightRangeOutput>;
}>;

// rail のゲージ・スコア・詳細パネルが必要とするエンジン別の解析結果（スコア + finding 詳細）。
export type EngineFindingOutput = Readonly<{
  finding: string;
  severity: "critical" | "major" | "minor" | "suggestion";
  category: "accuracy" | "pronunciation" | "connectedSpeech" | "prosody" | "nativeLikeness";
  textRange: Readonly<{ startChar: number; endChar: number }>;
  audioRange: Readonly<{ startMilliseconds: number; endMilliseconds: number }> | null;
  expected: Readonly<{ text: string | null; ipa: string | null }>;
  detected: Readonly<{ text: string | null; ipa: string | null }>;
  messageJa: string;
  messageEn: string | null;
  scoreImpact: number;
  confidence: number;
}>;

export type EngineResultOutput = Readonly<{
  result: string;
  engineKind: "cloud" | "oss_worker";
  engineName: string;
  modelName: string | null;
  scores: Readonly<{
    overall: number;
    accuracy: number;
    nativeLikeness: number;
    pronunciation: number;
    connectedSpeech: number;
    prosody: number;
  }>;
  counts: Readonly<{ critical: number; major: number; minor: number; suggestion: number }>;
  findings: ReadonlyArray<EngineFindingOutput>;
}>;

export type ViewPracticeWorkspaceOutput = Readonly<{
  section: SectionWorkspaceSectionOutput;
  sectionTokens: ReadonlyArray<SectionTokenOutput>;
  recordingAttempts: ReadonlyArray<RecordingAttemptSummaryOutput>;
  latestAnalysisRun: AnalysisRunWorkspaceOutput | null;
  highlightRangesByEngine: ReadonlyArray<EngineHighlightRangesOutput>;
  resultsByEngine: ReadonlyArray<EngineResultOutput>;
}>;

// ---- Dependencies ----

export type ViewPracticeWorkspaceDependencies = Readonly<{
  sectionRepository: SectionRepository;
  recordingAttemptRepository: RecordingAttemptRepository;
  analysisRunRepository: AnalysisRunRepository;
  analysisJobRepository: AnalysisJobRepository;
  assessmentResultRepository: AssessmentResultRepository;
  audioFileRepository: AudioFileRepository;
}>;

// ---- Helpers ----

const resolveTokenRange = (
  tokens: ReadonlyArray<SectionToken>,
  startOffset: number,
  endOffset: number,
): Readonly<{ startTokenIndex: number; endTokenIndex: number }> => {
  let startTokenIndex = 0;
  let endTokenIndex = 0;

  for (const token of tokens) {
    if (token.startChar <= startOffset) {
      startTokenIndex = token.tokenIndex;
    }
    if (token.endChar <= endOffset) {
      endTokenIndex = token.tokenIndex;
    }
  }

  return { startTokenIndex, endTokenIndex };
};

// ---- Implementation ----

export const createViewPracticeWorkspace =
  (dependencies: ViewPracticeWorkspaceDependencies) =>
  (input: ViewPracticeWorkspaceInput): ResultAsync<ViewPracticeWorkspaceOutput, DomainError> => {
    const parsed = viewPracticeWorkspaceSchema.safeParse(input);
    if (!parsed.success) {
      return errAsync(
        validationFailed("input", parsed.error.errors.map((e) => e.message).join(", ")),
      );
    }

    const sectionIdentifier = createSectionIdentifier(parsed.data.section);
    if (!sectionIdentifier) {
      return errAsync(validationFailed("section", "不正なセクションIDです"));
    }

    return dependencies.sectionRepository.find(sectionIdentifier).andThen((section) => {
      const sectionTokens = tokenizeSectionBody(section.bodyText as string);

      const sectionOutput: SectionWorkspaceSectionOutput = {
        identifier: section.identifier as string,
        sectionSeries: section.sectionSeries as string,
        version: section.version as number,
        bodyText: section.bodyText as string,
        createdAt: section.createdAt.toISOString(),
      };

      const tokenOutputs: ReadonlyArray<SectionTokenOutput> = sectionTokens.map((t) => ({
        tokenIndex: t.tokenIndex,
        text: t.text,
        startChar: t.startChar,
        endChar: t.endChar,
      }));

      // 録音試行一覧を取得
      const recordingAttemptResult = dependencies.recordingAttemptRepository.search({
        type: "attemptsInSection",
        section: section.identifier,
        pagination: { type: "offset", offset: 0 as never, limit: 50 as never },
        sort: "createdAt_desc",
      });

      // 最新 AnalysisRun を取得（最新の録音試行から）
      return recordingAttemptResult.andThen((recordingPage) => {
        const recordingAttemptOutputs: ReadonlyArray<RecordingAttemptSummaryOutput> =
          recordingPage.items.map((attempt) => ({
            identifier: attempt.identifier as string,
            state:
              attempt.type === "saving"
                ? "saving"
                : attempt.type === "ready"
                  ? "ready"
                  : attempt.type === "failed"
                    ? "failed"
                    : "deleted",
            createdAt:
              attempt.type === "failed"
                ? attempt.failedAt.toISOString()
                : attempt.type === "deleted"
                  ? attempt.deletedAt.toISOString()
                  : attempt.createdAt.toISOString(),
          }));

        // 最新の Ready 録音試行の AnalysisRun を取得
        const latestReady = recordingPage.items.find((a) => a.type === "ready");
        if (!latestReady) {
          return okAsync({
            section: sectionOutput,
            sectionTokens: tokenOutputs,
            recordingAttempts: recordingAttemptOutputs,
            latestAnalysisRun: null,
            highlightRangesByEngine: [],
            resultsByEngine: [],
          } satisfies ViewPracticeWorkspaceOutput);
        }

        return dependencies.analysisRunRepository
          .search({
            type: "runsByRecordingAttempt",
            recordingAttempt: latestReady.identifier,
            pagination: { type: "offset", offset: 0 as never, limit: 10 as never },
            sort: "createdAt_desc",
          })
          .andThen((runPage) => {
            const latestRun = runPage.items[0] ?? null;

            if (!latestRun) {
              return okAsync({
                section: sectionOutput,
                sectionTokens: tokenOutputs,
                recordingAttempts: recordingAttemptOutputs,
                latestAnalysisRun: null,
                highlightRangesByEngine: [],
                resultsByEngine: [],
              } satisfies ViewPracticeWorkspaceOutput);
            }

            // 最新 AnalysisRun の jobs を取得
            return dependencies.analysisJobRepository
              .search({
                type: "jobsByAnalysisRun",
                analysisRun: latestRun.identifier,
              })
              .andThen((jobPage) => {
                // 実 status は jobs から派生する（mode と混同しない）。
                const jobsNonEmpty = createNonEmptyList(jobPage.items);
                const latestAnalysisRunOutput: AnalysisRunWorkspaceOutput = {
                  identifier: latestRun.identifier as string,
                  mode: latestRun.mode,
                  status: jobsNonEmpty ? deriveAnalysisRunStatus(jobsNonEmpty) : "queued",
                  createdAt: latestRun.createdAt.toISOString(),
                };
                if (jobPage.items.length === 0) {
                  return okAsync({
                    section: sectionOutput,
                    sectionTokens: tokenOutputs,
                    recordingAttempts: recordingAttemptOutputs,
                    latestAnalysisRun: latestAnalysisRunOutput,
                    highlightRangesByEngine: [],
                    resultsByEngine: [],
                  } satisfies ViewPracticeWorkspaceOutput);
                }

                const succeededJobs = jobPage.items.filter((j) => j.type === "succeeded");
                if (succeededJobs.length === 0) {
                  return okAsync({
                    section: sectionOutput,
                    sectionTokens: tokenOutputs,
                    recordingAttempts: recordingAttemptOutputs,
                    latestAnalysisRun: latestAnalysisRunOutput,
                    highlightRangesByEngine: [],
                    resultsByEngine: [],
                  } satisfies ViewPracticeWorkspaceOutput);
                }

                const jobIdentifiers = succeededJobs.map((j) => j.identifier);

                return dependencies.assessmentResultRepository
                  .search({
                    type: "resultsByJobs",
                    jobs: jobIdentifiers,
                  })
                  .map((resultPage) => {
                    // エンジン別にグループ化（比較モードでも統合しない）
                    const highlightRangesByEngine: EngineHighlightRangesOutput[] = [];
                    const resultsByEngine: EngineResultOutput[] = [];

                    for (const result of resultPage.items) {
                      const highlights: HighlightRangeOutput[] = result.findings.map((finding) => {
                        const tokenRange = resolveTokenRange(
                          sectionTokens,
                          finding.textRange.startOffset,
                          finding.textRange.endOffset,
                        );

                        return {
                          finding: finding.identifier as string,
                          severity: finding.severity,
                          category: finding.category,
                          textRange: {
                            startChar: finding.textRange.startOffset,
                            endChar: finding.textRange.endOffset,
                          },
                          tokenRange,
                          audioRange: finding.audioRange
                            ? {
                                startMilliseconds: finding.audioRange.startMilliseconds,
                                endMilliseconds: finding.audioRange.endMilliseconds,
                              }
                            : null,
                          scoreImpact: finding.scoreImpact,
                          confidence: finding.confidence as number,
                        };
                      });

                      highlightRangesByEngine.push({
                        analysisEngine: result.engineSnapshot.identifier,
                        engineKind: result.engineSnapshot.type,
                        result: result.identifier as string,
                        highlights,
                      });

                      const counts = { critical: 0, major: 0, minor: 0, suggestion: 0 };
                      for (const finding of result.findings) {
                        counts[finding.severity] += 1;
                      }

                      resultsByEngine.push({
                        result: result.identifier as string,
                        engineKind: result.engineSnapshot.type,
                        engineName: result.engineSnapshot.displayName,
                        modelName: result.engineSnapshot.modelName,
                        scores: {
                          overall: result.scores.overall as number,
                          accuracy: result.scores.accuracy as number,
                          nativeLikeness: result.scores.nativeLikeness as number,
                          pronunciation: result.scores.pronunciation as number,
                          connectedSpeech: result.scores.connectedSpeech as number,
                          prosody: result.scores.prosody as number,
                        },
                        counts,
                        findings: result.findings.map((finding) => ({
                          finding: finding.identifier as string,
                          severity: finding.severity,
                          category: finding.category,
                          textRange: {
                            startChar: finding.textRange.startOffset,
                            endChar: finding.textRange.endOffset,
                          },
                          audioRange: finding.audioRange
                            ? {
                                startMilliseconds: finding.audioRange.startMilliseconds,
                                endMilliseconds: finding.audioRange.endMilliseconds,
                              }
                            : null,
                          expected: { text: finding.expected.text, ipa: finding.expected.ipa },
                          detected: { text: finding.detected.text, ipa: finding.detected.ipa },
                          messageJa: finding.messageJa,
                          messageEn: finding.messageEn,
                          scoreImpact: finding.scoreImpact,
                          confidence: finding.confidence as number,
                        })),
                      });
                    }

                    return {
                      section: sectionOutput,
                      sectionTokens: tokenOutputs,
                      recordingAttempts: recordingAttemptOutputs,
                      latestAnalysisRun: latestAnalysisRunOutput,
                      highlightRangesByEngine,
                      resultsByEngine,
                    } satisfies ViewPracticeWorkspaceOutput;
                  });
              });
          });
      });
    });
  };
