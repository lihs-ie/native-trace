import { eq, inArray, isNull, and } from "drizzle-orm";
import { type DrizzleDatabase } from "../client";
import { assessmentResults } from "../schema";
import {
  type AssessmentResultRepository,
  type AssessmentResultPage,
} from "../../../usecase/port/assessment-result-repository";
import {
  type AssessmentResult,
  type AssessmentResultIdentifier,
  type AssessmentFinding,
  type AssessmentSegment,
  type AssessmentSummary,
  type AssessmentEngineMetadata,
  type AnalysisEngineSnapshot,
  type ScoreSet,
  type Score0To100,
  type CefrSubscale,
  type PerPhonemeGopEntry,
  type FocusSound,
  type ProsodyData,
  type TokenizerVersion,
  type UnknownEngineRawResult,
  createAssessmentResultIdentifier,
} from "../../../domain/assessment-result";
import { type AnalysisJobIdentifier } from "../../../domain/analysis-job";
import { type NonEmptyList } from "../../../domain/shared";
import { type AssessmentResultSearchCriteria } from "../../../domain/criteria";
import { notFound } from "../../../domain/shared";
import { okAsync, errAsync } from "neverthrow";
import { tryPersistence, tryPersistenceResult } from "./try-persistence";

type AssessmentResultRow = typeof assessmentResults.$inferSelect;

type StoredAssessmentJson = {
  scores: {
    overall: number;
    accuracy: number;
    nativeLikeness: number;
    pronunciation: number;
    connectedSpeech: number;
    prosody: number;
    intelligibility?: number | null;
    cefrOverall?: CefrSubscale | null;
    cefrSegmental?: CefrSubscale | null;
    cefrProsodic?: CefrSubscale | null;
  };
  summary: { overallCommentJa: string; overallCommentEn: string | null };
  findings: AssessmentFinding[];
  segments: AssessmentSegment[];
  metadata: AssessmentEngineMetadata;
  tokenizerVersion: string;
  perPhonemeGop?: PerPhonemeGopEntry[] | null;
  focusSounds?: FocusSound[] | null;
  prosody?: ProsodyData | null;
  engineSummaryMessageJa?: string | null;
};

const rowToAssessmentResult = (row: AssessmentResultRow): AssessmentResult => {
  const identifier = createAssessmentResultIdentifier(row.identifier);
  if (!identifier) throw new Error(`Invalid AssessmentResultIdentifier: ${row.identifier}`);

  const stored = JSON.parse(row.assessmentResultJson) as StoredAssessmentJson;
  const engineSnapshot = JSON.parse(row.engineSnapshotJson) as AnalysisEngineSnapshot;
  const raw = JSON.parse(row.rawResponseJson) as UnknownEngineRawResult;

  const scores: ScoreSet = {
    overall: stored.scores.overall as Score0To100,
    accuracy: stored.scores.accuracy as Score0To100,
    nativeLikeness: stored.scores.nativeLikeness as Score0To100,
    pronunciation: stored.scores.pronunciation as Score0To100,
    connectedSpeech: stored.scores.connectedSpeech as Score0To100,
    prosody: stored.scores.prosody as Score0To100,
    intelligibility: (stored.scores.intelligibility ?? null) as Score0To100 | null,
    cefrOverall: (stored.scores.cefrOverall ?? null) as CefrSubscale | null,
    cefrSegmental: (stored.scores.cefrSegmental ?? null) as CefrSubscale | null,
    cefrProsodic: (stored.scores.cefrProsodic ?? null) as CefrSubscale | null,
  };

  const segments = stored.segments as unknown as NonEmptyList<AssessmentSegment>;

  return {
    identifier,
    analysisJob: row.analysisJob as AnalysisJobIdentifier,
    scores,
    summary: stored.summary as AssessmentSummary,
    findings: stored.findings,
    segments,
    metadata: stored.metadata,
    tokenizerVersion: stored.tokenizerVersion as TokenizerVersion,
    raw,
    engineSnapshot,
    createdAt: new Date(row.createdAt),
    perPhonemeGop: (stored.perPhonemeGop ?? null) as ReadonlyArray<PerPhonemeGopEntry> | null,
    focusSounds: (stored.focusSounds ?? null) as ReadonlyArray<FocusSound> | null,
    prosody: (stored.prosody ?? null) as ProsodyData | null,
    engineSummaryMessageJa: stored.engineSummaryMessageJa ?? null,
  };
};

export const createDrizzleAssessmentResultRepository = (
  db: DrizzleDatabase,
): AssessmentResultRepository => ({
  find: (identifier: AssessmentResultIdentifier) => {
    return tryPersistenceResult(() => {
      const row = db
        .select()
        .from(assessmentResults)
        .where(eq(assessmentResults.identifier, String(identifier)))
        .get();

      if (!row || row.deletedAt) {
        return errAsync(notFound("AssessmentResult", String(identifier)));
      }

      return okAsync(rowToAssessmentResult(row));
    });
  },

  search: (criteria: AssessmentResultSearchCriteria) => {
    return tryPersistence(() => {
      if (criteria.type === "resultsByAnalysisRun") {
        // analysis_jobs テーブルとの JOIN が必要だが、MVP では全件取得で代替
        const rows = db
          .select()
          .from(assessmentResults)
          .where(isNull(assessmentResults.deletedAt))
          .all();

        return {
          items: rows.map(rowToAssessmentResult),
        } as AssessmentResultPage;
      }

      // resultsByJobs
      const jobIds = criteria.jobs.map(String);
      if (jobIds.length === 0) {
        return { items: [] } as AssessmentResultPage;
      }

      const rows = db
        .select()
        .from(assessmentResults)
        .where(
          and(inArray(assessmentResults.analysisJob, jobIds), isNull(assessmentResults.deletedAt)),
        )
        .all();

      return {
        items: rows.map(rowToAssessmentResult),
      } as AssessmentResultPage;
    });
  },

  persist: (result: AssessmentResult) => {
    return tryPersistence(() => {
      const assessmentResultJson = JSON.stringify({
        scores: result.scores,
        summary: result.summary,
        findings: result.findings,
        segments: result.segments,
        metadata: result.metadata,
        tokenizerVersion: result.tokenizerVersion,
        perPhonemeGop: result.perPhonemeGop,
        focusSounds: result.focusSounds,
        prosody: result.prosody,
        engineSummaryMessageJa: result.engineSummaryMessageJa,
      });

      const row = {
        identifier: String(result.identifier),
        analysisJob: String(result.analysisJob),
        overallScore: result.scores.overall,
        accuracyScore: result.scores.accuracy,
        nativeLikenessScore: result.scores.nativeLikeness,
        pronunciationScore: result.scores.pronunciation,
        connectedSpeechScore: result.scores.connectedSpeech,
        prosodyScore: result.scores.prosody,
        assessmentResultJson,
        rawResponseJson: JSON.stringify(result.raw),
        engineSnapshotJson: JSON.stringify(result.engineSnapshot),
        tokenizerVersion: String(result.tokenizerVersion),
        createdAt: result.createdAt.toISOString(),
        deletedAt: null as string | null,
      };

      db.insert(assessmentResults)
        .values(row)
        .onConflictDoUpdate({
          target: assessmentResults.identifier,
          set: {
            assessmentResultJson: row.assessmentResultJson,
            rawResponseJson: row.rawResponseJson,
            engineSnapshotJson: row.engineSnapshotJson,
          },
        })
        .run();

      return undefined;
    });
  },
});
