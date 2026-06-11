import { type ResultAsync } from "neverthrow";
import { type DomainError } from "../../domain/shared";
import { type AssessmentResultDraft } from "../assessment-result-draft";
import { type AnalysisEngine } from "../../domain/analysis-engine";
import { type AnalysisJobIdentifier } from "../../domain/analysis-job";
import { type AnalysisRunIdentifier } from "../../domain/analysis-run";
import { type RecordingAttemptIdentifier } from "../../domain/recording-attempt";
import { type SectionIdentifier } from "../../domain/section";

export type AssessPronunciationInput = Readonly<{
  analysisJob: AnalysisJobIdentifier;
  analysisRun: AnalysisRunIdentifier;
  recordingAttempt: RecordingAttemptIdentifier;
  section: SectionIdentifier;
  engine: AnalysisEngine;
  sectionBodyText: string;
  /**
   * Local MVP では audioBuffer: Buffer で音声データを渡す。
   * 設計書 §4.2 の openStream はストリーミング最適化であり、
   * ローカル MVP ではバッファ展開で代替可能。
   */
  audioBuffer: Buffer;
  audioMimeType: string;
  audioByteLength: number;
  audioDurationMilliseconds: number;
  tokenizerVersion: string;
  assessmentSchemaVersion: string;
}>;

export type PronunciationAssessmentEngine = Readonly<{
  assess: (input: AssessPronunciationInput) => ResultAsync<AssessmentResultDraft, DomainError>;
}>;
