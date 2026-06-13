/**
 * UI 層が fetch で受け取る API レスポンス DTO の型定義。
 * domain / usecase / infrastructure は import しない。
 */

export type MaterialSourceDto = {
  sourceType: string;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  speakerName?: string | null;
};

export type MaterialDto = {
  identifier: string;
  title: string;
  source: MaterialSourceDto | null;
  createdAt: string;
  updatedAt: string;
};

export type SectionSeriesDto = {
  identifier: string;
  material: string;
  title: string;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type SectionDto = {
  identifier: string;
  sectionSeries: string;
  version: number;
  bodyText: string;
  createdAt: string;
};

export type SectionVersionSummaryDto = {
  identifier: string;
  version: number;
  createdAt: string;
};

export type SectionSeriesWithLatestDto = {
  sectionSeries: SectionSeriesDto;
  latestSection: SectionDto | null;
  versions: SectionVersionSummaryDto[];
};

export type PracticePlanDto = {
  material: MaterialDto;
  sectionSeries: SectionSeriesWithLatestDto[];
};

export type RecordingAttemptDto = {
  identifier: string;
  section: string | null;
  status: string;
  createdAt: string;
};

export type AnalysisRunDto = {
  identifier: string;
  recordingAttempt: string;
  status: string;
  createdAt: string;
};

export type AnalysisJobDto = {
  identifier: string;
  analysisRun: string;
  engine: string;
  status: string;
  attemptCount: number;
};

export type TextRangeDto = {
  startChar: number;
  endChar: number;
};

export type TokenRangeDto = {
  startTokenIndex: number;
  endTokenIndex: number;
};

export type AudioRangeDto = {
  startMilliseconds: number;
  endMilliseconds: number;
};

export type HighlightRangeDto = {
  finding: string;
  severity: string;
  category: string;
  textRange: TextRangeDto;
  tokenRange: TokenRangeDto | null;
  audioRange: AudioRangeDto | null;
  messageJa: string | null;
  messageEn: string | null;
  confidence: number | null;
};

export type HighlightsByEngineDto = {
  engine: string;
  highlights: HighlightRangeDto[];
};

export type ScoresDto = {
  overall: number;
  accuracy: number;
  nativeLikeness: number;
  pronunciation: number;
  connectedSpeech: number;
  prosody: number;
};

export type FindingDto = {
  identifier: string;
  phenomenon: FindingPhenomenon | null;
  gop: number | null;
  category: string;
  severity: string;
  textRange: TextRangeDto;
  audioRange: AudioRangeDto | null;
  expected: { text: string; ipa: string | null } | null;
  detected: { text: string; ipa: string | null } | null;
  messageJa: string | null;
  messageEn: string | null;
  scoreImpact: number | null;
  confidence: number | null;
};

export type AssessmentResultDto = {
  identifier: string;
  analysisJob: string;
  engine: string;
  scores: ScoresDto;
  summary: { messageJa: string | null; messageEn: string | null } | null;
  findings: FindingDto[];
  engineSnapshot: { kind: string; displayName: string } | null;
  createdAt: string;
};

export type ResultsByEngineDto = {
  engine: string;
  result: AssessmentResultDto | null;
};

export type SectionTokenDto = {
  tokenIndex: number;
  text: string;
  startChar: number;
  endChar: number;
};

// ---- v2 DTO 補助型 ----

export type NBestCandidateDto = {
  phoneme: string;
  confidence: number;
};

export type FeedbackLayersDto = {
  whatJa: string;
  whyJa: string;
  howJa: string;
};

export type PerPhonemeGopDto = {
  word: string;
  phoneme: string;
  gop: number;
  heat: number;
};

export type FocusSoundDto = {
  pair: string;
  phenomenon: string | null;
  functionalLoad: string;
  occurrences: number;
  priority: string;
  reasonJa: string;
  catalogId: string | null;
};

export type ProsodyDto = {
  f0Contour: { timesMs: number[]; valuesHz: number[] } | null;
  wordStress:
    | { word: string; wordIndex: number; expectedStress: number; predictedStress: number }[]
    | null;
  rhythmNpvi: number | null;
  referenceNpvi: number | null;
  weakFormRate: number | null;
};

export type CefrSubscaleDto = {
  score: number;
  band: string;
};

export type EngineFindingDto = {
  finding: string;
  phenomenon: FindingPhenomenon | null;
  gop: number | null;
  severity: "critical" | "major" | "minor" | "suggestion";
  category: string;
  textRange: TextRangeDto;
  audioRange: AudioRangeDto | null;
  expected: { text: string | null; ipa: string | null };
  detected: { text: string | null; ipa: string | null };
  messageJa: string;
  messageEn: string | null;
  scoreImpact: number;
  confidence: number;
  // ---- v2 フィールド (M-103/104/108/109/112/115) ----
  detectedTopCandidate: string | null;
  nBest: NBestCandidateDto[] | null;
  matchesL1Pattern: boolean;
  functionalLoad: string | null;
  catalogId: string | null;
  wordPair: { first: string; second: string } | null;
  expectedPronunciation: string | null;
  insertedVowel: string | null;
  feedbackLayers: FeedbackLayersDto | null;
  dismissed: boolean;
};

export type EngineResultDto = {
  result: string;
  engineKind: "cloud" | "oss_worker";
  engineName: string;
  modelName: string | null;
  scores: {
    overall: number;
    accuracy: number;
    nativeLikeness: number;
    pronunciation: number;
    connectedSpeech: number;
    prosody: number;
    // ---- v2 (M-111): 二段階ゴール + CEFR 3 下位尺度 ----
    intelligibility: number | null;
    cefrOverall: CefrSubscaleDto | null;
    cefrSegmental: CefrSubscaleDto | null;
    cefrProsodic: CefrSubscaleDto | null;
  };
  counts: {
    critical: number;
    major: number;
    minor: number;
    suggestion: number;
  };
  findings: EngineFindingDto[];
  // ---- v2 (M-107b/c, M-112, M-114) ----
  engineSummaryMessageJa: string | null;
  perPhonemeGop: PerPhonemeGopDto[] | null;
  focusSounds: FocusSoundDto[] | null;
  prosody: ProsodyDto | null;
};

export type WorkspaceDto = {
  material?: MaterialDto;
  sectionSeries?: SectionSeriesDto;
  section: SectionDto;
  sectionTokens: SectionTokenDto[];
  recordingAttempts: RecordingAttemptDto[];
  latestAnalysisRun: {
    identifier: string;
    mode?: string;
    status: string;
    errorCode?: string | null;
  } | null;
  resultsByEngine: EngineResultDto[];
  highlightRangesByEngine: HighlightsByEngineDto[];
};

export type PaginationDto = {
  type: string;
  offset: number;
  limit: number;
  total: number;
};

export type ApiResponse<T> = {
  data: T;
  meta: { requestIdentifier: string };
};

export type ApiListResponse<T> = {
  data: T[];
  page: PaginationDto;
  meta: { requestIdentifier: string };
};

export type ApiError = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta: { requestIdentifier: string };
};

// 解析モード
export type AnalysisMode = "cloudOnly" | "ossWorkerOnly" | "comparison";

export const ANALYSIS_MODE_LABELS: Record<AnalysisMode, string> = {
  cloudOnly: "Cloud only",
  ossWorkerOnly: "OSS Worker only",
  comparison: "Comparison (both)",
};

// カテゴリ・重大度のラベルと色
export type Severity = "critical" | "major" | "minor" | "info";
export type FindingCategory =
  | "accuracy"
  | "pronunciation"
  | "connectedSpeech"
  | "prosody"
  | "nativeLikeness";

/**
 * Worker から返される発音エラーの現象種別。
 * domain は import しないため独立定義。
 * C4-a: 11値 (substitution/omission/insertion/connectedSpeech/weakForm/linking/flap/assimilation/reduction/epenthesis/lexicalStress)
 */
export type FindingPhenomenon =
  | "substitution"
  | "omission"
  | "insertion"
  | "connectedSpeech"
  | "weakForm"
  | "linking"
  | "flap"
  | "assimilation"
  | "reduction"
  | "epenthesis"
  | "lexicalStress";

export const SEVERITY_LABELS: Record<string, string> = {
  critical: "Critical",
  major: "Major",
  minor: "Minor",
  info: "Info",
};

export const CATEGORY_LABELS: Record<string, string> = {
  accuracy: "Accuracy",
  pronunciation: "Pronunciation",
  connectedSpeech: "Connected Speech",
  prosody: "Prosody",
  nativeLikeness: "Native-likeness",
};

// ---- Progress DTOs (Training Context — M-PG-3) ----

export type ProgressSnapshotDto = {
  identifier: string;
  section: string;
  sourceAssessment: string;
  taskKind: "rereading" | "drill";
  cefrSubscales: DiagnosticCefrSubscalesDto;
  focusScores: Array<{ contrast: string; score: number }>;
  cumulativeTrainingMinutes: number;
  capturedAt: string;
};

/**
 * ProgressDto — 進捗 API レスポンス DTO (M-PG-3)
 *
 * snapshots: 時系列全件 (capturedAt 昇順)
 * now: 最新スナップショット (null = 0 件 / honest empty)
 * prev: 1 個前のスナップショット (null = 1 件以下 / OQ-6 honest empty)
 */
export type ProgressDto = {
  snapshots: ProgressSnapshotDto[];
  now: ProgressSnapshotDto | null;
  prev: ProgressSnapshotDto | null;
};

export const ENGINE_LABELS: Record<string, string> = {
  cloud: "OpenAI",
  oss_worker: "OSS Worker",
};

// ---- History DTOs ----

export type AssessmentResultSummaryDto = {
  identifier: string;
  overallScore: number;
  createdAt: string;
};

export type HistoryAnalysisRunDto = {
  identifier: string;
  mode: string;
  status: string;
  createdAt: string;
  assessmentResults: AssessmentResultSummaryDto[];
};

export type HistoryRecordingAttemptDto = {
  identifier: string;
  status: string;
  createdAt: string;
};

export type HistorySectionDto = {
  identifier: string;
  version: number;
  bodyText: string;
  createdAt: string;
};

export type HistorySectionVersionDto = {
  section: HistorySectionDto;
  recordingAttempts: HistoryRecordingAttemptDto[];
  analysisRuns: HistoryAnalysisRunDto[];
};

export type HistoryGroupDto = {
  sectionSeries: { identifier: string; title: string };
  sections: HistorySectionVersionDto[];
};

// ---- Diagnostic DTOs (Training Context) ----

export type DiagnosticPromptDto = {
  identifier: string;
  text: string;
  targetCatalogId: string | null;
  phenomenon: "segmental" | "epenthesis" | "prosodic";
};

export type DiagnosticSessionDto = {
  identifier: string;
  status: "pending" | "completed";
  promptSet: { prompts: DiagnosticPromptDto[] };
  startedAt: string;
  completedAt: string | null;
  weaknessProfileIdentifier: string | null;
};

export type DiagnosticFocusSoundDto = {
  contrast: string;
  catalogId: string;
  functionalLoadRank: string;
  occurrenceFrequency: number;
  mastery: number;
  priority: number;
};

export type DiagnosticCefrSubscalesDto = {
  overall: { score: number; band: string } | null;
  segmental: { score: number; band: string } | null;
  prosodic: { score: number; band: string } | null;
};

export type DiagnosticResultDto = {
  diagnosticSessionIdentifier: string;
  weaknessProfileIdentifier: string;
  stage: "stageI" | "stageII";
  cefrSubscales: DiagnosticCefrSubscalesDto;
  focusSounds: DiagnosticFocusSoundDto[];
  completedAt: string;
};
