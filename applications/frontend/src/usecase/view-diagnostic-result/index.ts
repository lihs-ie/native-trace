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

// ---- Stage 判定 ----

/**
 * DiagnosticStage — 二段階ゴールモデル (docs/01-requirements §2)
 * Stage I: 明瞭性重視（分節・母音挿入・高 FL 対立が主課題）
 * Stage II: ネイティブ性重視（韻律・connected speech が主課題）
 * 判定は overall スコアを閾値として分類する（MVP 簡易版）。
 */
export type DiagnosticStage = "stageI" | "stageII";

const deriveStage = (overallScore: number): DiagnosticStage =>
  overallScore >= 75 ? "stageII" : "stageI";

// ---- CEFR 下位尺度導出 ----

/**
 * scoreToCefrBand — スコア (0-100) を CEFR 音韻統制バンドに変換する。
 * Haskell worker の buildCefrScore と同一ロジック（M-114 §8.3.4 準拠）。
 * 決定論的: スコアのみから導出、固定値禁止。
 */
const scoreToCefrBand = (score: number): string => {
  if (score >= 90) return "C2";
  if (score >= 80) return "C1";
  if (score >= 70) return "B2";
  if (score >= 60) return "B1+";
  if (score >= 50) return "B1";
  if (score >= 40) return "A2+";
  if (score >= 30) return "A2";
  return "A1";
};

/**
 * deriveCefrSubscalesFromScores — AssessmentResult の scores から CEFR 3 下位尺度を導出する。
 * worker が CEFR フィールドを返している場合はそれを使用し、null の場合（旧データ互換）は
 * overall/pronunciation/prosody スコアから決定論的に算出する（固定値禁止 M-DG-5）。
 */
const deriveCefrSubscalesFromScores = (
  scores: import("../../domain/assessment-result").ScoreSet,
): Readonly<{
  overall: Readonly<{ score: number; band: string }> | null;
  segmental: Readonly<{ score: number; band: string }> | null;
  prosodic: Readonly<{ score: number; band: string }> | null;
}> => {
  // worker から CEFR が提供されている場合は優先使用
  const overallCefr =
    scores.cefrOverall ??
    (() => {
      const score = Number(scores.overall);
      return { score, band: scoreToCefrBand(score) };
    })();

  const segmentalCefr =
    scores.cefrSegmental ??
    (() => {
      // segmental は pronunciation スコアに対応
      const score = Number(scores.pronunciation);
      return { score, band: scoreToCefrBand(score) };
    })();

  const prosodicCefr =
    scores.cefrProsodic ??
    (() => {
      // prosodic は prosody スコアに対応
      const score = Number(scores.prosody);
      return { score, band: scoreToCefrBand(score) };
    })();

  return {
    overall: overallCefr,
    segmental: segmentalCefr,
    prosodic: prosodicCefr,
  };
};

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

export type ViewDiagnosticResultExecutor = ReturnType<typeof createViewDiagnosticResult>;
