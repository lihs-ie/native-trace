"use client";

import { useState, useRef } from "react";
import type { ArticulationEntry } from "@/lib/articulation-data";
import type { EngineFindingDto, RetryRecordingResponse } from "@/lib/api-types";

/**
 * M-CRL-3 (ADR-022): Props を entry+finding に拡張（W-4）。
 * finding は MediaRecorder → retry-recordings POST に必要。
 */
type ArticulationCardProps = {
  entry: ArticulationEntry;
  finding: EngineFindingDto;
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
export const ArticulationCard = ({ entry, finding }: ArticulationCardProps) => {
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

  return (
    <div className="artic">
      {/* 調音断面図 — design §06 仕様合致 (M-HOW-10) */}
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

      {/* 右カラム: 見出し + 調音手順 */}
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

        <ol className="artic-steps">
          {entry.steps.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
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
    </div>
  );
};
