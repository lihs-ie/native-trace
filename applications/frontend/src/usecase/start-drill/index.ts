/**
 * StartDrill UseCase — 産出ドリルセッションを開始する (REQ-123)
 *
 * 設計の正: docs/specs/training-screen.md (M-TR-4, サブ(2))
 *          docs/03-detailed-design/domain.md §14 (DD-202)
 *          adr/007-training-context-bounded-context.md (識別子のみ参照)
 *          adr/011-spacing-scheduler-fixed-interval-mastery-gate.md
 *
 * WeaknessProfile から優先 focus 対立を選び、対応するドリルコンテンツ +
 * TrainingSession(kind=production_drill, InProgress) を生成・永続化する。
 *
 * 対立選択規則:
 *   1. WeaknessProfile.focusSounds を priority 降順に走査する
 *   2. ドリルコンテンツが存在する最初の対立を選択する
 *   3. 全対立にドリルコンテンツがない場合は validationFailed を返す
 *
 * ADR-007: Training Context は WeaknessProfile を識別子のみで参照する。
 *          ドリルコンテンツは DrillContentRepository Port 経由で取得（onion 順守）。
 * LLM 呼び出しなし（ADR-007）。採点経路を作らない（ADR-004）。
 */

import { type ResultAsync, errAsync, okAsync } from "neverthrow";
import { type DomainError, validationFailed } from "../../domain/shared";
import {
  type TrainingSession,
  type TrainingSessionIdentifier,
  type LearnerIdentifier,
  type PhonemeContrast,
  createTrainingSessionIdentifier,
  createLearnerIdentifier,
  createPhonemeContrast,
} from "../../domain/training";
import { type WeaknessProfileRepository } from "../port/weakness-profile-repository";
import { type TrainingSessionRepository } from "../port/training-session-repository";
import { type DrillContentRepository, type DrillContent } from "../port/drill-content-repository";
import { type EntropyProvider } from "../port/entropy-provider";
import { type Clock } from "../port/clock";

// ---- Input ----

export type StartDrillInput = Readonly<{
  /** sentinel LearnerIdentifier (config.diagnosticSentinelLearnerIdentifier) */
  learnerIdentifier: string;
  /**
   * WeaknessProfile 識別子。
   * WeaknessProfile から focus 対立を選択するために使用する。
   */
  weaknessProfileIdentifier: string;
}>;

// ---- Output ----

export type StartDrillOutput = Readonly<{
  trainingSession: TrainingSession;
  /** 選択された対立のドリルコンテンツ */
  drillContent: DrillContent;
  /** 選択された対立文字列 */
  contrast: string;
}>;

// ---- Dependencies ----

export type StartDrillDependencies = Readonly<{
  weaknessProfileRepository: WeaknessProfileRepository;
  trainingSessionRepository: TrainingSessionRepository;
  drillContentRepository: DrillContentRepository;
  entropyProvider: EntropyProvider;
  clock: Clock;
}>;

// ---- Implementation ----

export const createStartDrill =
  (dependencies: StartDrillDependencies) =>
  (input: StartDrillInput): ResultAsync<StartDrillOutput, DomainError> => {
    const learner = createLearnerIdentifier(input.learnerIdentifier);
    if (!learner) {
      return errAsync(validationFailed("learnerIdentifier", "不正な学習者識別子です"));
    }

    const weaknessProfileIdentifier =
      input.weaknessProfileIdentifier as import("../../domain/training").WeaknessProfileIdentifier;
    if (!weaknessProfileIdentifier || weaknessProfileIdentifier.trim() === "") {
      return errAsync(
        validationFailed("weaknessProfileIdentifier", "不正な WeaknessProfile 識別子です"),
      );
    }

    // WeaknessProfile を取得して priority 順に focus 対立を選択する
    return dependencies.weaknessProfileRepository
      .find(weaknessProfileIdentifier)
      .andThen((weaknessProfile) => {
        // priority 降順（WeaknessProfile 内ですでにソート済み）の focusSounds から
        // ドリルコンテンツが存在する最初の対立を選択する
        let selectedDrillContent: DrillContent | null = null;
        let selectedContrast: PhonemeContrast | null = null;

        for (const focusSound of weaknessProfile.focusSounds) {
          // catalogId → ドリルコンテンツ検索
          const byId = dependencies.drillContentRepository.findByCatalogId(
            String(focusSound.catalogId),
          );
          if (byId) {
            selectedDrillContent = byId;
            const contrastValue = createPhonemeContrast(byId.contrast);
            if (contrastValue) {
              selectedContrast = contrastValue;
            }
            break;
          }

          // contrast → ドリルコンテンツ検索（catalogId で見つからない場合のフォールバック）
          const byContrast = dependencies.drillContentRepository.findByContrast(
            String(focusSound.contrast),
          );
          if (byContrast) {
            selectedDrillContent = byContrast;
            const contrastValue = createPhonemeContrast(String(focusSound.contrast));
            if (contrastValue) {
              selectedContrast = contrastValue;
            }
            break;
          }
        }

        if (!selectedDrillContent || !selectedContrast) {
          return errAsync(
            validationFailed(
              "contrast",
              "WeaknessProfile の focus 対立に対応するドリルコンテンツが見つかりません",
            ),
          );
        }

        const capturedDrillContent = selectedDrillContent;
        const capturedContrast = selectedContrast;

        // TrainingSession(in_progress, kind=production_drill) を生成する
        const sessionIdentifierRaw = dependencies.entropyProvider.generateUlid();
        const sessionIdentifier = createTrainingSessionIdentifier(
          sessionIdentifierRaw,
        ) as TrainingSessionIdentifier;
        if (!sessionIdentifier) {
          return errAsync(
            validationFailed("sessionIdentifier", "訓練セッション識別子の生成に失敗しました"),
          );
        }

        const now = dependencies.clock.now();

        const trainingSession: TrainingSession = {
          type: "in_progress",
          identifier: sessionIdentifier,
          learner: learner as LearnerIdentifier,
          kind: "production_drill",
          contrast: capturedContrast,
          startedAt: now,
        };

        return dependencies.trainingSessionRepository.persist(trainingSession).andThen(() =>
          okAsync({
            trainingSession,
            drillContent: capturedDrillContent,
            contrast: capturedDrillContent.contrast,
          }),
        );
      });
  };
