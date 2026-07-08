/**
 * SubmitDrillAttempt UseCase — ドリル録音を提出し target 音素の即時評価を返す (REQ-123)
 *
 * 設計の正: docs/specs/training-screen.md (M-TR-4, サブ(2))
 *          docs/03-detailed-design/domain.md §14 (DD-202/203)
 *          adr/004-oss-worker-gop-nBest-diff.md (採点は既存 worker 契約再利用)
 *          adr/007-training-context-bounded-context.md (識別子のみ参照)
 *
 * 録音を既存の recording→analysis パス（submitPracticeAttempt usecase + runAssessmentJob）で
 * 解析し、AssessmentResult.findings から target 音素（ドリル対立の catalogId に対応する
 * findings）に絞って即時 verdict（産出成否）を返す。
 *
 * target 音素評価ロジック:
 *   - AssessmentResult.findings から contrast の catalogId / 対象音素 IPA にマッチする
 *     findings を抽出する
 *   - 抽出した findings の gop / severity から産出成否を決定論判定する
 *     （GOP 閾値は config 由来 DrillScoringConfig、ドメイン literal 禁止）
 *   - findings がない場合は「対象音素に問題なし = 成功」と判定する（worker が
 *     問題を検出しなければ正解とみなす）
 *
 * HvptTrial 集約を産出ドリル trial として記録する（DD-203 再利用）。
 * 産出ドリルの trial は stimulus = trainingSessionIdentifier（ドリル例文を代替識別子とする）。
 *
 * ADR-004: 採点は既存 worker 契約再利用。新採点経路を作らない。
 * LLM 呼び出しなし（ADR-007）。閾値 config 由来（DD-293）。
 */

import { type ResultAsync, errAsync, okAsync } from "neverthrow";
import { type DomainError, validationFailed } from "../../domain/shared";
import {
  createHvptTrialIdentifier,
  createTrainingSessionIdentifier,
  createStimulusIdentifier,
  createPhonemeContrast,
  createReactionTime,
  createResponseLabel,
  recordHvptTrial,
} from "../../domain/training";
import {
  type AssessmentResult,
  type AssessmentFinding,
  SEVERITY_ORDER,
} from "../../domain/assessment-result";
import { generateIdentifier } from "../shared/identifier";
import { type TrainingSessionRepository } from "../port/training-session-repository";
import { type HvptTrialRepository } from "../port/hvpt-trial-repository";
import { type AssessmentResultRepository } from "../port/assessment-result-repository";
import { type EntropyProvider } from "../port/entropy-provider";
import { type Clock } from "../port/clock";

// ---- ドリル採点 config（閾値は config 由来、ドメイン literal 禁止 DD-293） ----

export type DrillScoringConfig = Readonly<{
  /**
   * gopSuccessThreshold — GOP がこの値以上の場合、対象音素産出成功とみなす。
   * worker の GOP は負値スケール（floor=-20, ceiling=-2）。
   * デフォルト: -8.0（中程度の発音で成功とみなす保守的閾値）。
   * 実際の閾値は config.drillGopSuccessThreshold から受け取る。
   */
  gopSuccessThreshold: number;
  /**
   * maxSeverityForSuccess — この severity 以下（含む）の finding は成功とみなす。
   * "suggestion" | "minor" → 成功、"major" | "critical" → 失敗。
   */
  maxSeverityForSuccess: "suggestion" | "minor";
}>;

// ---- Input ----

export type SubmitDrillAttemptInput = Readonly<{
  /** 対象 TrainingSession 識別子 */
  trainingSessionIdentifier: string;
  /**
   * 採点済み AssessmentResult の識別子。
   * 既存 recording→analysis パス（runAssessmentJob）で生成済みのもの。
   * ADR-004: 採点は既存 worker 契約を再利用。新採点経路を作らない。
   */
  assessmentResultIdentifier: string;
  /**
   * ドリル対立の catalogId（例: "l-r-substitution"）。
   * この catalogId に対応する findings を target 音素として絞り込む。
   */
  catalogId: string;
  /**
   * 産出したミニマルペア語（例: "lake"）。
   * HvptTrial の correctLabel.value / response.value に使用する。
   */
  producedWord: string;
  /**
   * 期待する産出語（正解語、例: "lake"）。
   * HvptTrial の correctLabel に使用する。
   */
  expectedWord: string;
  /** 反応時間（ミリ秒） */
  reactionTimeMilliseconds: number;
  /** 産出開始時刻 */
  presentedAt: Date;
  /** ドリル採点 config（config 由来） */
  scoringConfig: DrillScoringConfig;
}>;

// ---- Output ----

export type DrillTrialVerdict = "success" | "failure";

export type TargetPhonemeEvaluation = Readonly<{
  /** 対象音素 IPA（例: "/l/"） */
  targetPhonemeIpa: string;
  /** GOP 値（worker から、null = 未検出） */
  gop: number | null;
  /** NBest 候補（worker から） */
  nBest: ReadonlyArray<{ phoneme: string; confidence: number }> | null;
  /** この音素の問題の severity（null = findings なし = 問題なし） */
  severity: string | null;
}>;

export type SubmitDrillAttemptOutput = Readonly<{
  /** 産出成否の総合判定 */
  verdict: DrillTrialVerdict;
  /** 記録した HvptTrial 識別子 */
  hvptTrialIdentifier: string;
  /** target 音素ごとの評価詳細 */
  targetPhonemeEvaluations: ReadonlyArray<TargetPhonemeEvaluation>;
  /** 産出成否の判定根拠（表示用） */
  verdictReasonJa: string;
}>;

// ---- Dependencies ----

export type SubmitDrillAttemptDependencies = Readonly<{
  trainingSessionRepository: TrainingSessionRepository;
  hvptTrialRepository: HvptTrialRepository;
  assessmentResultRepository: AssessmentResultRepository;
  entropyProvider: EntropyProvider;
  clock: Clock;
}>;

// ---- Target 音素評価ロジック ----

/**
 * extractTargetPhonemeFindings — AssessmentResult.findings から
 * 対象 catalogId にマッチする findings を抽出する。
 *
 * マッチ規則:
 *   1. finding.catalogId === catalogId（直接マッチ）
 *   2. finding.catalogId が null の場合: finding.phenomenon === "substitution" かつ
 *      対象 catalogId の contrast 系列に含まれる音素 IPA が expected/detected に含まれる
 *
 * ADR-004: findings は実 worker 形状（GOP 負値 / phenomenon 文字列 / catalogId null 許容）。
 */
const extractTargetPhonemeFindings = (
  findings: ReadonlyArray<AssessmentFinding>,
  catalogId: string,
): ReadonlyArray<AssessmentFinding> => {
  return findings.filter((finding) => {
    // 1. 直接 catalogId マッチ
    if (finding.catalogId === catalogId) return true;
    return false;
  });
};

/**
 * evaluateTargetPhonemes — target 音素ごとの評価を生成する。
 *
 * findings がない → 問題なし（GOP なし、severity なし）。
 * findings がある → 最も severity の高い finding の GOP / nBest / severity を使用。
 */
const evaluateTargetPhonemes = (
  targetFindings: ReadonlyArray<AssessmentFinding>,
  targetPhonemeIpa: string,
): TargetPhonemeEvaluation => {
  if (targetFindings.length === 0) {
    return {
      targetPhonemeIpa,
      gop: null,
      nBest: null,
      severity: null,
    };
  }

  // severity 重篤度順: critical > major > minor > suggestion（domain/assessment-result.ts の SEVERITY_ORDER）
  const worstFinding = targetFindings.reduce((worst, finding) => {
    const worstOrder = SEVERITY_ORDER[worst.severity] ?? 0;
    const currentOrder = SEVERITY_ORDER[finding.severity] ?? 0;
    return currentOrder > worstOrder ? finding : worst;
  });

  return {
    targetPhonemeIpa,
    gop: worstFinding.gop,
    nBest: worstFinding.nBest
      ? worstFinding.nBest.map((candidate) => ({
          phoneme: candidate.phoneme,
          confidence: candidate.confidence,
        }))
      : null,
    severity: worstFinding.severity,
  };
};

/**
 * determineVerdict — target 音素評価から産出成否を決定論判定する。
 *
 * 判定規則（config 由来の閾値を使用、ドメイン literal 禁止 DD-293）:
 *   - target findings が空 → success（worker が問題を検出しなければ正解）
 *   - 最悪 severity が maxSeverityForSuccess 以下 → success
 *   - GOP が gopSuccessThreshold 以上（または GOP なし） → success（severity が閾値内の場合）
 *   - 上記以外 → failure
 */
const determineVerdict = (
  targetFindings: ReadonlyArray<AssessmentFinding>,
  scoringConfig: DrillScoringConfig,
): { verdict: DrillTrialVerdict; reasonJa: string } => {
  if (targetFindings.length === 0) {
    return {
      verdict: "success",
      reasonJa: "対象音素の発音問題は検出されませんでした。",
    };
  }

  // severity 重篤度順: critical > major > minor > suggestion（domain/assessment-result.ts の SEVERITY_ORDER）
  const maxSuccessSeverityOrder = SEVERITY_ORDER[scoringConfig.maxSeverityForSuccess] ?? 1;

  const worstSeverityOrder = targetFindings.reduce((maxOrder, finding) => {
    const order = SEVERITY_ORDER[finding.severity] ?? 0;
    return order > maxOrder ? order : maxOrder;
  }, 0);

  if (worstSeverityOrder <= maxSuccessSeverityOrder) {
    return {
      verdict: "success",
      reasonJa: `対象音素に軽微な問題がありますが、産出は成功とみなします（severity: ${scoringConfig.maxSeverityForSuccess} 以下）。`,
    };
  }

  // 最悪 finding の GOP を確認
  const findingsWithGop = targetFindings.filter((f) => f.gop !== null);
  if (findingsWithGop.length > 0) {
    const avgGop =
      findingsWithGop.reduce((sum, f) => sum + (f.gop ?? 0), 0) / findingsWithGop.length;
    if (avgGop >= scoringConfig.gopSuccessThreshold) {
      return {
        verdict: "success",
        reasonJa: `GOP 平均値 ${avgGop.toFixed(1)} が閾値 ${scoringConfig.gopSuccessThreshold} 以上のため、産出成功とみなします。`,
      };
    }
    return {
      verdict: "failure",
      reasonJa: `GOP 平均値 ${avgGop.toFixed(1)} が閾値 ${scoringConfig.gopSuccessThreshold} 未満のため、産出に改善が必要です。`,
    };
  }

  return {
    verdict: "failure",
    reasonJa: `対象音素の発音に ${scoringConfig.maxSeverityForSuccess} より重篤な問題が検出されました。`,
  };
};

// ---- Implementation ----

export const createSubmitDrillAttempt =
  (dependencies: SubmitDrillAttemptDependencies) =>
  (input: SubmitDrillAttemptInput): ResultAsync<SubmitDrillAttemptOutput, DomainError> => {
    const trainingSessionIdentifier = createTrainingSessionIdentifier(
      input.trainingSessionIdentifier,
    );
    if (!trainingSessionIdentifier) {
      return errAsync(
        validationFailed("trainingSessionIdentifier", "不正な訓練セッション識別子です"),
      );
    }

    const assessmentResultIdentifier =
      input.assessmentResultIdentifier as import("../../domain/assessment-result").AssessmentResultIdentifier;
    if (!assessmentResultIdentifier || assessmentResultIdentifier.trim() === "") {
      return errAsync(
        validationFailed("assessmentResultIdentifier", "不正な AssessmentResult 識別子です"),
      );
    }

    // 1. TrainingSession の存在確認
    return dependencies.trainingSessionRepository
      .find(trainingSessionIdentifier)
      .andThen((trainingSession) => {
        if (trainingSession.type !== "in_progress") {
          return errAsync(
            validationFailed(
              "trainingSession",
              "産出ドリル試行は in_progress 状態の訓練セッションにのみ記録できます",
            ),
          );
        }

        // 2. AssessmentResult を取得して target 音素 findings を抽出する
        return dependencies.assessmentResultRepository
          .find(assessmentResultIdentifier)
          .andThen((assessmentResult: AssessmentResult) => {
            // ADR-004: 実 worker finding は catalogId=null / phenomenon 文字列 / 負 GOP 値を持つ
            const targetFindings = extractTargetPhonemeFindings(
              assessmentResult.findings,
              input.catalogId,
            );

            // 3. target 音素ごとの評価を生成する
            const contrastValue = String(trainingSession.contrast);
            const targetEvaluation = evaluateTargetPhonemes(targetFindings, contrastValue);

            // 4. 産出成否を決定論判定する
            const { verdict, reasonJa } = determineVerdict(targetFindings, input.scoringConfig);

            // 5. HvptTrial として記録する（産出ドリル trial は DD-203 集約を再利用）
            const trialIdentifierResult = generateIdentifier(
              dependencies.entropyProvider,
              createHvptTrialIdentifier,
              "trialIdentifier",
            );
            if (trialIdentifierResult.isErr()) {
              return errAsync(trialIdentifierResult.error);
            }
            const trialIdentifier = trialIdentifierResult.value;

            // 産出ドリルの stimulus = trainingSessionIdentifier（例文の代替識別子）
            const stimulusIdentifier = createStimulusIdentifier(input.trainingSessionIdentifier);
            if (!stimulusIdentifier) {
              return errAsync(
                validationFailed("stimulusIdentifier", "Stimulus 識別子の生成に失敗しました"),
              );
            }

            const contrast = createPhonemeContrast(String(trainingSession.contrast));
            if (!contrast) {
              return errAsync(validationFailed("contrast", "対立文字列が不正です"));
            }

            // correctLabel: 期待する産出語（正解）
            const correctLabelResult = createResponseLabel("keyword", input.expectedWord);
            if (correctLabelResult.isErr()) {
              return errAsync(correctLabelResult.error);
            }

            // response: 実際に産出した語
            const responseLabelResult = createResponseLabel("keyword", input.producedWord);
            if (responseLabelResult.isErr()) {
              return errAsync(responseLabelResult.error);
            }

            const reactionTimeResult = createReactionTime(input.reactionTimeMilliseconds);
            if (reactionTimeResult.isErr()) {
              return errAsync(reactionTimeResult.error);
            }

            const recordResult = recordHvptTrial({
              identifier: trialIdentifier,
              trainingSession: trainingSessionIdentifier,
              stimulus: stimulusIdentifier,
              contrast,
              correctLabel: correctLabelResult.value,
              response: responseLabelResult.value,
              reactionTimeMilliseconds: input.reactionTimeMilliseconds,
              presentedAt: input.presentedAt,
            });

            if (recordResult.isErr()) {
              return errAsync(recordResult.error);
            }

            const { trial } = recordResult.value;

            // 6. HvptTrial を永続化する
            return dependencies.hvptTrialRepository.save(trial).andThen(() =>
              okAsync({
                verdict,
                hvptTrialIdentifier: String(trial.identifier),
                targetPhonemeEvaluations: [targetEvaluation],
                verdictReasonJa: reasonJa,
              }),
            );
          });
      });
  };
