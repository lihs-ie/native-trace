/**
 * ComputeShadowingLag UseCase — シャドーイングラグを計測し training_sessions に永続する (REQ-125)
 *
 * 設計の正: docs/specs/shadowing-lag.md (M-SHL-4/5/6)
 *          adr/013-shadowing-lag-measurement.md
 *          adr/007-training-context-bounded-context.md (識別子のみ参照)
 *          adr/008-training-progress-timeseries-data-model.md
 *
 * 処理フロー:
 *   1. InProgressTrainingSession (kind='shadowing') を生成して永続化する
 *   2. ShadowingLagClient (OSS Worker) を呼び出しラグを計測する
 *   3. completeTrainingSession で InProgress → Completed 遷移する
 *      (session_accuracy = null — シャドーイングはゲート遷移対象外 ADR-011)
 *   4. training_sessions を永続化する (ORPHAN-3: kind='shadowing', session_accuracy=null)
 *   5. applySpacingTransition は呼ばない (ADR-011: spacing は HVPT/産出ドリルのみ)
 *
 * 注意: SpacingSchedule の更新は行わない。
 */

import { type ResultAsync, errAsync, okAsync } from "neverthrow";
import { type DomainError, validationFailed } from "../../domain/shared";
import {
  type TrainingSessionIdentifier,
  type LearnerIdentifier,
  type PhonemeContrast,
  type SpacingSchedulerConfig,
  createTrainingSessionIdentifier,
  createLearnerIdentifier,
  createPhonemeContrast,
  completeTrainingSession,
} from "../../domain/training";
import { type ShadowingLagClient, type ShadowingLagInput } from "../port/shadowing-lag-client";
import { type TrainingSessionRepository } from "../port/training-session-repository";
import { type EntropyProvider } from "../port/entropy-provider";
import { type Clock } from "../port/clock";

// ---- Input ----

export type ComputeShadowingLagInput = Readonly<{
  /** sentinel LearnerIdentifier */
  learnerIdentifier: string;
  /**
   * contrast — shadowing セッションに紐づく音素対立。
   * HVPT と同じ contrast を使用する (セッション開始時の focus contrast)。
   * 診断なし状態では "general" など汎用値を使う。
   */
  contrast: string;
  /** reference audio (Kokoro TTS お手本) */
  referenceAudioBytes: Uint8Array;
  referenceAudioMimeType: string;
  /** learner audio (マイク録音) */
  learnerAudioBytes: Uint8Array;
  learnerAudioMimeType: string;
  /** お手本テキスト (worker の referenceText) */
  referenceText: string;
  /** 音声長 ms */
  durationMilliseconds: number;
  /** セッション経過時間 (分) */
  durationMinutes: number;
  /** SpacingSchedulerConfig (config 由来 — domain literal 禁止) */
  schedulerConfig: SpacingSchedulerConfig;
}>;

// ---- Output ----

export type ComputeShadowingLagOutput = Readonly<{
  trainingSessionIdentifier: string;
  lagMilliseconds: number;
  perSegmentLag: ReadonlyArray<Readonly<{ phoneme: string; lagMilliseconds: number }>>;
  speechRateRatio: number | null;
  pauseCountLearner: number | null;
  pauseCountReference: number | null;
  recommendSlowPlayback: boolean;
  thresholdMilliseconds: number;
}>;

// ---- Dependencies ----

export type ComputeShadowingLagDependencies = Readonly<{
  shadowingLagClient: ShadowingLagClient;
  trainingSessionRepository: TrainingSessionRepository;
  entropyProvider: EntropyProvider;
  clock: Clock;
}>;

// ---- Implementation ----

export const createComputeShadowingLag =
  (dependencies: ComputeShadowingLagDependencies) =>
  (input: ComputeShadowingLagInput): ResultAsync<ComputeShadowingLagOutput, DomainError> => {
    const learner = createLearnerIdentifier(input.learnerIdentifier) as LearnerIdentifier;
    if (!learner) {
      return errAsync(validationFailed("learnerIdentifier", "不正な学習者識別子です"));
    }

    const contrast = createPhonemeContrast(input.contrast) as PhonemeContrast;
    if (!contrast) {
      return errAsync(validationFailed("contrast", "不正な音素対立値です"));
    }

    const now = dependencies.clock.now();
    const sessionIdentifierRaw = dependencies.entropyProvider.generateUlid();
    const sessionIdentifier = createTrainingSessionIdentifier(
      sessionIdentifierRaw,
    ) as TrainingSessionIdentifier;
    if (!sessionIdentifier) {
      return errAsync(
        validationFailed("sessionIdentifier", "訓練セッション識別子の生成に失敗しました"),
      );
    }

    // 1. InProgressTrainingSession (kind='shadowing') を生成して永続化する
    const inProgressSession = {
      type: "in_progress" as const,
      identifier: sessionIdentifier,
      learner,
      kind: "shadowing" as const,
      contrast,
      startedAt: now,
    };

    return dependencies.trainingSessionRepository
      .persist(inProgressSession)
      .andThen(() => {
        // 2. ShadowingLagClient を呼び出しラグを計測する
        const lagInput: ShadowingLagInput = {
          referenceAudioBytes: input.referenceAudioBytes,
          referenceAudioMimeType: input.referenceAudioMimeType,
          learnerAudioBytes: input.learnerAudioBytes,
          learnerAudioMimeType: input.learnerAudioMimeType,
          referenceText: input.referenceText,
          durationMilliseconds: input.durationMilliseconds,
        };

        return dependencies.shadowingLagClient.computeLag(lagInput);
      })
      .andThen((lagResult) => {
        const completedAt = dependencies.clock.now();

        // 3. completeTrainingSession — session_accuracy = null (ADR-011: shadowing はゲート対象外)
        const completeResult = completeTrainingSession(
          inProgressSession,
          input.durationMinutes,
          null, // session_accuracy is always null for shadowing
          input.schedulerConfig,
          completedAt,
        );

        if (completeResult.isErr()) {
          return errAsync(completeResult.error);
        }

        const { session: completedSession } = completeResult.value;

        // 4. training_sessions を永続化する (ORPHAN-3: kind='shadowing', session_accuracy=null)
        // applySpacingTransition は呼ばない (ADR-011)
        return dependencies.trainingSessionRepository.persist(completedSession).andThen(() =>
          okAsync({
            trainingSessionIdentifier: String(completedSession.identifier),
            lagMilliseconds: lagResult.lagMilliseconds,
            perSegmentLag: lagResult.perSegmentLag,
            speechRateRatio: lagResult.speechRateRatio,
            pauseCountLearner: lagResult.pauseCountLearner,
            pauseCountReference: lagResult.pauseCountReference,
            recommendSlowPlayback: lagResult.recommendSlowPlayback,
            thresholdMilliseconds: lagResult.thresholdMilliseconds,
          }),
        );
      });
  };

export type ComputeShadowingLagExecutor = ReturnType<typeof createComputeShadowingLag>;
