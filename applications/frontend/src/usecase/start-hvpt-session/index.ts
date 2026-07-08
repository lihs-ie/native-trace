/**
 * StartHvptSession UseCase — HVPT 識別課題セッションを開始する (REQ-122)
 *
 * 設計の正: docs/specs/training-screen.md (M-TR-5/6, サブ(3b))
 *          docs/03-detailed-design/domain.md §14 (DD-202/203/248)
 *          adr/007-training-context-bounded-context.md (識別子のみ参照)
 *          adr/009-hvpt-stimulus-hybrid-natural-tts.md (刺激は analyzer 実取得)
 *          adr/011-spacing-scheduler-fixed-interval-mastery-gate.md
 *
 * 対立選択規則:
 *   1. SpacingSchedule の due 状態の対立を優先する（ADR-011）
 *   2. due がない場合は WeaknessProfile の focus 対立（priority 降順）から選択する
 *   3. analyzer /v1/stimuli から実刺激を取得する（偽刺激禁止 agent-policy）
 *
 * 選択肢生成規則（DD-245）:
 *   - 刺激の contrast から 2 語選択肢（正解語 + 対立語）を spelling ラベルで生成する
 *   - 対立語は contrast 文字列から対向語を抽出する（例: "r-l" の刺激語が "right" → 対立語 "light"）
 *   - 対立語が刺激セット内に存在すれば実語、存在しなければ contrast 文字列から生成する
 *
 * ADR-007: Training Context は WeaknessProfile を識別子のみで参照する。
 * LLM 呼び出しなし（ADR-007）。
 */

import { type ResultAsync, errAsync, okAsync } from "neverthrow";
import { type DomainError, validationFailed } from "../../domain/shared";
import {
  type TrainingSession,
  type TrainingSessionIdentifier,
  type LearnerIdentifier,
  type PhonemeContrast,
  type StimulusIdentifier,
  type ResponseLabel,
  createTrainingSessionIdentifier,
  createLearnerIdentifier,
  createPhonemeContrast,
  createStimulusIdentifier,
  createResponseLabel,
} from "../../domain/training";
import { type WeaknessProfileRepository } from "../port/weakness-profile-repository";
import { type TrainingSessionRepository } from "../port/training-session-repository";
import { type SpacingScheduleRepository } from "../port/spacing-schedule-repository";
import { type AnalyzerStimulusClient, type StimulusRecord } from "../port/analyzer-stimulus-client";
import { type EntropyProvider } from "../port/entropy-provider";
import { type Clock } from "../port/clock";

// ---- Constants ----

/** analyzer /v1/stimuli から取得する刺激候補数の上限。 */
const HVPT_STIMULUS_FETCH_LIMIT = 20;

// ---- Input ----

export type StartHvptSessionInput = Readonly<{
  /** sentinel LearnerIdentifier (config.diagnosticSentinelLearnerIdentifier) */
  learnerIdentifier: string;
  /** WeaknessProfile 識別子。対立選択の参照先。 */
  weaknessProfileIdentifier: string;
}>;

// ---- Output ----

export type HvptStimulusWithChoices = Readonly<{
  stimulusIdentifier: StimulusIdentifier;
  wavBase64: string;
  metadata: Readonly<{
    contrast: string;
    word: string;
    speakerIdentifier: string;
    speakerSex: string;
    context: string;
    sourceCorpus: string;
    licenseIdentifier: string;
  }>;
  choices: ReadonlyArray<ResponseLabel>;
  correctLabel: ResponseLabel;
}>;

export type StartHvptSessionOutput = Readonly<{
  trainingSession: TrainingSession;
  contrast: string;
  stimuli: ReadonlyArray<HvptStimulusWithChoices>;
}>;

// ---- Dependencies ----

export type StartHvptSessionDependencies = Readonly<{
  weaknessProfileRepository: WeaknessProfileRepository;
  trainingSessionRepository: TrainingSessionRepository;
  spacingScheduleRepository: SpacingScheduleRepository;
  analyzerStimulusClient: AnalyzerStimulusClient;
  entropyProvider: EntropyProvider;
  clock: Clock;
}>;

// ---- 選択肢生成ヘルパー ----

/**
 * buildChoicesForStimulus — 刺激の word から 2 択選択肢を生成する。
 *
 * REQ-122: 応答ラベルは綴り/キーワード/IPA のいずれか (DD-245)。
 * ここでは spelling ラベルで正解語 + 対立語を生成する。
 * 対立語は刺激セット内の対向 word を使用する。存在しない場合は word として contrast の対向音素を使う。
 */
const buildChoicesForStimulus = (
  stimulus: StimulusRecord,
  allStimuli: ReadonlyArray<StimulusRecord>,
): { choices: ReadonlyArray<ResponseLabel>; correctLabel: ResponseLabel } => {
  const correctLabelResult = createResponseLabel("spelling", stimulus.word);
  // createResponseLabel は word が非空なら必ず ok
  const correctLabel = correctLabelResult.isOk()
    ? correctLabelResult.value
    : ({ type: "spelling", value: stimulus.word } as ResponseLabel);

  // 同じ contrast で異なる word を対立語として選ぶ
  const contrastWords = allStimuli
    .filter((s) => s.contrast === stimulus.contrast && s.word !== stimulus.word)
    .map((s) => s.word);

  // ユニーク化
  const uniqueContrastWords = [...new Set(contrastWords)];

  // 対立語が見つからない場合は contrast 文字列から推定する（例: "r-l" → "r"/"l"）
  const distractorWord =
    uniqueContrastWords.length > 0
      ? uniqueContrastWords[0]
      : (() => {
          const parts = stimulus.contrast.split("-");
          const contrastPhoneme = parts.find((p) => !stimulus.word.startsWith(p)) ?? parts[0];
          return contrastPhoneme;
        })();

  const distractorLabelResult = createResponseLabel("spelling", distractorWord);
  const distractorLabel = distractorLabelResult.isOk()
    ? distractorLabelResult.value
    : ({ type: "spelling", value: distractorWord } as ResponseLabel);

  // 選択肢はランダム順にしない（順序は固定: 正解, 対立語）
  // 実際の提示順はフロントエンドがシャッフルする
  const choices: ReadonlyArray<ResponseLabel> = [correctLabel, distractorLabel];

  return { choices, correctLabel };
};

// ---- Implementation ----

export const createStartHvptSession =
  (dependencies: StartHvptSessionDependencies) =>
  (input: StartHvptSessionInput): ResultAsync<StartHvptSessionOutput, DomainError> => {
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

    // 1. WeaknessProfile を取得して focus 対立候補を得る
    return dependencies.weaknessProfileRepository
      .find(weaknessProfileIdentifier)
      .andThen((weaknessProfile) => {
        // 2. SpacingSchedule の due 状態を優先して対立を選択する
        return dependencies.spacingScheduleRepository
          .findDueByLearner(learner)
          .andThen((dueSchedules) => {
            let selectedContrast: PhonemeContrast | null = null;

            // due があれば最初の due 対立を選択
            if (dueSchedules.length > 0) {
              const dueContrast = createPhonemeContrast(String(dueSchedules[0].contrast));
              if (dueContrast) {
                selectedContrast = dueContrast;
              }
            }

            // due がなければ WeaknessProfile の priority 降順から選択
            if (!selectedContrast) {
              for (const focusSound of weaknessProfile.focusSounds) {
                const contrastValue = createPhonemeContrast(String(focusSound.contrast));
                if (contrastValue) {
                  selectedContrast = contrastValue;
                  break;
                }
              }
            }

            if (!selectedContrast) {
              return errAsync(
                validationFailed("contrast", "WeaknessProfile に有効な focus 対立がありません"),
              );
            }

            const capturedContrast = selectedContrast;

            // 3. analyzer /v1/stimuli から実刺激を取得する（偽刺激禁止）
            return dependencies.analyzerStimulusClient
              .fetchStimuli(String(capturedContrast), undefined, HVPT_STIMULUS_FETCH_LIMIT)
              .andThen((stimuliRecords) => {
                if (stimuliRecords.length === 0) {
                  return errAsync(
                    validationFailed(
                      "stimuli",
                      `対立 '${String(capturedContrast)}' の刺激が analyzer に存在しません。carve パイプラインを実行してください。`,
                    ),
                  );
                }

                // 4. TrainingSession(in_progress, kind=hvpt_identification) を生成する
                const sessionIdentifierRaw = dependencies.entropyProvider.generateUlid();
                const sessionIdentifier = createTrainingSessionIdentifier(
                  sessionIdentifierRaw,
                ) as TrainingSessionIdentifier;
                if (!sessionIdentifier) {
                  return errAsync(
                    validationFailed(
                      "sessionIdentifier",
                      "訓練セッション識別子の生成に失敗しました",
                    ),
                  );
                }

                const now = dependencies.clock.now();

                const trainingSession: TrainingSession = {
                  type: "in_progress",
                  identifier: sessionIdentifier,
                  learner: learner as LearnerIdentifier,
                  kind: "hvpt_identification",
                  contrast: capturedContrast,
                  startedAt: now,
                };

                // 5. 刺激に選択肢を付加する
                const stimuliWithChoices: HvptStimulusWithChoices[] = stimuliRecords.map(
                  (record) => {
                    const { choices, correctLabel } = buildChoicesForStimulus(
                      record,
                      stimuliRecords,
                    );
                    const stimulusIdentifier = createStimulusIdentifier(
                      record.stimulusIdentifier,
                    ) as StimulusIdentifier;
                    return {
                      stimulusIdentifier,
                      wavBase64: record.wavBase64,
                      metadata: {
                        contrast: record.contrast,
                        word: record.word,
                        speakerIdentifier: record.speakerIdentifier,
                        speakerSex: record.speakerSex,
                        context: record.context,
                        sourceCorpus: record.sourceCorpus,
                        licenseIdentifier: record.licenseIdentifier,
                      },
                      choices,
                      correctLabel,
                    };
                  },
                );

                return dependencies.trainingSessionRepository.persist(trainingSession).andThen(() =>
                  okAsync({
                    trainingSession,
                    contrast: String(capturedContrast),
                    stimuli: stimuliWithChoices,
                  }),
                );
              });
          });
      });
  };
