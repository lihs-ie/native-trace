"use client";

import { useState, useRef, useEffect } from "react";
import type { ArticulationEntry } from "@/lib/articulation-data";
import { useTtsPlayback } from "@/components/workspace/use-tts-playback";
import type {
  AcousticEvidenceDto,
  ArticulatoryEstimateDto,
  EngineFindingDto,
  RetryRecordingResponse,
} from "@/lib/api-types";
import { AcousticDiagnosisCard } from "@/components/workspace/AcousticDiagnosisCard";
import {
  getPhenomenonIcon,
  getPhenomenonLabelJa,
  getPhenomenonLabelEn,
  confidenceToLevel,
} from "@/lib/phenomenon";

/**
 * M-CRL-3 (ADR-022): Props を entry+finding に拡張（W-4）。
 * finding は MediaRecorder → retry-recordings POST に必要。
 * M-AAI-14 (ADR-019): articulatoryEstimate — EMA オーバーレイ描画に使用。
 * M-ADVL-1 (ADR-024): acousticEvidence — AcousticDiagnosisCard へ渡す。
 * M-CRL-13 (ADR-022 D15): latestRecordingAttemptIdentifier — original-vs-retry A/B 比較再生に使用。
 */
type ArticulationCardProps = {
  entry: ArticulationEntry;
  finding: EngineFindingDto;
  /** M-AAI-14 (ADR-019): EMA 調音推定座標。null または displayEligibility < 0.55 のとき floor のみ描画。*/
  articulatoryEstimate?: ArticulatoryEstimateDto | null;
  /** M-ADVL-1 (ADR-024): 音響音声学的証拠。null のとき AcousticDiagnosisCard は描画しない。*/
  acousticEvidence?: AcousticEvidenceDto | null;
  /** M-CRL-13 (ADR-022 D15): 最新 ready 録音試行 identifier（original-vs-retry A/B 比較再生に使用）。*/
  latestRecordingAttemptIdentifier?: string | null;
};

type TtsSpeed = 0.5 | 0.85 | 1.0;

/**
 * 調音図解カード — design §06 `.artic` 準拠 (M-ARTIC-a)
 *
 * 構造:
 * - `.artic` (2列 220px 1fr)
 *   - `.artic-fig` (aspect 1/1・斜めストライプ) > `.sym` + `.ph` プレースホルダー
 *   - 右側: IPA見出し + `.artic-steps` (手順 li counter)
 *   - `.artic-audio` (全幅・お手本TTS再生ボタン)
 *
 * TTS実配線: POST /api/v1/tts → HTMLAudioElement (M-ARTIC-d)
 * M-CRL-3: MediaRecorder 配線 + POST /api/v1/findings/{id}/retry-recordings
 * M-CRL-9: retryState 表示（GOP delta + signal 色分け + boundary メッセージ）
 */
/**
 * 正規化座標 c∈[-1,1] → sagittal-wrap ボックス内の CSS パーセント位置へ変換。
 * 変換式: pos = (c * 0.5 + 0.5) * 100 [%]
 * c=-1 → 0%, c=0 → 50%, c=1 → 100%。
 * 校正注意: EMA→SVG のオフセット校正は未成熟（ADR-019 S-AAI-1 / Risk）。
 * 線形写像は MVP として妥当だが、EMA z-score 正規化と SVG 解剖学的座標系の
 * アライメントは実機検証フェーズで調整が必要。
 */
const normalizedCoordToPercent = (coordinate: number): string =>
  `${(coordinate * 0.5 + 0.5) * 100}%`;

/** D4 ガードレール: displayEligibility ≥ 0.55 かつ非 null のとき EMA オーバーレイを表示 */
const DISPLAY_ELIGIBILITY_THRESHOLD = 0.55;

/**
 * M-AAI-19 (ADR-019 D6): 天井偏差方向判定のε閾値（パーセントポイント）。
 * estTip と targetArticulation の差が ε 以下のとき当該軸のラベルを省略する。
 */
const DEVIATION_EPSILON_PERCENT = 2.0;

/**
 * retrySeverity ('critical'|'major'|'minor'|'suggestion'|'none') を
 * CSS badge サフィックスに変換する。
 * 'none' はしきい値内（最良ケース）— badge--none を使う。
 * 'suggestion' → 'suggest'（CSS クラス命名規則）。
 * frontend では scoring しきい値を再導出しない（ADR-004/M-CRL-17）。
 */
const retrySeverityToBadgeClass = (
  retrySeverity: RetryRecordingResponse["retrySeverity"],
): string => {
  switch (retrySeverity) {
    case "critical":
      return "badge--critical";
    case "major":
      return "badge--major";
    case "minor":
      return "badge--minor";
    case "suggestion":
      return "badge--suggest";
    case "none":
      return "badge--none";
  }
};

/**
 * retrySeverity を表示ラベルに変換する。
 */
const retrySeverityToLabel = (retrySeverity: RetryRecordingResponse["retrySeverity"]): string => {
  switch (retrySeverity) {
    case "critical":
      return "Critical";
    case "major":
      return "Major";
    case "minor":
      return "Minor";
    case "suggestion":
      return "Suggest";
    case "none":
      return "None";
  }
};

export const ArticulationCard = ({
  entry,
  finding,
  articulatoryEstimate,
  acousticEvidence,
  latestRecordingAttemptIdentifier,
}: ArticulationCardProps) => {
  const [ttsSpeed, setTtsSpeed] = useState<TtsSpeed>(0.85);
  // W34: TTS fetch→objectURL→Audio 再生と revoke 管理は共通 hook に委譲
  const {
    isPlaying: ttsPlaying,
    togglePlay: toggleTtsPlayback,
    playOnce: playTtsOnce,
    stop: stopTtsPlayback,
  } = useTtsPlayback();

  // M-CRL-3: MediaRecorder local state
  const [isRecording, setIsRecording] = useState(false);
  const [retryLoading, setRetryLoading] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingStartRef = useRef<Date | null>(null);
  /** W34: 録音中 unmount で mic トラックを解放するために stream を保持 */
  const micStreamRef = useRef<MediaStream | null>(null);

  /** W34: playClip 用 AudioContext lazy-singleton（unmount で close） */
  const audioContextRef = useRef<AudioContext | null>(null);
  const acquireAudioContext = (): AudioContext => {
    audioContextRef.current ??= new AudioContext();
    return audioContextRef.current;
  };

  // W34: unmount cleanup — 録音中なら submit を発火させず mic トラックのみ解放し、
  // AudioContext を close する（再生中 TTS の停止は useTtsPlayback が担う）
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.ondataavailable = null;
        mediaRecorderRef.current.onstop = null;
      }
      micStreamRef.current?.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
      void audioContextRef.current?.close();
      audioContextRef.current = null;
    };
  }, []);

  // M-CRL-9: retry 結果の表示 state
  const [retryState, setRetryState] = useState<RetryRecordingResponse | null>(null);

  const handlePlayTts = (text: string): Promise<void> => toggleTtsPlayback(text, ttsSpeed);

  const handleSpeedChange = (speed: TtsSpeed) => {
    setTtsSpeed(speed);
    stopTtsPlayback();
  };

  /**
   * M-AAI-21c (ADR-019 D6): ミニマルペアの A/B 順次再生。
   * targetWord を TTS 再生し、ended 後に contrastWord を再生する。
   * playOnce は使い捨て Audio を使い、お手本 toggle state を汚染しない。
   * エラーは no-op（TTS 不在時はサイレントに失敗）。
   */
  const handlePlayMinimalPair = async ({
    targetWord,
    contrastWord,
  }: {
    targetWord: string;
    contrastWord: string;
  }) => {
    try {
      await playTtsOnce(targetWord, ttsSpeed);
      await playTtsOnce(contrastWord, ttsSpeed);
    } catch {
      // TTS unavailable — no-op
    }
  };

  /**
   * M-CRL-3: 録音開始 — MediaRecorder を起動する。
   * 録音停止後に retry-recordings POST を送信する。
   */
  const handleStartRecording = async () => {
    if (isRecording) return;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return;
    }

    micStreamRef.current = stream;
    recordedChunksRef.current = [];
    recordingStartRef.current = new Date();

    const mediaRecorder = new MediaRecorder(stream);
    mediaRecorderRef.current = mediaRecorder;

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunksRef.current.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      const chunks = recordedChunksRef.current;
      if (chunks.length === 0) return;

      const mimeType = mediaRecorder.mimeType || "audio/webm";
      const blob = new Blob(chunks, { type: mimeType });
      const durationMs = recordingStartRef.current
        ? Date.now() - recordingStartRef.current.getTime()
        : 1000;

      void submitRetryRecording(blob, mimeType, durationMs);
    };

    mediaRecorder.start();
    setIsRecording(true);
  };

  const handleStopRecording = () => {
    if (!isRecording || !mediaRecorderRef.current) return;
    mediaRecorderRef.current.stop();
    setIsRecording(false);
  };

  /**
   * M-CRL-13 (ADR-022 D15): original-vs-retry A/B 順次再生。
   * originalIdentifier の録音 → retryIdentifier の録音を順番に再生する。
   * 既存録音音声 Route Handler (GET /api/v1/recording-attempts/{id}/audio) を再利用。
   * handlePlayMinimalPair と同じ sequential-playback パターン。
   */
  const handlePlayOriginalVsRetry = async (
    originalIdentifier: string | null,
    retryIdentifier: string,
  ) => {
    const playClip = async (identifier: string): Promise<void> => {
      const response = await fetch(`/api/v1/recording-attempts/${identifier}/audio`);
      if (!response.ok) return;
      const arrayBuffer = await response.arrayBuffer();
      const audioContext = acquireAudioContext();
      const decoded = await audioContext.decodeAudioData(arrayBuffer);
      const source = audioContext.createBufferSource();
      source.buffer = decoded;
      source.connect(audioContext.destination);
      await new Promise<void>((resolve) => {
        source.onended = () => resolve();
        source.start();
      });
    };

    try {
      if (originalIdentifier) {
        await playClip(originalIdentifier);
      }
      await playClip(retryIdentifier);
    } catch {
      // audio playback unavailable — no-op
    }
  };

  /**
   * M-CRL-3/4: 録音 blob を POST /api/v1/findings/{findingIdentifier}/retry-recordings へ送信。
   * M-CRL-9: 成功時に retryState をセット（GOP delta + signal 色分け + boundary メッセージ）。
   */
  const submitRetryRecording = async (blob: Blob, mimeType: string, durationMs: number) => {
    setRetryLoading(true);
    try {
      const targetWord = finding.expected.text ?? finding.detected.text ?? "";
      const expectedPhonemeIpa = finding.expected.ipa ?? "";
      const originalGop = finding.gop ?? 0;
      const expectedAudioRangeStartMs = finding.audioRange?.startMilliseconds ?? 0;

      const formData = new FormData();
      formData.append("audio", new File([blob], "recording", { type: mimeType }));
      formData.append("recordedDurationMs", String(Math.max(1, Math.round(durationMs))));
      formData.append("referenceText", targetWord);
      formData.append("expectedPhonemeIpa", expectedPhonemeIpa);
      formData.append("expectedAudioRangeStartMs", String(expectedAudioRangeStartMs));
      formData.append("originalGop", String(originalGop));

      const response = await fetch(`/api/v1/findings/${finding.finding}/retry-recordings`, {
        method: "POST",
        body: formData,
      });

      if (response.status === 422) {
        // low_quality → 再録音プロンプト（retryState は更新しない）
        return;
      }

      if (!response.ok) return;

      const json = (await response.json()) as { data: RetryRecordingResponse };
      setRetryState(json.data);
    } catch {
      // network error — no-op
    } finally {
      setRetryLoading(false);
    }
  };

  /**
   * M-AAI-14 (ADR-019) D4 ガードレール:
   * articulatoryEstimate が非 null かつ displayEligibility >= 0.55 のときのみ EMA オーバーレイを表示。
   * 1 つでも欠ければ floor (静的 SVG + steps) のみ描く。
   */
  const showEmaOverlay =
    articulatoryEstimate != null &&
    articulatoryEstimate.displayEligibility >= DISPLAY_ELIGIBILITY_THRESHOLD;

  /**
   * Plan B (ADR-019): targetArticulation が存在するか EMA オーバーレイが有効なとき
   * .artic--aai + .sagittal-wrap ブランチを使う。
   * targetArticulation だけの場合（learner 推定なし）でも dashed 目標丸を描画できる。
   */
  const showSagittal = entry.targetArticulation != null || showEmaOverlay;

  return (
    <div className={showSagittal ? "artic artic--aai" : "artic"}>
      {showSagittal ? (
        /* Plan B + M-AAI-14: .sagittal-wrap に floor <img> + .ema-layer オーバーレイを重ねる */
        <div className="sagittal-wrap">
          {entry.sagittalSvgPath ? (
            // eslint-disable-next-line @next/next/no-img-element -- ADR-020 M-HOW-10: static sagittal SVG asset, not a Next-optimized remote image
            <img
              src={entry.sagittalSvgPath}
              alt={`/${entry.phoneme}/ の調音断面図`}
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
            />
          ) : (
            <div className="sag-ph">
              <span className="sym">{entry.ipaDisplay}</span>
              <span>
                sagittal-diagram
                <br />
                placeholder
              </span>
            </div>
          )}

          {/* EMA オーバーレイ — 既存 CSS クラスのみ使用 */}
          <div className="ema-layer">
            {/* Plan B: 目標調音の目安（破線丸）— targetArticulation があれば常時描画（ML 不要）*/}
            {entry.targetArticulation && (
              <div
                className="ema-target"
                style={{
                  left: `${entry.targetArticulation.x}%`,
                  top: `${entry.targetArticulation.y}%`,
                }}
                title={entry.targetArticulation.label}
              >
                <span className="ema-lbl">{entry.targetArticulation.label}</span>
              </div>
            )}

            {/* M-AAI-14: 学習者推定（塗り潰し丸）— showEmaOverlay かつ estimate 有効時のみ */}
            {showEmaOverlay && articulatoryEstimate && (
              <>
                {/* 舌先 (tongue tip) */}
                <div
                  className="ema-pt ema-pt--tip"
                  style={{
                    left: normalizedCoordToPercent(articulatoryEstimate.tongueTipX),
                    top: normalizedCoordToPercent(-articulatoryEstimate.tongueTipY),
                  }}
                >
                  <i />
                  <span className="ema-lbl">舌先（推定）</span>
                </div>

                {/* 舌背 (tongue dorsum) */}
                <div
                  className="ema-pt ema-pt--dorsum"
                  style={{
                    left: normalizedCoordToPercent(articulatoryEstimate.tongueDorsumX),
                    top: normalizedCoordToPercent(-articulatoryEstimate.tongueDorsumY),
                  }}
                >
                  <i />
                </div>

                {/* 唇開き (lip aperture) */}
                <div
                  className="ema-pt ema-pt--lip"
                  style={{
                    left: normalizedCoordToPercent(articulatoryEstimate.lipApertureX),
                    top: normalizedCoordToPercent(-articulatoryEstimate.lipApertureY),
                  }}
                >
                  <i />
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        /* floor のみ — 既存 .artic-fig 描画（回帰させない） */
        <div className="artic-fig">
          <span className="sym">{entry.ipaDisplay}</span>
          {entry.sagittalSvgPath ? (
            // eslint-disable-next-line @next/next/no-img-element -- ADR-020 M-HOW-10: static sagittal SVG asset, not a Next-optimized remote image
            <img
              src={entry.sagittalSvgPath}
              alt={`/${entry.phoneme}/ の調音断面図`}
              style={{ maxWidth: "100%", maxHeight: "100%" }}
            />
          ) : (
            <span className="ph">
              sagittal-diagram
              <br />
              placeholder
              <br />
              320×320 · SVG
            </span>
          )}
        </div>
      )}

      {/* 右カラム: 見出し + 調音手順 + AAI enrichment メタ情報 */}
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "10px",
            marginBottom: "12px",
          }}
        >
          <span className="mono" style={{ fontSize: "var(--text-xl)" }}>
            {entry.ipaDisplay}
          </span>
          <b style={{ fontSize: "var(--text-sm)" }}>{entry.nameJa}</b>
          {/* M-AAI-21a (ADR-019 D6): ADR ステータスバッジ — design HTML:79 準拠。Proposed 状態を UI 上で開示。 */}
          <span className="adr-badge adr-badge--proposed">ADR-019 · Proposed</span>
          <span className="kbd-label" style={{ marginLeft: "auto" }}>
            {entry.nameEn}
          </span>
        </div>

        {/* v3 二層タグ + 適格性メーター行 — design-reference/screens/articulation-card.html:92-96 準拠。
            確定(floor) は常時、推定(enrich) と elig は AAI 有効時に追加（floor を置換しない）。*/}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            marginBottom: "12px",
            flexWrap: "wrap",
          }}
        >
          <span className="layer-tag layer-tag--floor">確定 · floor</span>
          {showEmaOverlay && (
            <span className="layer-tag layer-tag--enrich">
              <span className="lt-ico">~</span>推定 · EMA 重畳
            </span>
          )}
          {showEmaOverlay && articulatoryEstimate && (
            <span className="elig" style={{ marginLeft: "auto" }}>
              elig
              <div className="elig-track">
                <i style={{ width: `${articulatoryEstimate.displayEligibility * 100}%` }} />
                <div className="elig-gate" />
              </div>
              {articulatoryEstimate.displayEligibility.toFixed(2)}
            </span>
          )}
        </div>

        <ol className="artic-steps">
          {entry.steps.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
          {/* M-AAI-19/20 (ADR-019 D6): 天井偏差 step — showEmaOverlay かつ targetArticulation 設定済みのとき追記。
              偏差方向は articulatoryEstimate と targetArticulation のみから決定論的に導出（worker 非依存）。
              M-AAI-22/ADR-004: presentation-only — finding.scoreImpact / severity / ScoreSet は一切参照しない。 */}
          {(() => {
            if (!showEmaOverlay || !entry.targetArticulation || !articulatoryEstimate) return null;
            const estTipXpercent = (articulatoryEstimate.tongueTipX * 0.5 + 0.5) * 100;
            const estTipYpercent = (-articulatoryEstimate.tongueTipY * 0.5 + 0.5) * 100;
            const deltaX = estTipXpercent - entry.targetArticulation.x;
            const deltaY = estTipYpercent - entry.targetArticulation.y;
            const dirs: string[] = [];
            if (deltaX > DEVIATION_EPSILON_PERCENT) dirs.push("後退");
            else if (deltaX < -DEVIATION_EPSILON_PERCENT) dirs.push("前進");
            if (deltaY > DEVIATION_EPSILON_PERCENT) dirs.push("下降");
            else if (deltaY < -DEVIATION_EPSILON_PERCENT) dirs.push("上昇");
            const deviationSentence =
              dirs.length > 0
                ? `舌先が目標より${dirs.join("・")}しています。`
                : "舌先はほぼ目標どおりです。";
            return (
              <li key="ceiling">
                <span>
                  <b>天井</b>: 破線 = 目標、塗り = あなたの推定舌先。{deviationSentence}
                </span>
              </li>
            );
          })()}
        </ol>

        {/* M-AAI-14 (ADR-019 D4): L2 disclaimer — AAI 有効時のみ表示。Kocjancic 2025 音響併置。
            断定的表現を避ける: 「あなたの舌はここ」とは書かない。articulation-card.html:101 準拠。
            Plan B: target-only（showSagittal && !showEmaOverlay）は軽量 floor ノートを表示。
            「推定で外れる」免責は target-only カードには付けない（目標調音は決定論的）。*/}
        {showEmaOverlay ? (
          <div className="disclaimer" style={{ marginTop: "var(--sp-3)" }}>
            <span className="dc-ico">~</span>
            {/* M-AAI-21b (ADR-019 D6): design HTML:101 の落ちていた句を追記。
                既存文「あなたの舌位置を断定するものではありません。」を残し、その直後に連結。
                D3-b/D3-c の wire 非露出契約（生 mm・下顎・舌体を出さない）と D2 degrade を UI で明示。 */}
            <span>
              推定です（native 話者データ由来。/r/→[ɾ]
              など訛りでは外れることがあります）。あなたの舌位置を断定するものではありません。生
              mm・舌体・下顎は出さず、発話内 z 正規化座標のみ。aai 無効時は床のみ。
            </span>
          </div>
        ) : showSagittal ? (
          <div className="disclaimer" style={{ marginTop: "var(--sp-3)" }}>
            <span className="dc-ico">◌</span>
            <span>破線（◌）= 目標調音の目安です。あなたの発話からの推定ではありません。</span>
          </div>
        ) : null}
      </div>

      {/* 調音音声エリア — design §06 `.artic-audio` 全幅 */}
      <div className="artic-audio">
        <button
          className="btn btn--sm btn--secondary"
          type="button"
          onClick={() => void handlePlayTts(entry.exampleWord)}
        >
          {ttsPlaying ? "❚❚" : "▸"} お手本 {entry.ipaDisplay} 単音{" "}
          <span className="mono" style={{ opacity: 0.6 }}>
            {entry.exampleWord}
          </span>
        </button>

        {/* M-AAI-21c (ADR-019 D6): ミニマルペア A/B 順次再生ボタン — design HTML:105 準拠。
            playOnce の使い捨て Audio を使い、お手本 toggle state を汚染しない。
            entry.minimalPair が未設定の音素（/ɪ/・/ʌ/・/ð/・/f/・/ə/）はボタン非表示。 */}
        {entry.minimalPair && (
          <button
            className="btn btn--sm btn--secondary"
            type="button"
            onClick={() => void handlePlayMinimalPair(entry.minimalPair!)}
          >
            ▸ {entry.minimalPair.targetWord} · ミニマルペア
          </button>
        )}

        {/* 速度切替 */}
        <div className="speed" style={{ display: "inline-flex", gap: "4px" }}>
          {([0.5, 0.85, 1.0] as TtsSpeed[]).map((speed) => (
            <button
              key={speed}
              className={`sp-chip${ttsSpeed === speed ? " is-active" : ""}`}
              type="button"
              onClick={() => handleSpeedChange(speed)}
            >
              {speed}x
            </button>
          ))}
        </div>

        <span className="note" style={{ margin: 0, fontSize: "var(--text-2xs)" }}>
          図解は音響と併置 — 聞いて・見て・出す
        </span>
      </div>

      {/*
       * M-CRL-14 (ADR-022 D13): BEFORE/AFTER 二列状態機械
       * finding-loop.html Screen 12 の .lp グリッド構造に準拠。
       * state-1 (retryState === null) = BEFORE: severity badge + phenomenon + 4-step tracker + 録音ボタン
       * state-2 (retryState !== null) = AFTER : retrySeverity badge + phenomenon dup + GOP delta + chips
       */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "var(--sp-6)",
          padding: "var(--sp-4) 0",
        }}
      >
        {/* BEFORE panel — state-1 */}
        <div className="lp-panel">
          <div className="lp-head">
            {/* finding.severity badge — BEFORE は元の severity を表示 */}
            <span
              className={`badge badge--${finding.severity === "suggestion" ? "suggest" : finding.severity}`}
            >
              <span className="dot" />
              {finding.severity === "critical"
                ? "Critical"
                : finding.severity === "major"
                  ? "Major"
                  : finding.severity === "minor"
                    ? "Minor"
                    : "Suggest"}
            </span>
            {/* M-CRL-12: phenomenon — BEFORE から表示（AFTER でも複製）*/}
            {finding.phenomenon && (
              <span className="phen">
                <span className="pi">{getPhenomenonIcon(finding.phenomenon)}</span>
                {getPhenomenonLabelJa(finding.phenomenon)}{" "}
                <span className="pe">{getPhenomenonLabelEn(finding.phenomenon)}</span>
              </span>
            )}
            <span className="lp-state">① 再録音前</span>
          </div>
          <div className="lp-body">
            {/* M-CRL-14: 4-step tracker — finding-loop.html lines 53-58 */}
            <div className="loop-steps">
              <div className="loop-step">
                <span className="ls-n">01</span>
                <span className="ls-k">聞く</span>
              </div>
              <div className="loop-step">
                <span className="ls-n">02</span>
                <span className="ls-k">比べる</span>
              </div>
              <div className="loop-step">
                <span className="ls-n">03</span>
                <span className="ls-k">出す</span>
              </div>
              <div className="loop-step">
                <span className="ls-n">04</span>
                <span className="ls-k">測る</span>
              </div>
            </div>

            {/* M-CRL-3: 自分で試す録音ボタン — disabled を外して MediaRecorder 配線 */}
            <div className="lp-controls" style={{ justifyContent: "center", paddingTop: "4px" }}>
              <button
                className={`rec-btn${isRecording ? " is-recording" : ""}`}
                type="button"
                disabled={retryLoading}
                aria-label={isRecording ? "録音停止" : "自分で試す"}
                style={{ width: "52px", height: "52px" }}
                title={isRecording ? "録音停止" : "自分で試す"}
                onClick={() => {
                  if (isRecording) {
                    handleStopRecording();
                  } else {
                    void handleStartRecording();
                  }
                }}
              >
                <span className="rec-dot" style={{ width: "18px", height: "18px" }} />
              </button>
              <span className="note" style={{ margin: 0 }}>
                同じ語をその場で再録音 →
              </span>
            </div>

            {/* ローディング中 */}
            {retryLoading && (
              <div style={{ fontSize: "var(--text-2xs)", color: "var(--text-faint)" }}>
                評価中...
              </div>
            )}
          </div>
        </div>

        {/* AFTER panel — state-2 (retryState !== null) */}
        <div className="lp-panel">
          {retryState ? (
            <>
              <div className="lp-head">
                {/* M-CRL-11 (ADR-022 D14): AFTER severity badge — worker 由来の retrySeverity */}
                <span className={`badge ${retrySeverityToBadgeClass(retryState.retrySeverity)}`}>
                  <span className="dot" />
                  {retrySeverityToLabel(retryState.retrySeverity)}
                </span>
                {/* M-CRL-12: phenomenon dup — finding.phenomenon の presentation 複製（再判定しない）*/}
                {finding.phenomenon && (
                  <span className="phen">
                    <span className="pi">{getPhenomenonIcon(finding.phenomenon)}</span>
                    {getPhenomenonLabelJa(finding.phenomenon)}{" "}
                    <span className="pe">{getPhenomenonLabelEn(finding.phenomenon)}</span>
                  </span>
                )}
                <span className="lp-state">② 再録音後 — GOP デルタ</span>
              </div>
              <div className="lp-body">
                {/* GOP delta X→Y block（既存 gd-* クラス再利用）*/}
                <div className="gop-delta">
                  <span className="gd-x2y">
                    <span className="gd-from">{retryState.originalGop.toFixed(1)}</span>
                    <span className="gd-arrow">→</span>
                    <span
                      className={`gd-to${
                        retryState.deltaSignal === "improved"
                          ? " is-improved"
                          : retryState.deltaSignal === "regressed"
                            ? " is-regressed"
                            : ""
                      }`}
                    >
                      {retryState.retryGop.toFixed(1)}
                    </span>
                  </span>
                  <span
                    className={`gd-signal gd-signal--${
                      retryState.deltaSignal === "improved"
                        ? "improved"
                        : retryState.deltaSignal === "regressed"
                          ? "regressed"
                          : "flat"
                    }`}
                  >
                    {retryState.deltaSignal === "improved"
                      ? "▲ 進捗"
                      : retryState.deltaSignal === "regressed"
                        ? "▼ 後退"
                        : "→ 変化なし"}{" "}
                    · Δ {retryState.gopDelta >= 0 ? "+" : ""}
                    {retryState.gopDelta.toFixed(1)}
                  </span>
                </div>

                {/* boundarySignal + confidence indicator row */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "14px",
                    flexWrap: "wrap",
                  }}
                >
                  {retryState.boundarySignal === "crossedMinor" && (
                    <span className="gd-boundary">
                      <span className="gb-from">Minor</span> → minor を脱しました
                    </span>
                  )}
                  {retryState.boundarySignal === "crossedMajor" && (
                    <span className="gd-boundary">
                      <span className="gb-from">Major</span> → major を脱しました
                    </span>
                  )}
                  {/* M-CRL-12: confidence indicator — retryConfidence から描画（finding-loop.html line 96）*/}
                  <span
                    className="conf"
                    data-level={confidenceToLevel(retryState.retryConfidence)}
                    style={{ marginLeft: "auto" }}
                  >
                    <span className="cd">
                      <i />
                      <i />
                      <i />
                    </span>
                    {retryState.retryConfidence.toFixed(2)}
                  </span>
                </div>

                {/* M-CRL-16 (ADR-022 D12): low_quality 注記 — qualityStatus=low_quality のときのみ表示 */}
                {retryState.qualityStatus === "low_quality" && (
                  <p
                    className="note"
                    style={{ margin: 0, fontSize: "var(--text-2xs)", color: "var(--text-faint)" }}
                  >
                    品質が低い録音の測定値です
                  </p>
                )}

                {/* M-CRL-15 (ADR-022 D16): drill-verdict — retry-GOP-echo チップのみ ship。
                    retention / post-retry NBest チップは供給源なし → Non-goal 降格（M-CRL-15 per spec）。*/}
                <div className="drill-verdict">
                  <span style={{ color: "var(--text-tertiary)" }}>
                    retry GOP {retryState.retryGop.toFixed(1)}
                  </span>
                </div>

                {/* M-CRL-14: two-signal 注記 — finding-loop.html line 103 */}
                <p className="note" style={{ margin: 0, fontSize: "var(--text-2xs)" }}>
                  2 signal は別フィールド: deltaSignal（連続量 Δ）と boundarySignal（minor/major
                  を脱したか）を併記。コピーは進捗トラッキングに限定。
                </p>

                {/* M-CRL-13 (ADR-022 D15): original-vs-retry A/B 比較再生 */}
                <div
                  className="lp-controls"
                  style={{ borderTop: "1px solid var(--border-faint)", paddingTop: "var(--sp-4)" }}
                >
                  <button
                    className="btn btn--sm btn--secondary"
                    type="button"
                    onClick={() =>
                      void handlePlayOriginalVsRetry(
                        latestRecordingAttemptIdentifier ?? null,
                        retryState.retryRecordingAttemptIdentifier,
                      )
                    }
                    disabled={!latestRecordingAttemptIdentifier}
                  >
                    ⇄ 再録音と聞き比べ
                  </button>
                </div>
              </div>
            </>
          ) : (
            /* AFTER panel placeholder — retry 未実行 */
            <div className="lp-body" style={{ justifyContent: "center", minHeight: "120px" }}>
              <p
                style={{
                  color: "var(--text-faint)",
                  fontSize: "var(--text-2xs)",
                  fontFamily: "var(--font-mono)",
                  textAlign: "center",
                  margin: 0,
                }}
              >
                再録音後に GOP デルタが表示されます
              </p>
            </div>
          )}
        </div>
      </div>

      {/* M-ADVL-1 (ADR-024): 音響音声学診断カード — acousticEvidence が null のとき非表示（M-ADVL-2）*/}
      <AcousticDiagnosisCard
        acousticEvidence={acousticEvidence ?? null}
        phonemeLabel={entry.ipaDisplay}
      />
    </div>
  );
};
