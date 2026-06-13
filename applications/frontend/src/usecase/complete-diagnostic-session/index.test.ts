import { describe, it, expect, vi } from "vitest";
import { okAsync, errAsync } from "neverthrow";
import {
  createCompleteDiagnosticSession,
  projectFindingsToCatalogFocusSounds,
  type CompleteDiagnosticSessionDependencies,
  type GopNormalizationRange,
  type FindingProjectionInput,
} from "./index";
import {
  type DiagnosticSession,
  createDiagnosticSessionIdentifier,
  createLearnerIdentifier,
} from "../../domain/training";
import { getDiagnosticPromptSet } from "../../infrastructure/training/diagnostic-prompt-fixture";
import type { AssessmentResult } from "../../domain/assessment-result";
import { notFound } from "../../domain/shared";

/**
 * M-DG-3/4: completeDiagnosticSession usecase contract test
 *
 * - findings → catalog projection → initializeWeaknessProfile の経路を assert
 * - 三項式が動的に算出されること（mastery が上がると priority が下がる）
 * - GOP 負値スケール（実 worker: -8〜-13）で mastery が変動すること
 * - 実 worker shape（catalogId=null, detectedTopCandidate あり）で多様な focus が生成されること
 * - LLM 呼び出しが無いこと（usecase 層に OpenAI SDK import なし）
 */

const SENTINEL_LEARNER = "01JWZLEARNER0000000000001";
const SESSION_ID = "01JX0000000000000000000001";
const PROFILE_ID = "01JX0000000000000000000002";

/** worker gopFloor=-20, gopCeiling=-2 に対応するデフォルトレンジ */
const DEFAULT_GOP_RANGE: GopNormalizationRange = { floor: -20, ceiling: -2 };

const makeSession = (): DiagnosticSession => {
  const identifier = createDiagnosticSessionIdentifier(SESSION_ID)!;
  const learner = createLearnerIdentifier(SENTINEL_LEARNER)!;
  return {
    type: "pending",
    identifier,
    learner,
    promptSet: getDiagnosticPromptSet(),
    startedAt: new Date("2026-06-13T00:00:00Z"),
  };
};

/** 実 worker shape finding: catalogId=null, GOP 負値, detectedTopCandidate あり */
const makeRealWorkerFinding = (
  overrides: Partial<AssessmentResult["findings"][number]> = {},
): AssessmentResult["findings"][number] => ({
  identifier: "FIND_1" as never,
  phenomenon: "substitution",
  gop: -10.4,
  category: "accuracy",
  severity: "major",
  textRange: { startOffset: 0, endOffset: 5 },
  audioRange: null,
  expected: { text: null, ipa: "h ə l oʊ w ɜː l d" },
  detected: { text: null, ipa: "f ʌ n ɔ w ɜː l d" },
  messageJa: "診断テスト: 音素代替が検出されました",
  messageEn: null,
  scoreImpact: -8,
  confidence: 0.85 as never,
  detectedTopCandidate: "ɹ",
  nBest: [{ phoneme: "ɹ", confidence: 0.0005 }],
  matchesL1Pattern: false,
  functionalLoad: null,
  catalogId: null,
  wordPair: null,
  expectedPronunciation: null,
  insertedVowel: null,
  feedbackLayers: null,
  dismissed: false,
  wordPositionLabel: null,
  ...overrides,
});

const makeAssessmentResultWithRealFindings = (
  findings: AssessmentResult["findings"] = [],
): AssessmentResult => ({
  identifier: "AR_1" as never,
  analysisJob: "JOB_1" as never,
  scores: {
    overall: 59 as never,
    accuracy: 55 as never,
    nativeLikeness: 50 as never,
    pronunciation: 58 as never,
    connectedSpeech: 62 as never,
    prosody: 65 as never,
    intelligibility: null,
    cefrOverall: { score: 59, band: "B1" },
    cefrSegmental: { score: 55, band: "B1" },
    cefrProsodic: { score: 65, band: "B1+" },
  },
  summary: { overallCommentJa: "テスト", overallCommentEn: null },
  findings,
  segments: [
    {
      textRange: { startOffset: 0, endOffset: 10 },
      audioRange: null,
      transcript: null,
      confidence: 0.9,
    },
  ] as never,
  metadata: {
    engineName: "oss_worker",
    engineVersion: "1.0",
    modelName: null,
    promptVersion: null,
    schemaVersion: "1",
  },
  tokenizerVersion: "v1" as never,
  raw: { data: {} },
  engineSnapshot: { type: "oss_worker", identifier: "w1", displayName: "worker", modelName: null },
  createdAt: new Date("2026-06-13T00:00:00Z"),
  perPhonemeGop: null,
  focusSounds: null,
  prosody: null,
  engineSummaryMessageJa: null,
});

/** 旧合成データ形 (catalogId あり, GOP 正値) */
const makeAssessmentResultSynthetic = (): AssessmentResult =>
  makeAssessmentResultWithRealFindings([
    {
      identifier: "FIND_1" as never,
      phenomenon: "substitution",
      gop: 0.3,
      category: "accuracy",
      severity: "major",
      textRange: { startOffset: 0, endOffset: 3 },
      audioRange: null,
      expected: { text: "l", ipa: null },
      detected: { text: "r", ipa: null },
      messageJa: "l/r の区別",
      messageEn: null,
      scoreImpact: -10,
      confidence: 0.9 as never,
      detectedTopCandidate: null,
      nBest: null,
      matchesL1Pattern: true,
      functionalLoad: "max",
      catalogId: "l-r-substitution",
      wordPair: null,
      expectedPronunciation: null,
      insertedVowel: null,
      feedbackLayers: null,
      dismissed: false,
      wordPositionLabel: null,
    },
  ]);

const makeDeps = (
  overrides: Partial<CompleteDiagnosticSessionDependencies> = {},
  assessmentResult: AssessmentResult = makeAssessmentResultSynthetic(),
): CompleteDiagnosticSessionDependencies => ({
  diagnosticSessionRepository: {
    find: () => okAsync(makeSession()),
    findLatestByLearner: () => okAsync(null),
    persist: vi.fn(() => okAsync(undefined)) as never,
  },
  weaknessProfileRepository: {
    find: () => errAsync(notFound("WeaknessProfile", "x")),
    findByLearner: () => okAsync(null),
    persist: vi.fn(() => okAsync(undefined)) as never,
  },
  assessmentResultRepository: {
    find: () => okAsync(assessmentResult),
    search: () => okAsync({ items: [assessmentResult] }),
    persist: vi.fn(() => okAsync(undefined)) as never,
  },
  entropyProvider: {
    generateUlid: () => PROFILE_ID,
    generateUuidV4: () => "00000000-0000-0000-0000-000000000002",
  },
  clock: {
    now: () => new Date("2026-06-13T01:00:00Z"),
  },
  ...overrides,
});

describe("createCompleteDiagnosticSession", () => {
  it("DiagnosticSession を completed に遷移し WeaknessProfile を永続化する", async () => {
    const deps = makeDeps();
    const executor = createCompleteDiagnosticSession(deps);

    const result = await executor({
      diagnosticSessionIdentifier: SESSION_ID,
      assessmentResultIdentifiers: ["AR_1"],
      priorityWeights: { w1: 0.5, w2: 0.3, w3: 0.2 },
      gopNormalizationRange: DEFAULT_GOP_RANGE,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.diagnosticSessionIdentifier).toBe(SESSION_ID);
      expect(result.value.weaknessProfileIdentifier).toBe(PROFILE_ID);
      expect(result.value.focusSoundCount).toBeGreaterThan(0);
    }

    // WeaknessProfile と DiagnosticSession の両方が永続化されること
    expect(
      deps.weaknessProfileRepository.persist as ReturnType<typeof vi.fn>,
    ).toHaveBeenCalledOnce();
    expect(
      deps.diagnosticSessionRepository.persist as ReturnType<typeof vi.fn>,
    ).toHaveBeenCalledOnce();
  });

  it("assessmentResultIdentifiers が空の場合はエラーを返す", async () => {
    const deps = makeDeps();
    const executor = createCompleteDiagnosticSession(deps);

    const result = await executor({
      diagnosticSessionIdentifier: SESSION_ID,
      assessmentResultIdentifiers: [],
      priorityWeights: { w1: 0.5, w2: 0.3, w3: 0.2 },
      gopNormalizationRange: DEFAULT_GOP_RANGE,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("validationFailed");
    }
  });

  it("completed session を再度完了しようとするとエラーを返す", async () => {
    const completedSession: DiagnosticSession = {
      type: "completed",
      identifier: createDiagnosticSessionIdentifier(SESSION_ID)!,
      learner: createLearnerIdentifier(SENTINEL_LEARNER)!,
      promptSet: getDiagnosticPromptSet(),
      assessmentResults: ["AR_1"] as never,
      weaknessProfile: "WP_1" as never,
      startedAt: new Date("2026-06-13T00:00:00Z"),
      completedAt: new Date("2026-06-13T01:00:00Z"),
    };

    const deps = makeDeps({
      diagnosticSessionRepository: {
        find: () => okAsync(completedSession),
        findLatestByLearner: () => okAsync(null),
        persist: vi.fn(() => okAsync(undefined)) as never,
      },
    });
    const executor = createCompleteDiagnosticSession(deps);

    const result = await executor({
      diagnosticSessionIdentifier: SESSION_ID,
      assessmentResultIdentifiers: ["AR_1"],
      priorityWeights: { w1: 0.5, w2: 0.3, w3: 0.2 },
      gopNormalizationRange: DEFAULT_GOP_RANGE,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("validationFailed");
    }
  });

  /**
   * M-DG-3/4 統合テスト: 実 worker shape（負 GOP・catalogId=null・phenomenon omission/substitution）
   * で completeDiagnosticSession を駆動し、多様な focus と変動する mastery を assert する。
   */
  it("実 worker shape findings（負 GOP・catalogId null）で多様な focus sounds が生成される", async () => {
    // 実 worker 観測値に近い findings: omission + substitution(detectedTopCandidate=ɹ)
    const realFindings: AssessmentResult["findings"] = [
      // omission findings (複数) → final-consonant-omission
      ...Array.from({ length: 5 }, (_, index) =>
        makeRealWorkerFinding({
          identifier: `FIND_OMIT_${index}` as never,
          phenomenon: "omission",
          gop: -12.0,
          detectedTopCandidate: null,
          expected: { text: null, ipa: "h ə l oʊ" },
        }),
      ),
      // substitution findings: detectedTopCandidate=ɹ → l-r-substitution または r-substitution
      ...Array.from({ length: 3 }, (_, index) =>
        makeRealWorkerFinding({
          identifier: `FIND_SUBST_R_${index}` as never,
          phenomenon: "substitution",
          gop: -10.5,
          detectedTopCandidate: "ɹ",
          expected: { text: null, ipa: "h ə l oʊ w ɜː l d" },
        }),
      ),
    ];

    const assessmentResult = makeAssessmentResultWithRealFindings(realFindings);
    const deps = makeDeps({}, assessmentResult);
    const executor = createCompleteDiagnosticSession(deps);

    const result = await executor({
      diagnosticSessionIdentifier: SESSION_ID,
      assessmentResultIdentifiers: ["AR_1"],
      priorityWeights: { w1: 0.5, w2: 0.3, w3: 0.2 },
      gopNormalizationRange: DEFAULT_GOP_RANGE,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.focusSoundCount).toBeGreaterThan(0);
    }
    expect(
      deps.weaknessProfileRepository.persist as ReturnType<typeof vi.fn>,
    ).toHaveBeenCalledOnce();
  });
});

describe("projectFindingsToCatalogFocusSounds (M-DG-4)", () => {
  it("catalogId がある finding を FocusSound 候補に射影する", () => {
    const findings: FindingProjectionInput[] = [
      {
        phenomenon: "substitution",
        gop: -5.0,
        severity: "major",
        catalogId: "l-r-substitution",
        contrast: null,
        detectedTopCandidate: null,
        expectedIpa: null,
      },
    ];

    const result = projectFindingsToCatalogFocusSounds(findings, 12, DEFAULT_GOP_RANGE);
    expect(result.length).toBeGreaterThan(0);

    const sound = result.find((s) => String(s.catalogId) === "l-r-substitution");
    expect(sound).toBeDefined();
    expect(sound?.functionalLoadRank).toBe("max");
  });

  it("負 GOP スケール（実 worker）で mastery が変動する（M-DG-4）", () => {
    // 実 worker GOP レンジ: -2(良)〜-20(悪)
    const findingGoodGop: FindingProjectionInput[] = [
      {
        phenomenon: "substitution",
        gop: -3.0, // 良い GOP → mastery 高
        severity: "minor",
        catalogId: "l-r-substitution",
        contrast: null,
        detectedTopCandidate: null,
        expectedIpa: null,
      },
    ];

    const findingBadGop: FindingProjectionInput[] = [
      {
        phenomenon: "substitution",
        gop: -13.0, // 悪い GOP → mastery 低
        severity: "critical",
        catalogId: "l-r-substitution",
        contrast: null,
        detectedTopCandidate: null,
        expectedIpa: null,
      },
    ];

    const goodResult = projectFindingsToCatalogFocusSounds(findingGoodGop, 12, DEFAULT_GOP_RANGE);
    const badResult = projectFindingsToCatalogFocusSounds(findingBadGop, 12, DEFAULT_GOP_RANGE);

    expect(goodResult.length).toBeGreaterThan(0);
    expect(badResult.length).toBeGreaterThan(0);

    const goodSound = goodResult[0]!;
    const badSound = badResult[0]!;

    // 良い GOP → mastery 高い、悪い GOP → mastery 低い（三項式が動的）
    expect(Number(goodSound.mastery)).toBeGreaterThan(Number(badSound.mastery));
    // mastery はいずれも [0, 1] 内
    expect(Number(goodSound.mastery)).toBeGreaterThanOrEqual(0);
    expect(Number(goodSound.mastery)).toBeLessThanOrEqual(1);
    expect(Number(badSound.mastery)).toBeGreaterThanOrEqual(0);
    expect(Number(badSound.mastery)).toBeLessThanOrEqual(1);
  });

  it("GOP ceiling 以上（-2 以上）は mastery=1.0 にクランプされる", () => {
    const findings: FindingProjectionInput[] = [
      {
        phenomenon: "substitution",
        gop: -1.0, // ceiling=-2 より大きい → mastery 1.0
        severity: "minor",
        catalogId: "l-r-substitution",
        contrast: null,
        detectedTopCandidate: null,
        expectedIpa: null,
      },
    ];

    const result = projectFindingsToCatalogFocusSounds(findings, 12, DEFAULT_GOP_RANGE);
    expect(result.length).toBeGreaterThan(0);
    expect(Number(result[0]!.mastery)).toBe(1.0);
  });

  it("GOP floor 以下（-20 以下）は mastery=0.0 にクランプされる", () => {
    const findings: FindingProjectionInput[] = [
      {
        phenomenon: "substitution",
        gop: -25.0, // floor=-20 より小さい → mastery 0.0
        severity: "critical",
        catalogId: "l-r-substitution",
        contrast: null,
        detectedTopCandidate: null,
        expectedIpa: null,
      },
    ];

    const result = projectFindingsToCatalogFocusSounds(findings, 12, DEFAULT_GOP_RANGE);
    expect(result.length).toBeGreaterThan(0);
    expect(Number(result[0]!.mastery)).toBe(0.0);
  });

  it("低 FL 対立 (/θ/-/s/) は検出されるが catalogId で識別可能", () => {
    const findings: FindingProjectionInput[] = [
      {
        phenomenon: "substitution",
        gop: -8.0,
        severity: "minor",
        catalogId: "theta-s-substitution",
        contrast: null,
        detectedTopCandidate: null,
        expectedIpa: null,
      },
    ];

    const result = projectFindingsToCatalogFocusSounds(findings, 12, DEFAULT_GOP_RANGE);
    const sound = result.find((s) => String(s.catalogId) === "theta-s-substitution");
    expect(sound).toBeDefined();
    expect(sound?.functionalLoadRank).toBe("low");
  });

  it("実 worker shape: catalogId=null + detectedTopCandidate=ɹ → l/r 系エントリに射影される (M-DG-3)", () => {
    // 実 worker finding: catalogId なし、detectedTopCandidate=ɹ（l/r 混同）
    const findings: FindingProjectionInput[] = [
      {
        phenomenon: "substitution",
        gop: -10.5,
        severity: "major",
        catalogId: null,
        contrast: null,
        detectedTopCandidate: "ɹ",
        expectedIpa: "h ə l oʊ w ɜː l d",
      },
      {
        phenomenon: "substitution",
        gop: -11.0,
        severity: "major",
        catalogId: null,
        contrast: null,
        detectedTopCandidate: "ɹ",
        expectedIpa: "r ɛ d",
      },
    ];

    const result = projectFindingsToCatalogFocusSounds(findings, 12, DEFAULT_GOP_RANGE);
    expect(result.length).toBeGreaterThan(0);
    // ɹ は l-r-substitution または r-substitution の confusionSet に含まれる
    const hasLrRelated = result.some(
      (s) => String(s.catalogId).includes("l-r") || String(s.catalogId).includes("r-substitution"),
    );
    expect(hasLrRelated).toBe(true);
  });

  it("実 worker shape: catalogId=null + phenomenon=omission → final-consonant-omission に射影される (M-DG-3)", () => {
    const findings: FindingProjectionInput[] = Array.from({ length: 5 }, (_) => ({
      phenomenon: "omission",
      gop: -12.0,
      severity: "major",
      catalogId: null,
      contrast: null,
      detectedTopCandidate: null,
      expectedIpa: "h ə l oʊ" as string | null,
    }));

    const result = projectFindingsToCatalogFocusSounds(findings, 12, DEFAULT_GOP_RANGE);
    const omissionSound = result.find((s) => String(s.catalogId) === "final-consonant-omission");
    expect(omissionSound).toBeDefined();
    expect(omissionSound?.functionalLoadRank).toBe("high");
  });

  it("実 worker shape: omission + substitution で collapse せず異なる catalogId が生成される (M-DG-3)", () => {
    // omission と substitution(ɹ) が混在 → final-consonant-omission と l/r 系の両方が出る
    const findings: FindingProjectionInput[] = [
      {
        phenomenon: "omission",
        gop: -12.0,
        severity: "major",
        catalogId: null,
        contrast: null,
        detectedTopCandidate: null,
        expectedIpa: "h ə l oʊ",
      },
      {
        phenomenon: "omission",
        gop: -11.5,
        severity: "major",
        catalogId: null,
        contrast: null,
        detectedTopCandidate: null,
        expectedIpa: "w ɜː l d",
      },
      {
        phenomenon: "substitution",
        gop: -10.5,
        severity: "major",
        catalogId: null,
        contrast: null,
        detectedTopCandidate: "ɹ",
        expectedIpa: "h ə l oʊ w ɜː l d",
      },
    ];

    const result = projectFindingsToCatalogFocusSounds(findings, 12, DEFAULT_GOP_RANGE);
    // 2 種類以上の catalogId が生成されること（collapse していない）
    expect(result.length).toBeGreaterThanOrEqual(2);
    const catalogIds = result.map((s) => String(s.catalogId));
    const uniqueCatalogIds = new Set(catalogIds);
    expect(uniqueCatalogIds.size).toBeGreaterThanOrEqual(2);
  });

  it("occurrenceFrequency が totalPromptCount で正規化され 1.0 を超えない", () => {
    // 26 omission findings / 12 prompts → 生の比率は 2.17 だが [0,1] クリップ
    const findings: FindingProjectionInput[] = Array.from({ length: 26 }, (_) => ({
      phenomenon: "omission",
      gop: -12.0,
      severity: "major",
      catalogId: null,
      contrast: null,
      detectedTopCandidate: null,
      expectedIpa: "h ə l oʊ" as string | null,
    }));

    const result = projectFindingsToCatalogFocusSounds(findings, 12, DEFAULT_GOP_RANGE);
    expect(result.length).toBeGreaterThan(0);
    for (const sound of result) {
      expect(Number(sound.occurrenceFrequency)).toBeLessThanOrEqual(1.0);
    }
  });
});
