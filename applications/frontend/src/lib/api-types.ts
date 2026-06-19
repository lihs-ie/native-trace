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

export type MaterialStatsDto = {
  sectionSeriesCount: number;
  recordingAttemptCount: number;
  /** assessment_results.overall_score の最大値。試行なし = null (honest empty) */
  bestOverallScore: number | null;
  /**
   * スコア推移 (overall_score を createdAt 昇順)。
   * 0 件のとき [] (honest empty)。UI は 1 件以下のとき spark を非表示にする。
   */
  overallScoreHistory: number[];
  /** 全セクションで最後に練習した ISO-8601 日時。試行なし = null (honest empty) */
  lastPracticedAt: string | null;
};

export type MaterialDto = {
  identifier: string;
  title: string;
  source: MaterialSourceDto | null;
  createdAt: string;
  updatedAt: string;
  stats: MaterialStatsDto;
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

export type SectionSeriesStatsDto = {
  wordCount: number | null;
  recordingAttemptCount: number;
  bestOverallScore: number | null;
  overallScoreHistory: number[];
};

export type SectionSeriesWithLatestDto = {
  sectionSeries: SectionSeriesDto;
  latestSection: SectionDto | null;
  versions: SectionVersionSummaryDto[];
  stats: SectionSeriesStatsDto;
};

export type MaterialLevelStatsDto = {
  totalWordCount: number;
  totalRecordingAttemptCount: number;
  bestOverallScore: number | null;
};

export type PracticePlanDto = {
  material: MaterialDto;
  sectionSeries: SectionSeriesWithLatestDto[];
  materialLevelStats: MaterialLevelStatsDto;
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
  /** M-F0REF-c: お手本 F0 輪郭（f0Contour と同形。worker が返さない場合は null） */
  referenceF0Contour: { timesMs: number[]; valuesHz: number[] } | null;
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

/**
 * M-APD-13 (ADR-018): worker acousticEvidence の方向ラベル + 実測/目標フォルマント。
 * 全ラベルは string literal union | null（optional なし — DTO スタイルに統一）。
 */
export type AcousticEvidenceDto = {
  tongueHeight: "tooHigh" | "tooLow" | "ok" | null;
  tongueBackness: "tooFront" | "tooBack" | "ok" | null;
  rhoticity: "insufficient" | "overRetroflex" | "ok" | null;
  sibilantPlace: "tooPalatal" | "tooAlveolar" | "ok" | null;
  vowelLength: "tooShort" | "ok" | null;
  measuredF1Hz: number | null;
  measuredF2Hz: number | null;
  measuredF3Hz: number | null;
  targetF1Hz: number | null;
  targetF2Hz: number | null;
  targetF3Hz: number | null;
};

/**
 * M-AAI-12 (ADR-019): EMA 調音推定座標 + 表示適格性スコア。
 * 座標は発話内 z-score 正規化後 [-1,1] クランプ済み（生 mm ではない）。
 * displayEligibility = validFrameRatio × voicingRatio × durationAdequacy ([0,1])。
 * null は AAI 不在 / ガードレール未達 = floor のみ描画。
 */
export type ArticulatoryEstimateDto = {
  tongueTipX: number;
  tongueTipY: number;
  tongueDorsumX: number;
  tongueDorsumY: number;
  lipApertureX: number;
  lipApertureY: number;
  displayEligibility: number;
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
  /** D4 (ADR-017): 挿入母音の時刻位置（ミリ秒）。null は未同定。*/
  insertionPositionMs: number | null;
  feedbackLayers: FeedbackLayersDto | null;
  dismissed: boolean;
  /** M-APD-13 (ADR-018): 音響音声学的証拠。worker が導出した方向ラベル + 実測/目標フォルマント。*/
  acousticEvidence: AcousticEvidenceDto | null;
  /** M-AAI-12 (ADR-019): EMA 調音推定座標。null は AAI 不在/ガードレール未達 = floor のみ描画。*/
  articulatoryEstimate: ArticulatoryEstimateDto | null;
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

/**
 * M-CRL-6 (ADR-022): finding-level retry 録音の評価結果。
 * EngineResultDto の兄弟 export（フィールドとして追加しない）。
 * qualityStatus は 200 レスポンスでは常に 'normal'（low_quality retry は 422 で処理）。
 */
export type RetryRecordingResponse = {
  findingIdentifier: string;
  phoneme: string;
  originalGop: number;
  retryGop: number;
  gopDelta: number;
  deltaSignal: "improved" | "unchanged" | "regressed";
  boundarySignal: "crossedMajor" | "crossedMinor" | "none";
  qualityStatus: "normal" | "low_quality";
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
  /** PPC Section / DiagnosticSession 識別子。訓練由来スナップショットは null (DD-205)。 */
  section: string | null;
  /** assessment_results 識別子。訓練由来スナップショットは null (DD-205)。 */
  sourceAssessment: string | null;
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
  findingsCount: number;
  engineKind: string;
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

// ---- Training Drill DTOs (Training Context — REQ-123) ----

export type MinimalPairDto = {
  targetWord: string;
  contrastWord: string;
  targetPhonemeIpa: string;
  contrastPhonemeIpa: string;
};

/**
 * DrillDto — 産出ドリルセッション開始レスポンス DTO
 * 対象対立・ミニマルペア・対象音素・例文・指導ヒントを含む。
 */
export type DrillDto = {
  trainingSessionIdentifier: string;
  catalogId: string;
  contrast: string;
  targetPhonemes: string[];
  minimalPairs: MinimalPairDto[];
  exampleSentence: string;
  exampleTargetPhonemeIpas: string[];
  hintJa: string;
};

export type TargetPhonemeEvaluationDto = {
  targetPhonemeIpa: string;
  gop: number | null;
  nBest: Array<{ phoneme: string; confidence: number }> | null;
  severity: string | null;
};

/**
 * DrillVerdictDto — ドリル録音提出→即時評価レスポンス DTO
 * 産出成否・target GOP・NBest・判定根拠を含む。
 */
export type DrillVerdictDto = {
  verdict: "success" | "failure";
  hvptTrialIdentifier: string;
  targetPhonemeEvaluations: TargetPhonemeEvaluationDto[];
  verdictReasonJa: string;
};

// ---- HVPT 識別課題 DTOs (Training Context — REQ-122) ----

export type StimulusMetadataDto = {
  stimulusIdentifier: string;
  contrast: string;
  word: string;
  speakerIdentifier: string;
  speakerSex: string;
  context: string;
  sourceCorpus: string;
  licenseIdentifier: string;
};

export type HvptChoiceDto = {
  type: "spelling" | "keyword" | "ipa";
  value: string;
};

export type HvptStimulusDto = {
  stimulusIdentifier: string;
  wavBase64: string;
  metadata: StimulusMetadataDto;
  choices: HvptChoiceDto[];
};

/**
 * HvptSessionDto — HVPT セッション開始レスポンス DTO
 * 刺激セット（音声 + 選択肢）と TrainingSession 識別子を含む。
 */
export type HvptSessionDto = {
  trainingSessionIdentifier: string;
  contrast: string;
  stimuli: HvptStimulusDto[];
};

/**
 * HvptTrialResultDto — HVPT 試行提出レスポンス DTO
 * 正誤フィードバック・正解音再生用刺激参照を含む。
 */
export type HvptTrialResultDto = {
  hvptTrialIdentifier: string;
  correct: boolean;
  correctLabel: HvptChoiceDto;
  correctStimulusWavBase64: string | null;
};

/**
 * HvptCompletionDto — HVPT セッション完了レスポンス DTO
 * accuracy・ゲート結果・累計訓練時間を含む。
 */
export type HvptCompletionDto = {
  trainingSessionIdentifier: string;
  sessionAccuracy: number;
  spacingState: "rest" | "gate";
  cumulativeTrainingMinutes: number;
};

// ---- SpacingSchedule DTO (Training Context — REQ-127) ----

export type SpacingScheduleDto = {
  identifier: string;
  contrast: string;
  state: "rest" | "due" | "gate" | "done";
  nextPresentationAt: string;
  recentAccuracy: number | null;
};

export type TrainingScheduleDto = {
  schedules: SpacingScheduleDto[];
  cumulativeTrainingMinutes: number;
};

// ---- Shadowing Lag DTOs (Training Context — REQ-125, M-SHL-4/5/6) ----

export type ShadowingPerSegmentLagDto = {
  phoneme: string;
  lagMilliseconds: number;
};

/**
 * ShadowingLagResultDto — シャドーイングラグ計測レスポンス DTO
 * worker /v1/pronunciation-assessments/shadowing の計測値をそのまま伝播する。
 * recommendSlowPlayback は worker 判定済み (ADR-013: frontend で再判定しない)。
 * thresholdMilliseconds: 判定に使われた閾値 (config.SHADOWING_LAG_THRESHOLD_MS 由来)。
 * weeklySessionCount: 過去7日間の shadowing 完了セッション数 (M-SHL-4 .scope-note)。
 */
export type ShadowingLagResultDto = {
  trainingSessionIdentifier: string;
  lagMilliseconds: number;
  perSegmentLag: ShadowingPerSegmentLagDto[];
  speechRateRatio: number | null;
  pauseCountLearner: number | null;
  pauseCountReference: number | null;
  recommendSlowPlayback: boolean;
  thresholdMilliseconds: number;
  weeklySessionCount: number;
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
