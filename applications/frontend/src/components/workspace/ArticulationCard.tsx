"use client";

import { useState, useRef } from "react";
import type { ArticulationEntry } from "@/lib/articulation-data";
import type {
  AcousticEvidenceDto,
  ArticulatoryEstimateDto,
  EngineFindingDto,
  RetryRecordingResponse,
} from "@/lib/api-types";
import { AcousticDiagnosisCard } from "@/components/workspace/AcousticDiagnosisCard";

/**
 * M-CRL-3 (ADR-022): Props を entry+finding に拡張（W-4）。
 * finding は MediaRecorder → retry-recordings POST に必要。
 * M-AAI-14 (ADR-019): articulatoryEstimate — EMA オーバーレイ描画に使用。
 * M-ADVL-1 (ADR-024): acousticEvidence — AcousticDiagnosisCard へ渡す。
 */
type ArticulationCardProps = {
  entry: ArticulationEntry;
  finding: EngineFindingDto;
  /** M-AAI-14 (ADR-019): EMA 調音推定座標。null または displayEligibility < 0.55 のとき floor のみ描画。*/
  articulatoryEstimate?: ArticulatoryEstimateDto | null;
  /** M-ADVL-1 (ADR-024): 音響音声学的証拠。null のとき AcousticDiagnosisCard は描画しない。*/
  acousticEvidence?: AcousticEvidenceDto | null;
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

export const ArticulationCard = ({
  entry,
  finding,
  articulatoryEstimate,
  acousticEvidence,
}: ArticulationCardProps) => {
  const [ttsSpeed, setTtsSpeed] = useState<TtsSpeed>(0.85);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // M-CRL-3: MediaRecorder local state
  const [isRecording, setIsRecording] = useState(false);
  const [retryLoading, setRetryLoading] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingStartRef = useRef<Date | null>(null);

  // M-CRL-9: retry 結果の表示 state
  const [retryState, setRetryState] = useState<RetryRecordingResponse | null>(null);

  const handlePlayTts = async (text: string) => {
    if (audioRef.current) {
      if (ttsPlaying) {
        audioRef.current.pause();
        setTtsPlaying(false);
      } else {
        void audioRef.current.play();
        setTtsPlaying(true);
      }
      return;
    }

    try {
      const response = await fetch("/api/v1/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, speed: ttsSpeed }),
      });
      if (!response.ok) return;

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audio.onended = () => {
        setTtsPlaying(false);
      };
      audioRef.current = audio;
      void audio.play();
      setTtsPlaying(true);
    } catch {
      // TTS unavailable — no-op
    }
  };

  const handleSpeedChange = (speed: TtsSpeed) => {
    setTtsSpeed(speed);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setTtsPlaying(false);
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
        </ol>

        {/* M-AAI-14 (ADR-019 D4): L2 disclaimer — AAI 有効時のみ表示。Kocjancic 2025 音響併置。
            断定的表現を避ける: 「あなたの舌はここ」とは書かない。articulation-card.html:101 準拠。
            Plan B: target-only（showSagittal && !showEmaOverlay）は軽量 floor ノートを表示。
            「推定で外れる」免責は target-only カードには付けない（目標調音は決定論的）。*/}
        {showEmaOverlay ? (
          <div className="disclaimer" style={{ marginTop: "var(--sp-3)" }}>
            <span className="dc-ico">~</span>
            <span>
              推定です（native 話者データ由来。/r/→[ɾ]
              など訛りでは外れることがあります）。あなたの舌位置を断定するものではありません。
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

        {/* M-CRL-3: 自分で試す録音ボタン — disabled を外して MediaRecorder 配線 */}
        <button
          className={`rec-btn${isRecording ? " is-recording" : ""}`}
          type="button"
          disabled={retryLoading}
          aria-label={isRecording ? "録音停止" : "自分で試す"}
          style={{ width: "38px", height: "38px" }}
          title={isRecording ? "録音停止" : "自分で試す"}
          onClick={() => {
            if (isRecording) {
              handleStopRecording();
            } else {
              void handleStartRecording();
            }
          }}
        >
          <span className="rec-dot" style={{ width: "14px", height: "14px" }} />
        </button>

        <span className="note" style={{ margin: 0, fontSize: "var(--text-2xs)" }}>
          図解は音響と併置 — 聞いて・見て・出す
        </span>

        {/* M-CRL-9: retryState 表示 — v3 .gop-delta（GOP X→Y + deltaSignal チップ + boundary） */}
        {retryState && (
          <div className="gop-delta" style={{ marginTop: "10px" }}>
            <div className="gd-x2y">
              <span className="kbd-label" style={{ alignSelf: "center" }}>
                GOP
              </span>
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
            </div>
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
                ? "改善"
                : retryState.deltaSignal === "regressed"
                  ? "悪化"
                  : "変化なし"}{" "}
              {retryState.gopDelta >= 0 ? "+" : ""}
              {retryState.gopDelta.toFixed(1)}
            </span>
            {/* boundarySignal — 重大度境界を脱する */}
            {retryState.boundarySignal === "crossedMinor" && (
              <span className="gd-boundary">
                <span className="gb-from">minor</span> を脱しました
              </span>
            )}
            {retryState.boundarySignal === "crossedMajor" && (
              <span className="gd-boundary">
                <span className="gb-from">major</span> を脱しました
              </span>
            )}
          </div>
        )}

        {/* ローディング中 */}
        {retryLoading && (
          <div
            style={{ marginTop: "6px", fontSize: "var(--text-2xs)", color: "var(--text-faint)" }}
          >
            評価中...
          </div>
        )}
      </div>

      {/* M-ADVL-1 (ADR-024): 音響音声学診断カード — acousticEvidence が null のとき非表示（M-ADVL-2）*/}
      <AcousticDiagnosisCard
        acousticEvidence={acousticEvidence ?? null}
        phonemeLabel={entry.ipaDisplay}
      />
    </div>
  );
};
