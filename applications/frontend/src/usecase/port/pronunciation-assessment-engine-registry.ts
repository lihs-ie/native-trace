import { type Result } from "neverthrow";
import { type DomainError } from "../../domain/shared";
import { type AnalysisEngine } from "../../domain/analysis-engine";
import { type PronunciationAssessmentEngine } from "./pronunciation-assessment-engine";

export type PronunciationAssessmentEngineRegistry = Readonly<{
  find: (engine: AnalysisEngine) => Result<PronunciationAssessmentEngine, DomainError>;
}>;
