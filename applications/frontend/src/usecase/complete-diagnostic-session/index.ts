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
import {
  type DomainError,
  type NonEmptyList,
  validationFailed,
  createNonEmptyList,
} from "../../domain/shared";
import {
  type DiagnosticSessionIdentifier,
  type WeaknessProfileIdentifier,
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
import { type AssessmentResultIdentifier } from "../../domain/assessment-result";
import { getAllCatalogEntries } from "../../domain/error-catalog";
import { type DiagnosticSessionRepository } from "../port/diagnostic-session-repository";
import { type WeaknessProfileRepository } from "../port/weakness-profile-repository";
import { type AssessmentResultRepository } from "../port/assessment-result-repository";
import { type EntropyProvider } from "../port/entropy-provider";
import { type Clock } from "../port/clock";

// ---- Input ----

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
}>;

// ---- Output ----

export type CompleteDiagnosticSessionOutput = Readonly<{
  diagnosticSessionIdentifier: string;
  weaknessProfileIdentifier: string;
  focusSoundCount: number;
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
 * 各 finding の catalogId（worker が設定済み）または phenomenon/contrast を使い、
 * カタログエントリを特定する。
 * OQ-5 初回初期化規則:
 *   - occurrenceFrequency = 診断内の観測率（検出数 / 診断文数 に相当する相対頻度）
 *   - mastery = 1 − (GOP スコアの平均を0〜1に正規化) で推定
 *     （GOP未提供の場合は severity ベースで推定: critical=0.1, major=0.3, minor=0.6, suggestion=0.8）
 */
type FindingProjectionInput = Readonly<{
  phenomenon: string | null;
  gop: number | null;
  severity: string;
  catalogId: string | null;
  contrast: string | null;
}>;

type CatalogProjectionAccumulator = Map<
  string, // catalogId
  { occurrenceCount: number; gopSum: number; gopCount: number; severity: string }
>;

const estimateMasteryFromGopAndSeverity = (
  gopSum: number,
  gopCount: number,
  severity: string,
): number => {
  if (gopCount > 0) {
    // GOP は 0〜1 のスコアで、低いほど誤りが深刻。mastery = GOP 平均を直接使用。
    return gopSum / gopCount;
  }
  // GOP 未提供: severity から推定
  const severityToMastery: Record<string, number> = {
    critical: 0.1,
    major: 0.3,
    minor: 0.6,
    suggestion: 0.8,
  };
  return severityToMastery[severity] ?? 0.5;
};

export const projectFindingsToCatalogFocusSounds = (
  findings: ReadonlyArray<FindingProjectionInput>,
  totalPromptCount: number,
): ReadonlyArray<Omit<FocusSound, "priority">> => {
  const catalog = getAllCatalogEntries();

  // catalogId → accumulator
  const accumulator: CatalogProjectionAccumulator = new Map();

  for (const finding of findings) {
    // catalogId が worker から直接提供されている場合はそれを優先
    let resolvedCatalogId: string | null = finding.catalogId;

    if (!resolvedCatalogId && finding.contrast) {
      // contrast 文字列でカタログエントリを探す
      const entry = catalog.find(
        (e) =>
          e.contrast !== null &&
          (e.contrast === finding.contrast ||
            e.confusionSet.some((cs) => cs === finding.contrast)),
      );
      resolvedCatalogId = entry?.id ?? null;
    }

    if (!resolvedCatalogId && finding.phenomenon) {
      // phenomenon でカタログエントリを探す
      const entry = catalog.find(
        (e) =>
          e.id.includes(finding.phenomenon!.toLowerCase()) ||
          e.targetPhoneme.toLowerCase() === finding.phenomenon!.toLowerCase(),
      );
      resolvedCatalogId = entry?.id ?? null;
    }

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

    // occurrenceFrequency: 観測数 / 診断文数（相対頻度）
    const rawOccurrenceFrequency = totalPromptCount > 0 ? acc.occurrenceCount / totalPromptCount : 0;
    const occurrenceFrequencyResult = createOccurrenceFrequency(rawOccurrenceFrequency);
    if (occurrenceFrequencyResult.isErr()) continue;

    // mastery: GOP or severity から推定 (OQ-5)
    const rawMastery = estimateMasteryFromGopAndSeverity(
      acc.gopSum,
      acc.gopCount,
      acc.severity,
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
    const sessionIdentifier = createDiagnosticSessionIdentifier(
      input.diagnosticSessionIdentifier,
    ) as DiagnosticSessionIdentifier;
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

    const nonEmptyAssessmentResults = createNonEmptyList(
      assessmentResultIdentifiers,
    ) as NonEmptyList<AssessmentResultIdentifier>;

    // 1. DiagnosticSession を取得
    return dependencies.diagnosticSessionRepository
      .find(sessionIdentifier)
      .andThen((session) => {
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
            const allFindings = assessmentResults.flatMap((result) =>
              result.findings.map((finding) => ({
                phenomenon: finding.phenomenon,
                gop: finding.gop,
                severity: finding.severity,
                catalogId: finding.catalogId,
                contrast: finding.catalogId ?? null,
              })),
            );

            const promptCount = session.promptSet.prompts.length;
            const focusSoundCandidates = projectFindingsToCatalogFocusSounds(
              allFindings,
              promptCount,
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
            const profileIdentifierRaw = dependencies.entropyProvider.generateUlid();
            const profileIdentifier = createWeaknessProfileIdentifier(
              profileIdentifierRaw,
            ) as WeaknessProfileIdentifier;

            const now = dependencies.clock.now();

            const initResult = initializeWeaknessProfile(
              profileIdentifier,
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
              .andThen(() =>
                dependencies.diagnosticSessionRepository.persist(completedSession),
              )
              .map(() => ({
                diagnosticSessionIdentifier: String(completedSession.identifier),
                weaknessProfileIdentifier: String(weaknessProfile.identifier),
                focusSoundCount: weaknessProfile.focusSounds.length,
              }));
          });
      });
  };

export type CompleteDiagnosticSessionExecutor = ReturnType<
  typeof createCompleteDiagnosticSession
>;
