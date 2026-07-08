/**
 * CompleteDiagnosticSession UseCase
 *
 * 設計の正: docs/specs/diagnostic-screen.md (M-DG-3/4)
 *          docs/03-detailed-design/domain.md §14 (DD-260/261/262/293)
 *          adr/007-training-context-bounded-context.md (識別子のみ参照)
 *          adr/010-diagnostic-weakness-profile-focus-derivation.md
 *
 * 診断 findings を japanese-l1-catalog.json の confusionSet に射影し、
 * initializeWeaknessProfile (三項式・config 重み注入) で WeaknessProfile を初期生成・永続化する。
 * PendingDiagnosticSession → CompletedDiagnosticSession 遷移を行う。
 *
 * ADR-004: 採点は既存 worker 契約を再利用。新採点経路を作らない。
 * ADR-007: AssessmentResult は識別子のみで参照。集約本体は取得して射影後に識別子として記録。
 * ADR-010: focus 導出は UseCase 層。LLM 呼び出しなし。
 */

import { type ResultAsync, errAsync, okAsync } from "neverthrow";
import { type DomainError, validationFailed, createNonEmptyList } from "../../domain/shared";
import {
  type WeaknessProfile,
  type LearnerIdentifier,
  type FocusSound,
  type PriorityWeights,
  createDiagnosticSessionIdentifier,
  createWeaknessProfileIdentifier,
  createOccurrenceFrequency,
  createMastery0To1,
  createPhonemeContrast,
  createCatalogId,
  completeDiagnosticSession,
  initializeWeaknessProfile,
} from "../../domain/training";
import {
  type AssessmentResult,
  type AssessmentResultIdentifier,
} from "../../domain/assessment-result";
import { getAllCatalogEntries } from "../../domain/error-catalog";
import { canonicalizePhoneme } from "../../domain/error-catalog/phoneme-canonicalization";
import { generateIdentifier } from "../shared/identifier";
import { type DiagnosticSessionRepository } from "../port/diagnostic-session-repository";
import { type WeaknessProfileRepository } from "../port/weakness-profile-repository";
import { type AssessmentResultRepository } from "../port/assessment-result-repository";
import { type EntropyProvider } from "../port/entropy-provider";
import { type Clock } from "../port/clock";

// ---- Constants ----

/**
 * SEVERITY_MASTERY_ESTIMATE — GOP 未提供時に severity から mastery を推定するための対応表。
 * UNKNOWN_SEVERITY_MASTERY — 未知の severity 文字列に対するフォールバック値。
 */
const SEVERITY_MASTERY_ESTIMATE: Record<string, number> = {
  critical: 0.1,
  major: 0.3,
  minor: 0.6,
  suggestion: 0.8,
};
const UNKNOWN_SEVERITY_MASTERY = 0.5;

/**
 * PHENOMENON_TO_CATALOG_ENTRY — phenomenon → catalogId 直接マップ
 * （omission, epenthesis, lexicalStress, weakForm 等）。
 *
 * 注意（insertion）: "insertion" は意図的に japanese-l1-catalog.json に対応エントリを持たない
 * プレースホルダー値。projectFindingsToCatalogFocusSounds 側で catalog.find が見つからず
 * 静かに drop される（D3 ADR-017: insertion phenomenon は epenthesis カタログに混入しない、
 * という既存テストが this behavior を担保している）。export するのはテストで
 * 「map の値が catalog id として解決可能」を assert するため（カタログ改名の検知網）。
 */
export const PHENOMENON_TO_CATALOG_ENTRY: Record<string, string> = {
  omission: "final-consonant-omission",
  epenthesis: "epenthesis",
  insertion: "insertion",
  lexicalStress: "lexical-stress-error",
  weakForm: "weak-form-realization",
  reduction: "rhythm-npvi",
  linking: "connected-speech-linking",
};

// ---- Input ----

/**
 * GopNormalizationRange — GOP 値を mastery [0,1] に正規化する際のレンジ。
 * Haskell worker の gopFloor/gopCeiling に対応。config から受け取り、ドメインに literal を埋め込まない (DD-293)。
 * floor 以下 → mastery 0、ceiling 以上 → mastery 1 に線形クリップ。
 */
export type GopNormalizationRange = Readonly<{
  floor: number;
  ceiling: number;
}>;

export type CompleteDiagnosticSessionInput = Readonly<{
  /** 完了する診断セッションの識別子文字列 */
  diagnosticSessionIdentifier: string;
  /**
   * 診断で生成された AssessmentResult の識別子群。
   * 既存 recording → analysis パス (runAssessmentJob) で生成済みのもの。
   * ADR-004: 採点は既存 worker 契約を再利用。
   */
  assessmentResultIdentifiers: ReadonlyArray<string>;
  /** config 由来の三項式重み (DD-293: ドメインに literal 埋め込み禁止) */
  priorityWeights: PriorityWeights;
  /** config 由来の GOP 正規化レンジ (DD-293: ドメインに literal 埋め込み禁止) */
  gopNormalizationRange: GopNormalizationRange;
}>;

// ---- Output ----

export type CompleteDiagnosticSessionOutput = Readonly<{
  diagnosticSessionIdentifier: string;
  weaknessProfileIdentifier: string;
  focusSoundCount: number;
  /**
   * 完了処理で生成された WeaknessProfile オブジェクト。
   * 呼び出し側 (completion route) が CaptureProgressSnapshot usecase に渡すために返す。
   * M-PG-2: diagnostic 完了時に baseline ProgressSnapshot を生成する。
   */
  weaknessProfile: WeaknessProfile;
  /**
   * 完了処理で使用した AssessmentResult 群。
   * 呼び出し側 (completion route) が CaptureProgressSnapshot usecase に渡すために返す。
   * capture usecase は AssessmentResult.scores から CEFR を導出する。
   */
  assessmentResults: ReadonlyArray<AssessmentResult>;
}>;

// ---- Dependencies ----

export type CompleteDiagnosticSessionDependencies = Readonly<{
  diagnosticSessionRepository: DiagnosticSessionRepository;
  weaknessProfileRepository: WeaknessProfileRepository;
  assessmentResultRepository: AssessmentResultRepository;
  entropyProvider: EntropyProvider;
  clock: Clock;
}>;

// ---- Catalog Projection ----

/**
 * projectFindingsToCatalog — findings を japanese-l1-catalog.json の confusionSet に射影し
 * FocusSound 候補群を生成する (M-DG-3)。
 *
 * 突合優先順位:
 *   1. catalogId が worker から直接提供されている場合はそれを優先
 *   2. substitution: detectedTopCandidate (音素 IPA) を catalog confusionSet と突合
 *      → lookupByConfusion(expectedPhoneme, detectedCandidate) 相当
 *      expectedPhoneme は expected.ipa のスペース区切りで最初の音素トークンを使用
 *   3. phenomenon 直接マップ:
 *      omission     → final-consonant-omission
 *      epenthesis   → epenthesis
 *      lexicalStress → lexical-stress-error
 *      weakForm     → weak-form-realization
 *
 * OQ-5 初回初期化規則:
 *   - occurrenceFrequency = 診断内の観測率（min(検出数 / 診断文数, 1.0) で [0,1] クリップ）
 *   - mastery = GOP 平均を gopNormalizationRange で [0,1] に線形正規化
 *     GOP が gopNormalizationRange.ceiling 以上 → mastery 1.0 (良好)
 *     GOP が gopNormalizationRange.floor 以下  → mastery 0.0 (最悪)
 *     GOP 未提供の場合は severity ベースで推定
 */
export type FindingProjectionInput = Readonly<{
  phenomenon: string | null;
  gop: number | null;
  severity: string;
  catalogId: string | null;
  contrast: string | null;
  /** 実 worker finding の detectedTopCandidate（IPA、音素ごとの最有力検出候補）。 */
  detectedTopCandidate: string | null;
  /** 実 worker finding の expected.ipa（文全体の期待 IPA 系列、スペース区切り）。 */
  expectedIpa: string | null;
}>;

type CatalogProjectionAccumulator = Map<
  string, // catalogId
  { occurrenceCount: number; gopSum: number; gopCount: number; severity: string }
>;

/**
 * normalizeGopToMastery — GOP 値を [0,1] に線形正規化する。
 * floor 以下 → 0、ceiling 以上 → 1。
 * DD-293: 係数はドメインではなく config 由来の gopNormalizationRange で受け取る。
 */
const normalizeGopToMastery = (gop: number, range: GopNormalizationRange): number => {
  if (gop >= range.ceiling) return 1.0;
  if (gop <= range.floor) return 0.0;
  return (gop - range.floor) / (range.ceiling - range.floor);
};

const estimateMasteryFromGopAndSeverity = (
  gopSum: number,
  gopCount: number,
  severity: string,
  gopNormalizationRange: GopNormalizationRange,
): number => {
  if (gopCount > 0) {
    // GOP（負値、floor 〜 ceiling）を [0,1] に線形正規化する。
    // 実 worker は gopFloor=-20, gopCeiling=-2 のスケールを使用。
    const gopAverage = gopSum / gopCount;
    return normalizeGopToMastery(gopAverage, gopNormalizationRange);
  }
  // GOP 未提供: severity から推定
  return SEVERITY_MASTERY_ESTIMATE[severity] ?? UNKNOWN_SEVERITY_MASTERY;
};

// canonicalizePhoneme は domain/error-catalog/phoneme-canonicalization から import（ADR-020 D0）。
// 旧: usecase 層ローカル定義（DD-293: 正規化知識を usecase に置く方針）→ domain 共有モジュールへ昇格。

/**
 * resolveCatalogIdFromIpaAndPhenomenon — IPA 情報と phenomenon から catalog エントリを特定する (M-DG-3)。
 *
 * 突合優先順位:
 *   1. catalogId が直接提供されている場合は優先
 *   2. substitution: detectedTopCandidate を canonical 化して confusionSet と突合
 *      - expectedIpa の各音素トークンを targetPhoneme と照合しつつ detectedTopCandidate を confusionSet に探す
 *      - expectedIpa がない場合は detectedTopCandidate だけで confusionSet 全走査
 *   3. phenomenon 直接マップ（omission → final-consonant-omission 等）
 */
const resolveCatalogIdFromIpaAndPhenomenon = (finding: FindingProjectionInput): string | null => {
  const catalog = getAllCatalogEntries();

  // 1. catalogId が直接提供されている場合は優先
  if (finding.catalogId) return finding.catalogId;

  // 2. substitution: detectedTopCandidate × expected IPA tokens で confusionSet 突合
  if (finding.phenomenon === "substitution" && finding.detectedTopCandidate) {
    const canonicalDetected = canonicalizePhoneme(finding.detectedTopCandidate);

    // expected IPA のスペース区切りトークンを期待音素候補として使う
    const expectedPhonemeTokens = finding.expectedIpa
      ? finding.expectedIpa.split(/\s+/).filter((token) => token.length > 0)
      : [];

    // 各期待音素トークンで confusionSet 突合を試みる
    for (const expectedToken of expectedPhonemeTokens) {
      const canonicalExpected = canonicalizePhoneme(expectedToken);
      const entry = catalog.find((e) => {
        const canonicalTarget = canonicalizePhoneme(e.targetPhoneme);
        return (
          canonicalTarget === canonicalExpected &&
          e.confusionSet.some((cs) => canonicalizePhoneme(cs) === canonicalDetected)
        );
      });
      if (entry) return entry.id;
    }

    // 期待音素が見つからない場合: detectedTopCandidate が confusionSet に含まれるエントリを検索
    const entryByDetected = catalog.find((e) =>
      e.confusionSet.some((cs) => canonicalizePhoneme(cs) === canonicalDetected),
    );
    if (entryByDetected) return entryByDetected.id;
  }

  // 3. phenomenon 直接マップ（omission, epenthesis, lexicalStress, weakForm 等）
  if (finding.phenomenon) {
    const directMapped = PHENOMENON_TO_CATALOG_ENTRY[finding.phenomenon];
    if (directMapped) return directMapped;
  }

  return null;
};

export const projectFindingsToCatalogFocusSounds = (
  findings: ReadonlyArray<FindingProjectionInput>,
  totalPromptCount: number,
  gopNormalizationRange: GopNormalizationRange,
): ReadonlyArray<Omit<FocusSound, "priority">> => {
  const catalog = getAllCatalogEntries();

  // catalogId → accumulator
  const accumulator: CatalogProjectionAccumulator = new Map();

  for (const finding of findings) {
    const resolvedCatalogId = resolveCatalogIdFromIpaAndPhenomenon(finding);
    if (!resolvedCatalogId) continue;

    const existing = accumulator.get(resolvedCatalogId) ?? {
      occurrenceCount: 0,
      gopSum: 0,
      gopCount: 0,
      severity: finding.severity,
    };

    accumulator.set(resolvedCatalogId, {
      occurrenceCount: existing.occurrenceCount + 1,
      gopSum: existing.gopSum + (finding.gop ?? 0),
      gopCount: existing.gopCount + (finding.gop !== null ? 1 : 0),
      severity: existing.severity,
    });
  }

  const result: Omit<FocusSound, "priority">[] = [];

  for (const [catalogEntryId, acc] of accumulator.entries()) {
    const entry = catalog.find((e) => e.id === catalogEntryId);
    if (!entry) continue;

    // occurrenceFrequency: 観測数 / 診断文数（相対頻度）を [0,1] にクリップ
    const rawOccurrenceFrequency =
      totalPromptCount > 0 ? Math.min(1, acc.occurrenceCount / totalPromptCount) : 0;
    const occurrenceFrequencyResult = createOccurrenceFrequency(rawOccurrenceFrequency);
    if (occurrenceFrequencyResult.isErr()) continue;

    // mastery: GOP レンジ正規化 or severity から推定 (OQ-5)
    const rawMastery = estimateMasteryFromGopAndSeverity(
      acc.gopSum,
      acc.gopCount,
      acc.severity,
      gopNormalizationRange,
    );
    const masteryResult = createMastery0To1(Math.min(1, Math.max(0, rawMastery)));
    if (masteryResult.isErr()) continue;

    // contrast: カタログの contrast フィールド、なければ catalogId を使用
    const contrastValue = entry.contrast ?? entry.id;
    const contrast = createPhonemeContrast(contrastValue);
    if (!contrast) continue;

    const catalogIdBranded = createCatalogId(entry.id);
    if (!catalogIdBranded) continue;

    result.push({
      contrast,
      catalogId: catalogIdBranded,
      functionalLoadRank: entry.functionalLoad,
      occurrenceFrequency: occurrenceFrequencyResult.value,
      mastery: masteryResult.value,
    });
  }

  return result;
};

// ---- Implementation ----

export const createCompleteDiagnosticSession =
  (dependencies: CompleteDiagnosticSessionDependencies) =>
  (
    input: CompleteDiagnosticSessionInput,
  ): ResultAsync<CompleteDiagnosticSessionOutput, DomainError> => {
    const sessionIdentifier = createDiagnosticSessionIdentifier(input.diagnosticSessionIdentifier);
    if (!sessionIdentifier) {
      return errAsync(
        validationFailed("diagnosticSessionIdentifier", "不正な診断セッション識別子です"),
      );
    }

    if (input.assessmentResultIdentifiers.length === 0) {
      return errAsync(
        validationFailed(
          "assessmentResultIdentifiers",
          "WeaknessProfile 生成には1件以上の AssessmentResult 識別子が必要です",
        ),
      );
    }

    const assessmentResultIdentifiers = input.assessmentResultIdentifiers.map(
      (id) => id as AssessmentResultIdentifier,
    );

    const nonEmptyAssessmentResults = createNonEmptyList(assessmentResultIdentifiers);
    if (!nonEmptyAssessmentResults) {
      return errAsync(
        validationFailed(
          "assessmentResultIdentifiers",
          "WeaknessProfile 生成には1件以上の AssessmentResult 識別子が必要です",
        ),
      );
    }

    // 1. DiagnosticSession を取得
    return dependencies.diagnosticSessionRepository.find(sessionIdentifier).andThen((session) => {
      if (session.type !== "pending") {
        return errAsync(
          validationFailed("session", "診断セッションは pending 状態でなければ完了できません"),
        );
      }

      // 2. AssessmentResult 群を取得して findings を集約
      const assessmentResultFetches = assessmentResultIdentifiers.map((id) =>
        dependencies.assessmentResultRepository.find(id),
      );

      // sequential AndThen で全件取得
      return assessmentResultFetches
        .reduce(
          (
            accumResultAsync: ResultAsync<
              import("../../domain/assessment-result").AssessmentResult[],
              DomainError
            >,
            fetchAsync,
          ) =>
            accumResultAsync.andThen((accumResults) =>
              fetchAsync.map((result) => [...accumResults, result]),
            ),
          okAsync([] as import("../../domain/assessment-result").AssessmentResult[]),
        )
        .andThen((assessmentResults) => {
          // 3. findings を全 AssessmentResult から収集して catalog 射影
          // ADR-004: 実 worker finding は catalogId=null / detectedTopCandidate / expected.ipa を持つ
          const allFindings = assessmentResults.flatMap((result) =>
            result.findings.map((finding) => ({
              phenomenon: finding.phenomenon,
              gop: finding.gop,
              severity: finding.severity,
              catalogId: finding.catalogId,
              contrast: finding.catalogId ?? null,
              detectedTopCandidate: finding.detectedTopCandidate ?? null,
              expectedIpa: finding.expected?.ipa ?? null,
            })),
          );

          const promptCount = session.promptSet.prompts.length;
          const focusSoundCandidates = projectFindingsToCatalogFocusSounds(
            allFindings,
            promptCount,
            input.gopNormalizationRange,
          );

          if (focusSoundCandidates.length === 0) {
            return errAsync(
              validationFailed(
                "focusSounds",
                "診断結果から focus sounds を生成できませんでした。カタログに射影できる findings がありません。",
              ),
            );
          }

          // 4. WeaknessProfile を初期生成
          const profileIdentifierResult = generateIdentifier(
            dependencies.entropyProvider,
            createWeaknessProfileIdentifier,
            "weaknessProfileIdentifier",
          );
          if (profileIdentifierResult.isErr()) {
            return errAsync(profileIdentifierResult.error);
          }

          const now = dependencies.clock.now();

          const initResult = initializeWeaknessProfile(
            profileIdentifierResult.value,
            session.learner as LearnerIdentifier,
            sessionIdentifier,
            focusSoundCandidates as FocusSound[],
            input.priorityWeights,
            now,
          );

          if (initResult.isErr()) {
            return errAsync(initResult.error);
          }

          const { profile: weaknessProfile } = initResult.value;

          // 5. CompletedDiagnosticSession へ遷移
          const completeResult = completeDiagnosticSession(
            session,
            nonEmptyAssessmentResults,
            weaknessProfile,
            now,
          );

          if (completeResult.isErr()) {
            return errAsync(completeResult.error);
          }

          const { session: completedSession } = completeResult.value;

          // 6. WeaknessProfile 永続化 → DiagnosticSession 永続化（順序を保つ）
          return dependencies.weaknessProfileRepository
            .persist(weaknessProfile)
            .andThen(() => dependencies.diagnosticSessionRepository.persist(completedSession))
            .map(() => ({
              diagnosticSessionIdentifier: String(completedSession.identifier),
              weaknessProfileIdentifier: String(weaknessProfile.identifier),
              focusSoundCount: weaknessProfile.focusSounds.length,
              weaknessProfile,
              assessmentResults,
            }));
        });
    });
  };
