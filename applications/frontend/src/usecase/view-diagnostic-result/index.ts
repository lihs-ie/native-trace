/**
 * ViewDiagnosticResult UseCase
 *
 * 設計の正: docs/specs/diagnostic-screen.md (M-DG-3/4/5)
 *          docs/03-detailed-design/domain.md §14 (DD-200/201/262)
 *
 * 診断完了セッションの結果（Stage / CEFR 下位尺度初期値 / focus sounds）を組み立てて返す。
 * ADR-010: focus 導出は UseCase 層で実行済み（WeaknessProfile から読む）。LLM 呼び出しなし。
 */

import { type ResultAsync, errAsync } from "neverthrow";
import { type DomainError, validationFailed } from "../../domain/shared";
import {
  type DiagnosticSessionIdentifier,
  createDiagnosticSessionIdentifier,
} from "../../domain/training";
import { type DiagnosticSessionRepository } from "../port/diagnostic-session-repository";
import { type WeaknessProfileRepository } from "../port/weakness-profile-repository";
import { type AssessmentResultRepository } from "../port/assessment-result-repository";
import { deriveCefrSubscalesFromScores } from "../shared/cefr-subscale-derivation";

// ---- Stage 判定 ----

/**
 * DiagnosticStage — 二段階ゴールモデル (docs/01-requirements §2)
 * Stage I: 明瞭性重視（分節・母音挿入・高 FL 対立が主課題）
 * Stage II: ネイティブ性重視（韻律・connected speech が主課題）
 * 判定は overall スコアを閾値として分類する（MVP 簡易版）。
 */
export type DiagnosticStage = "stageI" | "stageII";

/** Stage II（ネイティブ性重視）へ切り替わる overall スコアの閾値。 */
const STAGE_II_OVERALL_THRESHOLD = 75;

const deriveStage = (overallScore: number): DiagnosticStage =>
  overallScore >= STAGE_II_OVERALL_THRESHOLD ? "stageII" : "stageI";

// ---- Output ----

export type FocusSoundResultDto = Readonly<{
  contrast: string;
  catalogId: string;
  functionalLoadRank: string;
  occurrenceFrequency: number;
  mastery: number;
  priority: number;
}>;

export type DiagnosticResultOutput = Readonly<{
  diagnosticSessionIdentifier: string;
  weaknessProfileIdentifier: string;
  stage: DiagnosticStage;
  /** CEFR 下位尺度初期値。assessment result から取得できる場合のみ設定。 */
  cefrSubscales: Readonly<{
    overall: Readonly<{ score: number; band: string }> | null;
    segmental: Readonly<{ score: number; band: string }> | null;
    prosodic: Readonly<{ score: number; band: string }> | null;
  }>;
  focusSounds: ReadonlyArray<FocusSoundResultDto>;
  completedAt: string;
}>;

// ---- Dependencies ----

export type ViewDiagnosticResultDependencies = Readonly<{
  diagnosticSessionRepository: DiagnosticSessionRepository;
  weaknessProfileRepository: WeaknessProfileRepository;
  assessmentResultRepository: AssessmentResultRepository;
}>;

// ---- Implementation ----

export type ViewDiagnosticResultInput = Readonly<{
  diagnosticSessionIdentifier: string;
}>;

export const createViewDiagnosticResult =
  (dependencies: ViewDiagnosticResultDependencies) =>
  (input: ViewDiagnosticResultInput): ResultAsync<DiagnosticResultOutput, DomainError> => {
    const sessionIdentifier = createDiagnosticSessionIdentifier(
      input.diagnosticSessionIdentifier,
    ) as DiagnosticSessionIdentifier;
    if (!sessionIdentifier) {
      return errAsync(
        validationFailed("diagnosticSessionIdentifier", "不正な診断セッション識別子です"),
      );
    }

    return dependencies.diagnosticSessionRepository.find(sessionIdentifier).andThen((session) => {
      if (session.type !== "completed") {
        return errAsync(
          validationFailed(
            "session",
            "診断セッションは pending 状態です。診断を完了してから結果を取得してください。",
          ),
        );
      }

      return dependencies.weaknessProfileRepository
        .find(session.weaknessProfile)
        .andThen((weaknessProfile) => {
          // AssessmentResult から CEFR 下位尺度・overall score を取得
          // 最初の AssessmentResult を使用する（MVP：最小単純化）
          const firstResultIdentifier = session.assessmentResults[0];

          return dependencies.assessmentResultRepository
            .find(firstResultIdentifier)
            .map((assessmentResult) => {
              const overallScore = Number(assessmentResult.scores.overall);
              const stage = deriveStage(overallScore);

              const focusSounds: FocusSoundResultDto[] = weaknessProfile.focusSounds.map(
                (sound) => ({
                  contrast: String(sound.contrast),
                  catalogId: String(sound.catalogId),
                  functionalLoadRank: sound.functionalLoadRank,
                  occurrenceFrequency: Number(sound.occurrenceFrequency),
                  mastery: Number(sound.mastery),
                  priority: Number(sound.priority),
                }),
              );

              const cefrSubscales = deriveCefrSubscalesFromScores(assessmentResult.scores);

              return {
                diagnosticSessionIdentifier: String(session.identifier),
                weaknessProfileIdentifier: String(weaknessProfile.identifier),
                stage,
                cefrSubscales,
                focusSounds,
                completedAt: session.completedAt.toISOString(),
              } satisfies DiagnosticResultOutput;
            });
        });
    });
  };
