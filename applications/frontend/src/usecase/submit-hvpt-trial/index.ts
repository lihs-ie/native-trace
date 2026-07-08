/**
 * SubmitHvptTrial UseCase — HVPT 識別試行を記録する (REQ-122 / ORPHAN-5)
 *
 * 設計の正: docs/specs/training-screen.md (M-TR-6, サブ(3b))
 *          docs/03-detailed-design/domain.md §14 (DD-203/265)
 *          adr/007-training-context-bounded-context.md (識別子のみ参照)
 *
 * 学習者の識別応答（どの語に聞こえたか）を受け、正解ラベルと照合して
 * correct を導出し（foundation recordHvptTrial）、HvptTrial を永続化する。
 * ORPHAN-5: HvptTrial.save を usecase から呼び出すことで ORPHAN 解消。
 *
 * 即時フィードバック（正誤 + 正解音再生用の刺激 WAV Base64）を返す。
 * 正解音は submit 時に渡された correctStimulusWavBase64 を使う（再 fetch 不要）。
 *
 * LLM 呼び出しなし（ADR-007）。採点は recordHvptTrial の純ロジック。
 */

import { type ResultAsync, errAsync, okAsync } from "neverthrow";
import { type DomainError, validationFailed } from "../../domain/shared";
import {
  type TrainingSessionIdentifier,
  type HvptTrialIdentifier,
  type StimulusIdentifier,
  type PhonemeContrast,
  createHvptTrialIdentifier,
  createTrainingSessionIdentifier,
  createStimulusIdentifier,
  createPhonemeContrast,
  createResponseLabel,
  recordHvptTrial,
} from "../../domain/training";
import { type TrainingSessionRepository } from "../port/training-session-repository";
import { type HvptTrialRepository } from "../port/hvpt-trial-repository";
import { type EntropyProvider } from "../port/entropy-provider";
import { type Clock } from "../port/clock";

// ---- Input ----

export type SubmitHvptTrialInput = Readonly<{
  /** 対象 TrainingSession 識別子 */
  trainingSessionIdentifier: string;
  /** 提示された刺激の識別子 */
  stimulusIdentifier: string;
  /**
   * 正解ラベル（start-hvpt-session が返した HvptStimulusWithChoices.correctLabel）。
   * type: "spelling" | "keyword" | "ipa"
   */
  correctLabelType: string;
  correctLabelValue: string;
  /**
   * 学習者の応答ラベル（選んだ選択肢）。
   * type: "spelling" | "keyword" | "ipa"
   */
  responseLabelType: string;
  responseLabelValue: string;
  /** 反応時間（ミリ秒） */
  reactionTimeMilliseconds: number;
  /** 試行提示時刻 (ISO 8601 文字列) */
  presentedAt: string;
  /**
   * 正解刺激の WAV Base64（フィードバック用正解音再生）。
   * null の場合は正解音再生なし。
   */
  correctStimulusWavBase64: string | null;
}>;

// ---- Output ----

export type SubmitHvptTrialOutput = Readonly<{
  hvptTrialIdentifier: string;
  correct: boolean;
  correctLabel: Readonly<{ type: string; value: string }>;
  /** 正解音再生用 WAV Base64（input の correctStimulusWavBase64 を返す） */
  correctStimulusWavBase64: string | null;
}>;

// ---- Dependencies ----

export type SubmitHvptTrialDependencies = Readonly<{
  trainingSessionRepository: TrainingSessionRepository;
  hvptTrialRepository: HvptTrialRepository;
  entropyProvider: EntropyProvider;
  clock: Clock;
}>;

// ---- Implementation ----

export const createSubmitHvptTrial =
  (dependencies: SubmitHvptTrialDependencies) =>
  (input: SubmitHvptTrialInput): ResultAsync<SubmitHvptTrialOutput, DomainError> => {
    const trainingSessionIdentifier = createTrainingSessionIdentifier(
      input.trainingSessionIdentifier,
    ) as TrainingSessionIdentifier;
    if (!trainingSessionIdentifier) {
      return errAsync(
        validationFailed("trainingSessionIdentifier", "不正な訓練セッション識別子です"),
      );
    }

    const stimulusIdentifier = createStimulusIdentifier(
      input.stimulusIdentifier,
    ) as StimulusIdentifier;
    if (!stimulusIdentifier) {
      return errAsync(validationFailed("stimulusIdentifier", "不正な刺激識別子です"));
    }

    // correctLabel / response を ResponseLabel に変換する
    const correctLabelResult = createResponseLabel(input.correctLabelType, input.correctLabelValue);
    if (correctLabelResult.isErr()) {
      return errAsync(correctLabelResult.error);
    }

    const responseLabelResult = createResponseLabel(
      input.responseLabelType,
      input.responseLabelValue,
    );
    if (responseLabelResult.isErr()) {
      return errAsync(responseLabelResult.error);
    }

    const presentedAt = new Date(input.presentedAt);
    if (isNaN(presentedAt.getTime())) {
      return errAsync(
        validationFailed("presentedAt", "presentedAt は ISO 8601 形式で指定してください"),
      );
    }

    // 1. TrainingSession の存在確認 + in_progress チェック
    return dependencies.trainingSessionRepository
      .find(trainingSessionIdentifier)
      .andThen((trainingSession) => {
        if (trainingSession.type !== "in_progress") {
          return errAsync(
            validationFailed(
              "trainingSession",
              "HVPT 試行は in_progress 状態の訓練セッションにのみ記録できます",
            ),
          );
        }

        const contrast = createPhonemeContrast(String(trainingSession.contrast)) as PhonemeContrast;
        if (!contrast) {
          return errAsync(validationFailed("contrast", "訓練セッションの対立文字列が不正です"));
        }

        // 2. HvptTrial 識別子を生成する
        const trialIdentifierRaw = dependencies.entropyProvider.generateUlid();
        const trialIdentifier = createHvptTrialIdentifier(
          trialIdentifierRaw,
        ) as HvptTrialIdentifier;
        if (!trialIdentifier) {
          return errAsync(
            validationFailed("trialIdentifier", "HvptTrial 識別子の生成に失敗しました"),
          );
        }

        // 3. recordHvptTrial (domain) で正誤を導出する（DD-265）
        // 不変条件 1: correct は correctLabel と response の一致から導出（DD-203）
        const recordResult = recordHvptTrial({
          identifier: trialIdentifier,
          trainingSession: trainingSessionIdentifier,
          stimulus: stimulusIdentifier,
          contrast,
          correctLabel: correctLabelResult.value,
          response: responseLabelResult.value,
          reactionTimeMilliseconds: input.reactionTimeMilliseconds,
          presentedAt,
        });

        if (recordResult.isErr()) {
          return errAsync(recordResult.error);
        }

        const { trial } = recordResult.value;

        // 4. HvptTrial を永続化する（ORPHAN-5 解消: save まで確実に配線）
        return dependencies.hvptTrialRepository.save(trial).andThen(() =>
          okAsync({
            hvptTrialIdentifier: String(trial.identifier),
            correct: trial.correct,
            correctLabel: {
              type: trial.correctLabel.type,
              value: trial.correctLabel.value,
            },
            correctStimulusWavBase64: input.correctStimulusWavBase64,
          }),
        );
      });
  };
