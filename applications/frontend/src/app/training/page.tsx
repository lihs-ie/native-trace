"use client";

/**
 * 訓練画面 — /training
 *
 * design-reference/screens/training.html に完全合致。
 * M-TR-8: .tr-body (2列 1fr 320px) / .tr-main / .tr-rail / .tr-dock / .tr-fbslot
 *         / .choice-grid#choices / .choice[data-ans] / .sched / .cum-bar / .drill-pair
 *         / .two-col (シャドーイング honest placeholder)
 *
 * HVPT フロー (ADR-009 実刺激駆動、偽刺激禁止):
 *   1. sessionStorage から weaknessProfileIdentifier 取得
 *   2. POST /api/v1/training/hvpt-sessions { weaknessProfileIdentifier } → HvptSessionDto (実刺激)
 *   3. .play-big / .spk-chip で音声再生
 *   4. .choice クリック → POST .../trials → HvptTrialResultDto (.trial-fb--ok/--ng)
 *   5. 正解音再生 / is-correct / is-wrong 発光演出
 *   6. 全試行完了 → POST .../completion → HvptCompletionDto (accuracy / spacingState / cumulative)
 *
 * 産出ドリルプレビュー (.tr-dock):
 *   DrillDto から .drill-pair 表示、録音ボタン表示 (録音→ POST drills/{id}/attempts は TODO sub-2)
 *
 * シャドーイング窓 (.two-col):
 *   sub-4 未実装のため honest「準備中」placeholder (偽ラグ値なし)
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPost, isApiClientError } from "@/lib/api-client";
import type {
  HvptSessionDto,
  HvptStimulusDto,
  HvptTrialResultDto,
  HvptCompletionDto,
  DrillDto,
  TrainingScheduleDto,
  SpacingScheduleDto,
  ShadowingLagResultDto,
} from "@/lib/api-types";

// ---- 録音状態 ----
type RecordingState = "idle" | "recording" | "done";

// ---- シャドーイング状態 ----
type ShadowingPhase =
  | { type: "idle" }
  | { type: "tts_loading" }
  | { type: "ready"; referenceAudioBytes: Uint8Array; referenceText: string }
  | {
      type: "recording";
      referenceAudioBytes: Uint8Array;
      referenceText: string;
      referenceAudioNode: AudioBufferSourceNode;
      audioContext: AudioContext;
      startedAt: number;
    }
  | { type: "submitting" }
  | {
      type: "result";
      lagResult: ShadowingLagResultDto;
      playbackRate: number;
    }
  | { type: "error"; message: string };

// ---- HVPT セッション状態 ----
type HvptPhase =
  | { type: "loading" }
  | { type: "error"; message: string }
  | { type: "no_weakness_profile" }
  | { type: "session_active"; session: HvptSessionDto; currentStimulusIndex: number }
  | {
      type: "trial_feedback";
      session: HvptSessionDto;
      currentStimulusIndex: number;
      trialResult: HvptTrialResultDto;
    }
  | { type: "session_complete"; completion: HvptCompletionDto };

// ---- フォーマット補助 ----
const formatMinutes = (totalMinutes: number): string => {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  return `${hours}h ${minutes}min`;
};

// ---- SpacingSchedule → sched-cell クラス ----
const schedStateToClass = (state: SpacingScheduleDto["state"]): string => {
  switch (state) {
    case "done":
      return "sched-cell sched-cell--done";
    case "due":
      return "sched-cell sched-cell--due";
    case "gate":
      return "sched-cell sched-cell--gate";
    case "rest":
      return "sched-cell sched-cell--rest";
  }
};

const schedStateToIcon = (state: SpacingScheduleDto["state"]): string => {
  switch (state) {
    case "done":
      return "✓";
    case "due":
      return "▶";
    case "gate":
      return "🔒";
    case "rest":
      return "·";
  }
};

const schedStateToLabel = (state: SpacingScheduleDto["state"], contrast: string): string => {
  if (state === "done" || state === "rest") return contrast.slice(0, 4);
  if (state === "gate") return "ゲート";
  return contrast.slice(0, 4);
};

const formatNextPresentationDate = (isoString: string): string => {
  const date = new Date(isoString);
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const targetStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round(
    (targetStart.getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays === 0) return "今日";
  if (diffDays === 1) return "明日";
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

// ---- Component ----

/**
 * sessionStorage から training-weakness-profile-id を読んで初期 HvptPhase を決める。
 * lazy initializer として使うため、レンダー時に 1 回だけ呼ばれる。
 * SSR では sessionStorage が存在しないため try/catch で保護する。
 */
function buildInitialHvptPhase(): HvptPhase {
  try {
    const cached =
      typeof window !== "undefined" ? sessionStorage.getItem("training-weakness-profile-id") : null;
    if (!cached) return { type: "no_weakness_profile" };
    return { type: "loading" };
  } catch {
    return { type: "no_weakness_profile" };
  }
}

function readCachedWeaknessProfileId(): string | null {
  try {
    return typeof window !== "undefined"
      ? sessionStorage.getItem("training-weakness-profile-id")
      : null;
  } catch {
    return null;
  }
}

export default function TrainingPage() {
  // ---- セッション状態 ----
  const [hvptPhase, setHvptPhase] = useState<HvptPhase>(buildInitialHvptPhase);
  const [weaknessProfileIdentifier] = useState<string | null>(readCachedWeaknessProfileId);

  // ---- Rail データ ----
  const [trainingSchedule, setTrainingSchedule] = useState<TrainingScheduleDto | null>(null);
  const [schedulingError, setSchedulingError] = useState<string | null>(null);

  // ---- ドリルプレビュー ----
  const [drillDto, setDrillDto] = useState<DrillDto | null>(null);

  // ---- 試行カウンタ / タイマー ----
  const [trialCount, setTrialCount] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  // sessionStartRef は useEffect 内で初期化するため null から始める
  const sessionStartRef = useRef<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- 音声再生 ----
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // ---- ドリル録音 ----
  const [drillRecordingState, setDrillRecordingState] = useState<RecordingState>("idle");
  const drillMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const drillChunksRef = useRef<Blob[]>([]);

  // ---- シャドーイング状態 ----
  const [shadowingPhase, setShadowingPhase] = useState<ShadowingPhase>({ type: "idle" });
  const shadowingMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const shadowingChunksRef = useRef<Blob[]>([]);
  // シャドーイングお手本テキスト (HVPT のcontrast から生成した文例)
  const SHADOWING_REFERENCE_TEXT = "The red ball is big and the blue ball is small.";
  const SHADOWING_CONTRAST = "general";

  // ---- submitInFlight: 試行提出中の二重クリック防止 ----
  const [submitInFlight, setSubmitInFlight] = useState(false);

  // ---- セッション経過時間タイマー ----
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setElapsedSeconds((prev) => {
        const start = sessionStartRef.current;
        if (start === null) return prev;
        return Math.floor((Date.now() - start) / 1000);
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // ---- SpacingSchedule + 累計訓練時間 取得 ----
  useEffect(() => {
    apiGet<TrainingScheduleDto>("/api/v1/training/schedule")
      .then((data) => {
        setTrainingSchedule(data);
      })
      .catch((error: unknown) => {
        setSchedulingError(
          isApiClientError(error) ? error.message : "スケジュールの取得に失敗しました",
        );
      });
  }, []);

  // ---- HVPT セッション開始 (前方宣言で useEffect より上に置く) ----
  const startHvptSession = useCallback(
    async (profileId: string) => {
      setHvptPhase({ type: "loading" });
      try {
        const session = await apiPost<HvptSessionDto>("/api/v1/training/hvpt-sessions", {
          weaknessProfileIdentifier: profileId,
        });
        sessionStartRef.current = Date.now();
        setElapsedSeconds(0);
        setTrialCount(0);
        setCorrectCount(0);
        setHvptPhase({
          type: "session_active",
          session,
          currentStimulusIndex: 0,
        });

        // DrillDto も同時に取得（phase ② プレビュー用）
        try {
          const drill = await apiPost<DrillDto>("/api/v1/training/drills", {
            weaknessProfileIdentifier: profileId,
          });
          setDrillDto(drill);
        } catch {
          // ドリル取得失敗は警告扱い（HVPT には影響しない）
          setDrillDto(null);
        }
      } catch (error: unknown) {
        setHvptPhase({
          type: "error",
          message: isApiClientError(error)
            ? error.message
            : error instanceof Error
              ? error.message
              : "セッションの開始に失敗しました",
        });
      }
    },
    // setHvptPhase 等は安定参照なので deps 不要
    [],
  );

  // ---- セッション完了 ----
  const completeSession = useCallback(
    async (session: HvptSessionDto, profileId: string, durationSeconds: number) => {
      const durationMinutes = Math.max(1, Math.min(30, Math.floor(durationSeconds / 60)));
      try {
        const completion = await apiPost<HvptCompletionDto>(
          `/api/v1/training/hvpt-sessions/${session.trainingSessionIdentifier}/completion`,
          {
            weaknessProfileIdentifier: profileId,
            durationMinutes,
          },
        );
        setHvptPhase({ type: "session_complete", completion });
        // schedule を更新
        apiGet<TrainingScheduleDto>("/api/v1/training/schedule")
          .then((data) => setTrainingSchedule(data))
          .catch(() => undefined);
      } catch (error: unknown) {
        setHvptPhase({
          type: "error",
          message: isApiClientError(error)
            ? error.message
            : error instanceof Error
              ? error.message
              : "セッション完了処理に失敗しました",
        });
      }
    },
    [],
  );

  // ---- 初期化: mount 後にセッション開始を非同期スケジュール ----
  // 初期状態は lazy initializer で決定済み。
  // setTimeout 0 で非同期化することで effect 内の直接 setState を避ける。
  const hasInitializedRef = useRef(false);
  useEffect(() => {
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;
    const profileId = readCachedWeaknessProfileId();
    if (profileId) {
      setTimeout(() => {
        void startHvptSession(profileId);
      }, 0);
    }
  }, [startHvptSession]);

  // ---- 刺激音声再生 ----
  const playStimulus = useCallback((stimulus: HvptStimulusDto) => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    if (!stimulus.wavBase64) return;
    const audio = new Audio(`data:audio/wav;base64,${stimulus.wavBase64}`);
    currentAudioRef.current = audio;
    setIsPlaying(true);
    audio.onended = () => setIsPlaying(false);
    audio.onerror = () => setIsPlaying(false);
    void audio.play();
  }, []);

  // ---- 選択肢クリック: 試行提出 ----
  const handleChoiceClick = useCallback(
    async (
      session: HvptSessionDto,
      stimulus: HvptStimulusDto,
      choiceValue: string,
      choiceType: string,
      currentStimulusIndex: number,
    ) => {
      if (submitInFlight) return;
      setSubmitInFlight(true);

      const presentedAt = new Date(Date.now() - 2000).toISOString();
      const reactionTimeMilliseconds = Math.max(100, elapsedSeconds * 1000);
      const correctChoice = stimulus.choices[0];
      if (!correctChoice) {
        setSubmitInFlight(false);
        return;
      }

      try {
        const trialResult = await apiPost<HvptTrialResultDto>(
          `/api/v1/training/hvpt-sessions/${session.trainingSessionIdentifier}/trials`,
          {
            stimulusIdentifier: stimulus.stimulusIdentifier,
            correctLabelType: correctChoice.type,
            correctLabelValue: correctChoice.value,
            responseLabelType: choiceType,
            responseLabelValue: choiceValue,
            reactionTimeMilliseconds,
            presentedAt,
            correctStimulusWavBase64: stimulus.wavBase64,
          },
        );

        const newTrialCount = trialCount + 1;
        const newCorrectCount = correctCount + (trialResult.correct ? 1 : 0);
        setTrialCount(newTrialCount);
        setCorrectCount(newCorrectCount);

        setHvptPhase({
          type: "trial_feedback",
          session,
          currentStimulusIndex,
          trialResult,
        });

        // 正解音再生
        if (trialResult.correctStimulusWavBase64) {
          const correctAudio = new Audio(
            `data:audio/wav;base64,${trialResult.correctStimulusWavBase64}`,
          );
          void correctAudio.play().catch(() => undefined);
        }

        // セッション打ち切り: 全刺激完了 or 20分経過
        const totalStimuli = session.stimuli.length;
        const sessionMinutes = Math.floor(elapsedSeconds / 60);
        const profileId = weaknessProfileIdentifier;
        if (profileId && (currentStimulusIndex + 1 >= totalStimuli || sessionMinutes >= 20)) {
          void completeSession(session, profileId, elapsedSeconds);
        }
      } catch (error: unknown) {
        setHvptPhase({
          type: "error",
          message: isApiClientError(error)
            ? error.message
            : error instanceof Error
              ? error.message
              : "試行の提出に失敗しました",
        });
      } finally {
        setSubmitInFlight(false);
      }
    },
    [
      submitInFlight,
      elapsedSeconds,
      trialCount,
      correctCount,
      weaknessProfileIdentifier,
      completeSession,
    ],
  );

  // ---- 次の試行へ ----
  const advanceToNextTrial = useCallback(() => {
    setHvptPhase((previous) => {
      if (previous.type !== "trial_feedback") return previous;
      const nextIndex = previous.currentStimulusIndex + 1;
      if (nextIndex >= previous.session.stimuli.length) {
        return previous; // completeSession が非同期で遷移させる
      }
      return {
        type: "session_active",
        session: previous.session,
        currentStimulusIndex: nextIndex,
      };
    });
  }, []);

  // ---- 経過時間フォーマット ----
  const formattedElapsedTime = `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, "0")}`;

  // ---- 正答率 ----
  const accuracyPercent = trialCount > 0 ? Math.round((correctCount / trialCount) * 100) : 0;

  // ---- cum-bar 幅 ----
  const cumulativeMinutes = trainingSchedule?.cumulativeTrainingMinutes ?? 0;
  const cumBarWidth = Math.min(100, (cumulativeMinutes / 400) * 100);

  // ---- 現在の刺激 ----
  const currentStimulus =
    hvptPhase.type === "session_active" || hvptPhase.type === "trial_feedback"
      ? (hvptPhase.session.stimuli[hvptPhase.currentStimulusIndex] ?? null)
      : null;

  // ---- HVPT メインコンテンツ ----
  const renderHvptMain = () => {
    if (hvptPhase.type === "loading") {
      return (
        <div style={{ textAlign: "center", color: "var(--text-tertiary)", padding: "var(--sp-8)" }}>
          セッションを準備中...
        </div>
      );
    }

    if (hvptPhase.type === "error") {
      return (
        <div style={{ textAlign: "center", padding: "var(--sp-8)" }}>
          <p style={{ color: "var(--sev-critical-text)", margin: "0 0 16px" }}>
            {hvptPhase.message}
          </p>
          <p style={{ color: "var(--text-faint)", fontSize: "var(--text-xs)", margin: "0 0 16px" }}>
            analyzer が起動していない場合、HVPT 刺激を取得できません。
          </p>
          <Link href="/" className="btn btn--sm btn--secondary">
            ライブラリへ
          </Link>
        </div>
      );
    }

    if (hvptPhase.type === "no_weakness_profile") {
      return (
        <div style={{ textAlign: "center", padding: "var(--sp-8)" }}>
          <div className="kbd-label" style={{ marginBottom: "14px" }}>
            訓練を開始するには診断が必要です
          </div>
          <p
            style={{
              color: "var(--text-secondary)",
              fontFamily: "var(--font-jp)",
              fontSize: "var(--text-sm)",
              margin: "0 0 24px",
            }}
          >
            診断テストを完了すると、あなたの弱点に合わせた訓練が自動で開始されます。
          </p>
          <Link href="/" className="btn btn--primary">
            診断を始める →
          </Link>
        </div>
      );
    }

    if (hvptPhase.type === "session_complete") {
      const { completion } = hvptPhase;
      const passed = completion.spacingState === "rest";
      return (
        <div style={{ textAlign: "center", padding: "var(--sp-8)", maxWidth: "460px" }}>
          <div className="kbd-label" style={{ marginBottom: "14px" }}>
            セッション完了
          </div>
          <p
            style={{
              fontSize: "var(--text-xl)",
              fontFamily: "var(--font-mono)",
              color: passed ? "var(--positive-text)" : "var(--sev-critical-text)",
              margin: "0 0 8px",
            }}
          >
            {Math.round(completion.sessionAccuracy * 100)}%
          </p>
          <p
            style={{
              color: "var(--text-secondary)",
              fontFamily: "var(--font-jp)",
              fontSize: "var(--text-sm)",
              margin: "0 0 24px",
            }}
          >
            {passed
              ? "正答率 60% を達成しました。次の対立へ進めます。"
              : "正答率 60% 未達成。24時間後に再挑戦できます。"}
          </p>
          <div
            className="session-meta"
            style={{
              flexDirection: "column",
              alignItems: "center",
              gap: "8px",
              marginBottom: "24px",
            }}
          >
            <span>
              累計訓練時間 <b>{formatMinutes(completion.cumulativeTrainingMinutes)}</b>
            </span>
          </div>
          {weaknessProfileIdentifier && (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                if (weaknessProfileIdentifier) {
                  void startHvptSession(weaknessProfileIdentifier);
                }
              }}
            >
              もう一度 →
            </button>
          )}
        </div>
      );
    }

    if (!currentStimulus) return null;

    return (
      <div className="tr-q" style={{ width: "100%", maxWidth: "460px" }}>
        <div className="qq">聞こえたのはどちら?</div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            justifyContent: "center",
            marginTop: "18px",
          }}
        >
          <button
            type="button"
            className="play-big"
            onClick={() => playStimulus(currentStimulus)}
            aria-label="刺激音声を再生"
            disabled={isPlaying}
          >
            {isPlaying ? "▌▌" : "▶"}
          </button>
        </div>
        <div
          style={{
            display: "flex",
            gap: "8px",
            justifyContent: "center",
            marginTop: "14px",
            flexWrap: "wrap",
          }}
        >
          {currentStimulus.metadata.speakerIdentifier && (
            <span className="spk-chip">
              話者 {currentStimulus.metadata.speakerIdentifier} ·{" "}
              {currentStimulus.metadata.speakerSex === "female" ? "♀" : "♂"}
            </span>
          )}
          {currentStimulus.metadata.context && (
            <span className="spk-chip">{currentStimulus.metadata.context}</span>
          )}
          {currentStimulus.metadata.sourceCorpus && (
            <span className="spk-chip">{currentStimulus.metadata.sourceCorpus}</span>
          )}
        </div>
      </div>
    );
  };

  // ---- 選択肢グリッド ----
  const renderChoiceGrid = () => {
    if (!currentStimulus) return null;
    if (hvptPhase.type !== "session_active" && hvptPhase.type !== "trial_feedback") return null;

    const isFeedback = hvptPhase.type === "trial_feedback";
    const trialResult = isFeedback ? hvptPhase.trialResult : null;
    const session = hvptPhase.session;
    const currentStimulusIndex = hvptPhase.currentStimulusIndex;

    return (
      <div
        className="choice-grid tr-choices"
        id="choices"
        style={{ width: "100%", maxWidth: "460px" }}
      >
        {currentStimulus.choices.map((choice) => {
          const isCorrect = trialResult !== null && choice.value === trialResult.correctLabel.value;
          const isWrong =
            trialResult !== null &&
            !trialResult.correct &&
            choice.value !== trialResult.correctLabel.value;
          const choiceClass = ["choice", isCorrect ? "is-correct" : "", isWrong ? "is-wrong" : ""]
            .filter(Boolean)
            .join(" ");

          return (
            <button
              key={`${choice.type}-${choice.value}`}
              type="button"
              className={choiceClass}
              data-ans={isCorrect ? "ok" : "ng"}
              disabled={isFeedback || submitInFlight}
              onClick={() => {
                if (!isFeedback && !submitInFlight) {
                  void handleChoiceClick(
                    session,
                    currentStimulus,
                    choice.value,
                    choice.type,
                    currentStimulusIndex,
                  );
                }
              }}
            >
              <span className="cw">{currentStimulus.metadata.word}</span>
              <span className="cipa">{choice.value}</span>
            </button>
          );
        })}
      </div>
    );
  };

  // ---- フィードバックスロット ----
  const renderFeedbackSlot = () => {
    if (hvptPhase.type !== "trial_feedback") {
      return <div className="tr-fbslot" id="fbSlot" />;
    }

    const { trialResult, session, currentStimulusIndex } = hvptPhase;
    const nextExists = currentStimulusIndex + 1 < session.stimuli.length;

    if (trialResult.correct) {
      return (
        <div className="tr-fbslot" id="fbSlot">
          <div className="trial-fb trial-fb--ok">
            <span className="mk2">✓</span>
            正解。
            {nextExists && (
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                style={{ marginLeft: "auto" }}
                onClick={advanceToNextTrial}
              >
                次へ →
              </button>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="tr-fbslot" id="fbSlot">
        <div className="trial-fb trial-fb--ng">
          <span className="mk2">✕</span>
          正解は <b>{trialResult.correctLabel.value}</b> でした。
          {trialResult.correctStimulusWavBase64 && (
            <button
              type="button"
              className="btn btn--sm btn--secondary"
              onClick={() => {
                const audio = new Audio(
                  `data:audio/wav;base64,${trialResult.correctStimulusWavBase64}`,
                );
                void audio.play();
              }}
            >
              ▸ 正解音をもう一度
            </button>
          )}
          {nextExists && (
            <button type="button" className="btn btn--sm btn--ghost" onClick={advanceToNextTrial}>
              次へ →
            </button>
          )}
        </div>
      </div>
    );
  };

  // ---- Rail ----
  const renderRail = () => {
    const schedules = trainingSchedule?.schedules ?? [];
    const hasDue = schedules.some((s) => s.state === "gate");

    const sessionStimCount =
      hvptPhase.type === "session_active" || hvptPhase.type === "trial_feedback"
        ? hvptPhase.session.stimuli.length
        : null;

    return (
      <aside className="tr-rail">
        {/* Session メタ */}
        <div className="rail-block">
          <div className="rail-h">Session</div>
          <div
            className="session-meta"
            style={{ flexDirection: "column", alignItems: "flex-start", gap: "8px" }}
          >
            <span>
              trial{" "}
              <b>
                {trialCount} / {sessionStimCount ?? "—"}
              </b>
            </span>
            <span>
              経過 <b>{formattedElapsedTime} / 30:00</b>
            </span>
            <span>
              正答率 <b id="accN">{trialCount > 0 ? `${accuracyPercent}%` : "—"}</b>{" "}
              <span style={{ color: "var(--text-faint)" }}>(ゲート 60%)</span>
            </span>
          </div>
        </div>

        {/* 累計訓練バー */}
        <div className="rail-block">
          <div className="rail-h">
            累計訓練 —{" "}
            {hvptPhase.type === "session_active" || hvptPhase.type === "trial_feedback"
              ? hvptPhase.session.contrast
              : "—"}
          </div>
          <div className="cum-bar" style={{ marginTop: "16px" }}>
            <i style={{ width: `${cumBarWidth}%` }} />
            <span className="plateau" style={{ left: "80%" }} data-lbl="≈300–400min" />
          </div>
          <div className="session-meta" style={{ marginTop: "8px" }}>
            <span>
              <b>{formatMinutes(cumulativeMinutes)}</b> 累計
              {cumulativeMinutes < 300 ? " · 頭打ちまで余地あり" : " · プラトー域"}
            </span>
          </div>
        </div>

        {/* 分散スケジュール */}
        <div className="rail-block">
          <div className="rail-h">分散スケジュール · 24h 等間隔</div>
          {schedulingError && (
            <p style={{ margin: 0, fontSize: "var(--text-2xs)", color: "var(--text-faint)" }}>
              スケジュール取得エラー
            </p>
          )}
          {schedules.length === 0 && !schedulingError && (
            <p style={{ margin: 0, fontSize: "var(--text-2xs)", color: "var(--text-faint)" }}>
              訓練を開始するとスケジュールが表示されます
            </p>
          )}
          {schedules.length > 0 && (
            <>
              <div className="sched">
                {schedules.slice(0, 4).map((schedule) => (
                  <div key={schedule.identifier} className={schedStateToClass(schedule.state)}>
                    <span className="d">
                      {formatNextPresentationDate(schedule.nextPresentationAt)}
                    </span>
                    <span className="s">{schedStateToIcon(schedule.state)}</span>
                    <span className="lbl">
                      {schedule.recentAccuracy != null
                        ? `${Math.round(schedule.recentAccuracy * 100)}%`
                        : schedStateToLabel(schedule.state, schedule.contrast)}
                    </span>
                  </div>
                ))}
              </div>
              {hasDue && (
                <div className="gate-note" style={{ marginTop: "10px" }}>
                  <span className="gn">🔒</span>
                  正答率 60% 到達まで次の対立は開かない
                </div>
              )}
            </>
          )}
        </div>

        {/* なぜこの訓練 */}
        <div className="rail-block">
          <div className="rail-h">なぜこの訓練?</div>
          <p
            style={{
              margin: 0,
              fontFamily: "var(--font-jp)",
              fontSize: "var(--text-2xs)",
              color: "var(--text-tertiary)",
              lineHeight: 1.7,
            }}
          >
            多話者・多文脈の識別課題は、知覚改善が産出にも転移する唯一の複数メタ分析確証手法です。
            <span className="ev-row" style={{ marginLeft: "4px" }}>
              <span className="ev-chip">§3.3-1</span>
              <span className="ev-chip">REQ-122</span>
            </span>
          </p>
        </div>
      </aside>
    );
  };

  // ---- ドリルプレビュー Dock ----
  const renderDrillDock = () => {
    if (!drillDto) return null;

    const pair = drillDto.minimalPairs[0];
    if (!pair) return null;

    const sessionStimCount =
      hvptPhase.type === "session_active" || hvptPhase.type === "trial_feedback"
        ? hvptPhase.session.stimuli.length
        : "—";

    return (
      <div className="tr-dock">
        <span className="kbd-label">phase ② プレビュー</span>
        <div className="drill-pair" style={{ flex: 1, maxWidth: "340px" }}>
          <div>
            <div className="dw" style={{ fontSize: "var(--text-lg)" }}>
              <span className="t">{pair.targetWord.charAt(0)}</span>
              {pair.targetWord.slice(1)}
            </div>
            <div className="dipa">{pair.targetPhonemeIpa}</div>
          </div>
          <span className="dvs">vs</span>
          <div>
            <div className="dw" style={{ fontSize: "var(--text-lg)" }}>
              <span className="t">{pair.contrastWord.charAt(0)}</span>
              {pair.contrastWord.slice(1)}
            </div>
            <div className="dipa">{pair.contrastPhonemeIpa}</div>
          </div>
        </div>
        <button
          type="button"
          className="rec-btn"
          aria-label="録音"
          style={{ width: "40px", height: "40px" }}
          onClick={() => {
            if (drillRecordingState === "idle") {
              void startDrillRecording();
            } else if (drillRecordingState === "recording") {
              stopDrillRecording();
            }
          }}
        >
          <span
            className="rec-dot"
            style={{
              width: "15px",
              height: "15px",
              background: drillRecordingState === "recording" ? "var(--sev-critical)" : undefined,
            }}
          />
        </button>
        <span className="note" style={{ margin: 0, fontSize: "var(--text-2xs)" }}>
          知覚 {sessionStimCount} 試行ののち、同じペアを録音 → 対象音素のみ即時評価（REQ-123）
        </span>
      </div>
    );
  };

  // ---- ドリル録音 ----
  const startDrillRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      drillChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) drillChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        setDrillRecordingState("done");
      };
      drillMediaRecorderRef.current = recorder;
      recorder.start();
      setDrillRecordingState("recording");
    } catch {
      // マイクアクセス失敗は無視（ドリルプレビューはおまけ）
    }
  };

  const stopDrillRecording = () => {
    drillMediaRecorderRef.current?.stop();
    setDrillRecordingState("idle");
  };

  // ---- シャドーイング: TTS お手本取得 ----
  const loadShadowingReference = async () => {
    setShadowingPhase({ type: "tts_loading" });
    try {
      const response = await globalThis.fetch("/api/v1/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: SHADOWING_REFERENCE_TEXT, speed: 1.0 }),
      });
      if (!response.ok) {
        setShadowingPhase({ type: "error", message: "TTS 取得に失敗しました" });
        return;
      }
      const audioBuffer = await response.arrayBuffer();
      setShadowingPhase({
        type: "ready",
        referenceAudioBytes: new Uint8Array(audioBuffer),
        referenceText: SHADOWING_REFERENCE_TEXT,
      });
    } catch {
      setShadowingPhase({ type: "error", message: "TTS 取得に失敗しました" });
    }
  };

  // ---- シャドーイング: お手本再生 + 同時録音 ----
  const startShadowingRecording = async (phase: Extract<ShadowingPhase, { type: "ready" }>) => {
    const { referenceAudioBytes, referenceText } = phase;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      shadowingChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) shadowingChunksRef.current.push(event.data);
      };

      // AudioContext でお手本を 1.0x 再生 (ADR-013: OQ-7 client-side playbackRate)
      const audioContext = new AudioContext();
      const decodedBuffer = await audioContext.decodeAudioData(
        referenceAudioBytes.buffer.slice(0) as ArrayBuffer,
      );
      const sourceNode = audioContext.createBufferSource();
      sourceNode.buffer = decodedBuffer;
      sourceNode.playbackRate.value = 1.0;
      sourceNode.connect(audioContext.destination);

      const startedAt = Date.now();

      setShadowingPhase({
        type: "recording",
        referenceAudioBytes,
        referenceText,
        referenceAudioNode: sourceNode,
        audioContext,
        startedAt,
      });

      recorder.start();
      shadowingMediaRecorderRef.current = recorder;
      sourceNode.start(0);

      // お手本終了時に録音も自動停止
      sourceNode.onended = () => {
        recorder.stop();
        stream.getTracks().forEach((track) => track.stop());
      };
    } catch {
      setShadowingPhase({ type: "error", message: "マイクへのアクセスに失敗しました" });
    }
  };

  // ---- シャドーイング: 録音停止 + 送信 ----
  const stopAndSubmitShadowing = (phase: Extract<ShadowingPhase, { type: "recording" }>) => {
    const { referenceAudioBytes, referenceText, audioContext, startedAt } = phase;

    // お手本再生を停止
    try {
      phase.referenceAudioNode.stop();
    } catch {
      // 既に停止している場合は無視
    }

    const recorder = shadowingMediaRecorderRef.current;
    if (!recorder) return;

    setShadowingPhase({ type: "submitting" });

    const durationMilliseconds = Date.now() - startedAt;

    recorder.onstop = async () => {
      try {
        const learnerBlob = new Blob(shadowingChunksRef.current, {
          type: shadowingChunksRef.current[0]?.type ?? "audio/webm",
        });
        const referenceBlob = new Blob([referenceAudioBytes.buffer.slice(0) as ArrayBuffer], {
          type: "audio/wav",
        });

        const formData = new FormData();
        formData.append("reference_audio", referenceBlob);
        formData.append("learner_audio", learnerBlob);
        formData.append("reference_text", referenceText);
        formData.append("contrast", SHADOWING_CONTRAST);
        formData.append(
          "duration_minutes",
          String(Math.max(1, Math.floor(durationMilliseconds / 60000))),
        );
        formData.append("duration_milliseconds", String(durationMilliseconds));

        const response = await globalThis.fetch("/api/v1/training/shadowing-lag", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          setShadowingPhase({ type: "error", message: "ラグ計測に失敗しました" });
          return;
        }

        const json = (await response.json()) as { data: ShadowingLagResultDto };
        const lagResult = json.data;

        await audioContext.close();

        setShadowingPhase({
          type: "result",
          lagResult,
          // ADR-013: スロー再生は client-side AudioContext.playbackRate = 0.7
          // recommendSlowPlayback は worker 判定済み (frontend で再判定しない)
          playbackRate: lagResult.recommendSlowPlayback ? 0.7 : 1.0,
        });
      } catch {
        setShadowingPhase({ type: "error", message: "ラグ計測に失敗しました" });
      }
    };

    recorder.stop();
  };

  // ---- シャドーイング: スロー再生でお手本を再生 ----
  const playShadowingAtSpeed = async (audioBytes: Uint8Array, playbackRate: number) => {
    try {
      const audioContext = new AudioContext();
      const decodedBuffer = await audioContext.decodeAudioData(
        audioBytes.buffer.slice(0) as ArrayBuffer,
      );
      const sourceNode = audioContext.createBufferSource();
      sourceNode.buffer = decodedBuffer;
      // M-SHL-6: スロー再生 0.7x は AudioContext.playbackRate で実現 (OQ-7)
      sourceNode.playbackRate.value = playbackRate;
      sourceNode.connect(audioContext.destination);
      sourceNode.onended = () => {
        void audioContext.close();
      };
      sourceNode.start(0);
    } catch {
      // 再生失敗は無視
    }
  };

  // ---- contrast 表示 ----
  const sessionContrast =
    hvptPhase.type === "session_active" || hvptPhase.type === "trial_feedback"
      ? hvptPhase.session.contrast
      : null;

  return (
    <div>
      {/* app-top */}
      <div className="app-top">
        <div className="app-brand">
          NativeTrace <span className="ipa">/ˈneɪtɪv treɪs/</span>
        </div>
        <div className="crumb" style={{ marginLeft: "16px" }}>
          <Link href="/">
            <span>訓練</span>
          </Link>
          {sessionContrast && (
            <>
              <span className="sep">›</span>
              <b>{sessionContrast}</b>
            </>
          )}
        </div>
        {/* phase インジケータ */}
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            gap: "6px",
            alignItems: "center",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-2xs)",
            color: "var(--text-faint)",
          }}
        >
          <span
            style={{
              padding: "4px 10px",
              borderRadius: "var(--r-full)",
              border: "1px solid transparent",
              color: "var(--accent-text)",
              borderColor: "var(--accent-line)",
              background: "var(--accent-soft)",
            }}
          >
            ① 知覚 HVPT
          </span>
          <span>→</span>
          <span
            style={{
              padding: "4px 10px",
              borderRadius: "var(--r-full)",
              border: "1px solid transparent",
            }}
          >
            ② 産出ドリル
          </span>
        </div>
      </div>

      {/* 窓1: HVPT セッション */}
      <div className="tr-body">
        {/* 左: メイン課題 */}
        <div className="tr-main">
          {renderHvptMain()}
          {renderChoiceGrid()}
          {renderFeedbackSlot()}
        </div>

        {/* 右: Rail */}
        {renderRail()}
      </div>

      {/* tr-dock: 産出ドリルプレビュー */}
      {renderDrillDock()}

      {/* 窓2: シャドーイング (REQ-125 / M-SHL-4/5/6) */}
      <div className="section-block" style={{ padding: "var(--sp-8) var(--sp-6)" }}>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-2xs)",
            color: "var(--text-faint)",
            textTransform: "uppercase",
            letterSpacing: "var(--tracking-caps)",
            marginBottom: "12px",
          }}
        >
          シャドーイングモード — REQ-125
        </div>
        <div className="two-col">
          {/* 左: お手本 (.player / .rec-btn / .passage) */}
          <div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-2xs)",
                color: "var(--text-faint)",
                textTransform: "uppercase",
                letterSpacing: "var(--tracking-caps)",
                marginBottom: "12px",
              }}
            >
              お手本に重ねて発話 · 同時録音
            </div>

            {/* .passage — お手本テキスト */}
            <div
              className="passage"
              style={{
                padding: "var(--sp-5)",
                background: "var(--surface-1)",
                border: "1px solid var(--border-faint)",
                borderRadius: "var(--r-lg)",
                color: "var(--text-primary)",
                fontFamily: "var(--font-sans)",
                fontSize: "var(--text-sm)",
                lineHeight: 1.7,
                marginBottom: "16px",
              }}
            >
              {SHADOWING_REFERENCE_TEXT}
            </div>

            {/* コントロール行: .player + .rec-btn + .speed */}
            <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
              {/* .player — お手本再生ボタン */}
              {shadowingPhase.type === "idle" || shadowingPhase.type === "error" ? (
                <button
                  type="button"
                  className="player btn btn--secondary btn--sm"
                  onClick={() => void loadShadowingReference()}
                >
                  お手本を読み込む
                </button>
              ) : shadowingPhase.type === "tts_loading" ? (
                <button type="button" className="player btn btn--secondary btn--sm" disabled>
                  読み込み中...
                </button>
              ) : shadowingPhase.type === "ready" ? (
                <button
                  type="button"
                  className="player btn btn--primary btn--sm"
                  onClick={() => void startShadowingRecording(shadowingPhase)}
                >
                  ▶ 再生 + 録音開始
                </button>
              ) : shadowingPhase.type === "recording" ? (
                <button
                  type="button"
                  className="player btn btn--secondary btn--sm"
                  style={{ color: "var(--sev-critical-text)" }}
                  onClick={() => stopAndSubmitShadowing(shadowingPhase)}
                >
                  ■ 録音停止 + 送信
                </button>
              ) : shadowingPhase.type === "submitting" ? (
                <button type="button" className="player btn btn--secondary btn--sm" disabled>
                  送信中...
                </button>
              ) : shadowingPhase.type === "result" ? (
                <button
                  type="button"
                  className="player btn btn--ghost btn--sm"
                  onClick={() => void loadShadowingReference()}
                >
                  もう一度
                </button>
              ) : null}

              {/* .rec-btn — 録音インジケータ */}
              <button
                type="button"
                className="rec-btn"
                aria-label="録音状態"
                style={{ width: "36px", height: "36px", pointerEvents: "none" }}
                tabIndex={-1}
              >
                <span
                  className="rec-dot"
                  style={{
                    width: "13px",
                    height: "13px",
                    background:
                      shadowingPhase.type === "recording"
                        ? "var(--sev-critical)"
                        : "var(--text-faint)",
                  }}
                />
              </button>

              {/* .speed — スロー再生コントロール (M-SHL-6: ADR-013 OQ-7) */}
              {shadowingPhase.type === "result" && (
                <button
                  type="button"
                  className="speed btn btn--ghost btn--sm"
                  onClick={() => {
                    const result = shadowingPhase;
                    const referenceBytes =
                      shadowingChunksRef.current.length > 0
                        ? null // 録音済みのお手本再生は現在非対応
                        : null;
                    // お手本音声は result state に参照を保持しないためTTSから再取得する
                    // 簡易実装: speed ボタンで TTS を再取得してスロー再生
                    void (async () => {
                      const rate = result.playbackRate === 1.0 ? 0.7 : 1.0;
                      const response = await globalThis.fetch("/api/v1/tts", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ text: SHADOWING_REFERENCE_TEXT, speed: rate }),
                      });
                      if (!response.ok) return;
                      const buf = await response.arrayBuffer();
                      await playShadowingAtSpeed(new Uint8Array(buf), rate);
                      setShadowingPhase({ ...result, playbackRate: rate });
                    })();
                    void referenceBytes; // suppress unused warning
                  }}
                >
                  {shadowingPhase.playbackRate === 1.0 ? "0.7x スロー再生" : "1.0x 通常再生"}
                </button>
              )}
            </div>

            {/* エラー表示 */}
            {shadowingPhase.type === "error" && (
              <p
                style={{
                  marginTop: "8px",
                  color: "var(--sev-critical-text)",
                  fontSize: "var(--text-xs)",
                }}
              >
                {shadowingPhase.message}
              </p>
            )}
          </div>

          {/* 右: ラグメーター (.lag / .lag-needle / .callout / .scope-note) */}
          <div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-2xs)",
                color: "var(--text-faint)",
                textTransform: "uppercase",
                letterSpacing: "var(--tracking-caps)",
                marginBottom: "12px",
              }}
            >
              ラグ（お手本とのずれ）
            </div>

            {/* .lag — ラグメーター */}
            <div className="lag" style={{ maxWidth: "420px" }}>
              <div className="lag-scale" style={{ position: "relative" }}>
                <span className="z z--ok" />
                <span className="z z--ok" />
                <span className="z z--warn" />
                <span className="z z--ng" />
                {/* .lag-needle — 実計測値位置 (M-SHL-4: real API レスポンス由来) */}
                {shadowingPhase.type === "result" &&
                  (() => {
                    const maxLag = 1200;
                    const needlePercent = Math.min(
                      100,
                      (shadowingPhase.lagResult.lagMilliseconds / maxLag) * 100,
                    );
                    return (
                      <span
                        className="lag-needle"
                        data-testid="lag-needle"
                        style={{
                          position: "absolute",
                          left: `${needlePercent}%`,
                          top: 0,
                          bottom: 0,
                          width: "2px",
                          background: "var(--accent)",
                          transform: "translateX(-50%)",
                        }}
                      />
                    );
                  })()}
              </div>
              <div className="lag-lbls">
                <span>0ms</span>
                <span>400</span>
                <span>800</span>
                <span>1200+</span>
              </div>
              {/* .lag — ラグ数値表示 */}
              {shadowingPhase.type === "result" && (
                <div
                  className="lag"
                  data-testid="lag-value"
                  style={{
                    marginTop: "8px",
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--text-lg)",
                    color: shadowingPhase.lagResult.recommendSlowPlayback
                      ? "var(--sev-critical-text)"
                      : "var(--positive-text)",
                  }}
                >
                  {shadowingPhase.lagResult.lagMilliseconds} ms
                </div>
              )}
            </div>

            {/* .callout — スロー再生推奨 (M-SHL-6: recommendSlowPlayback は worker 判定済み) */}
            {shadowingPhase.type === "result" && shadowingPhase.lagResult.recommendSlowPlayback && (
              <div
                className="callout"
                data-testid="callout"
                style={{ marginTop: "14px", maxWidth: "420px" }}
              >
                <span className="ci">!</span>
                <span>
                  ラグが{shadowingPhase.lagResult.thresholdMilliseconds}ms を超えています。 0.7x
                  スロー再生から始めましょう。
                </span>
              </div>
            )}

            {/* .scope-note — 週次実施回数 (M-SHL-4: 実 DB 由来) */}
            {shadowingPhase.type === "result" && (
              <div
                className="scope-note"
                data-testid="scope-note"
                style={{
                  marginTop: "12px",
                  fontSize: "var(--text-xs)",
                  color: "var(--text-secondary)",
                  fontFamily: "var(--font-jp)",
                }}
              >
                今週のシャドーイング: {shadowingPhase.lagResult.weeklySessionCount} 回 （推奨: 週
                3–4 回 × 10–15 分）
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
